import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { ENVLOCK_FOLDER } from '../config/config.js'
import { findRepoRoot } from '../utils/repo.js'

const HOOK_NAMES = ['pre-commit', 'post-merge']
const MARKER     = '# envlock — added by envlock install-hooks'

// the block appended / looked for in .git/hooks/*
function callerBlock(hookName) {
  const args = hookName === 'post-merge' ? ' "$@"' : ''
  return [
    '',
    MARKER,
    `if [ -f ".envlock/hooks/${hookName}" ]; then`,
    `  .envlock/hooks/${hookName}${args}`,
    `fi`,
    '',
  ].join('\n')
}

function hasMarker(filePath) {
  if (!existsSync(filePath)) return false
  return readFileSync(filePath, 'utf8').includes(MARKER)
}

function removeMarkerBlock(content) {
  // remove from the blank line before MARKER through the closing fi + blank line
  return content.replace(/\n# envlock — added by envlock install-hooks\nif \[ -f[^\n]*\n  [^\n]*\nfi\n/g, '')
}

// ── core install logic ────────────────────────────────────────────────────────

export function installHooks(repoRoot, options = {}) {
  const gitHooksDir = join(repoRoot, '.git', 'hooks')
  mkdirSync(gitHooksDir, { recursive: true })

  const results = []

  for (const hookName of HOOK_NAMES) {
    const gitHookPath = join(gitHooksDir, hookName)

    if (hasMarker(gitHookPath) && !options.force) {
      results.push({ hookName, status: 'already' })
      continue
    }

    if (existsSync(gitHookPath)) {
      // existing hook — append (or re-append if --force)
      let content = readFileSync(gitHookPath, 'utf8')
      if (options.force) content = removeMarkerBlock(content)
      writeFileSync(gitHookPath, content + callerBlock(hookName))
      results.push({ hookName, status: 'appended' })
    } else {
      // no existing hook — write a fresh one
      writeFileSync(gitHookPath, `#!/bin/bash\n${callerBlock(hookName)}`)
      results.push({ hookName, status: 'installed' })
    }

    chmodSync(gitHookPath, 0o755)
  }

  return results
}

// ── envlock install-hooks command ─────────────────────────────────────────────

export async function cmdInstallHooks(options = {}) {
  const repoRoot = findRepoRoot()
  if (!repoRoot) {
    console.log(chalk.red('  ✗ not inside a git repository\n'))
    return
  }

  const hooksScriptsDir = join(repoRoot, ENVLOCK_FOLDER, 'hooks')
  if (!existsSync(hooksScriptsDir)) {
    console.log(chalk.red('  ✗ .envlock/hooks/ not found — run envlock setup first\n'))
    return
  }

  console.log(chalk.bold('\n  envlock install-hooks\n'))

  const results = installHooks(repoRoot, options)

  for (const { hookName, status } of results) {
    if (status === 'already') {
      console.log(`  ${chalk.dim('–')}  ${hookName} — already installed`)
    } else if (status === 'appended') {
      console.log(`  ${chalk.green('✓')}  ${hookName} — appended to existing hook`)
    } else {
      console.log(`  ${chalk.green('✓')}  ${hookName} — installed`)
    }
  }

  console.log()
}

// ── prompt version — used by setup and join ───────────────────────────────────

export async function promptInstallHooks(repoRoot) {
  const gitHooksDir  = join(repoRoot, '.git', 'hooks')
  const allInstalled = HOOK_NAMES.every(name => hasMarker(join(gitHooksDir, name)))

  if (allInstalled) {
    console.log(`  ${chalk.dim('–')}  git hooks already installed`)
    console.log()
    return
  }

  console.log(`  envlock can install git hooks to protect your repo:`)
  console.log(`    ${chalk.dim('pre-commit')}  — blocks committing .env files + raw token deletions`)
  console.log(`    ${chalk.dim('post-merge')}  — runs envlock verify after every pull`)
  console.log()

  const { default: Enquirer } = await import('enquirer')
  const { install } = await new Enquirer().prompt({
    type:    'confirm',
    name:    'install',
    message: 'install git hooks?',
    initial: true,
  })

  console.log()

  if (install) {
    const results = installHooks(repoRoot)
    for (const { hookName, status } of results) {
      if (status === 'appended') {
        console.log(`  ${chalk.green('✓')}  ${hookName} — appended to existing hook`)
      } else {
        console.log(`  ${chalk.green('✓')}  ${hookName} — installed`)
      }
    }
  } else {
    console.log(`  ${chalk.dim('skipped — run')} ${chalk.bold('envlock install-hooks')} ${chalk.dim('any time to install later')}`)
  }

  console.log()
}
