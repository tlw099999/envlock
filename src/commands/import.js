import chalk from 'chalk'
import ora from 'ora'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig } from '../config/config.js'
import { setVar, listKeys, getMyLevel, readAllTokens } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

const LEVELS = { read: 1, write: 2, manage: 3 }

// ── parse a .env file into key/value pairs ────────────────────────────────────
// handles:
//   KEY=VALUE
//   KEY="VALUE WITH SPACES"
//   KEY='VALUE'
//   export KEY=VALUE
//   # comments → skipped
//   blank lines → skipped

export function parseEnvFile(content) {
  const pairs = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()

    // skip blank lines and comments
    if (!line || line.startsWith('#')) continue

    // strip optional "export " prefix
    const stripped = line.replace(/^export\s+/, '')

    const eqIndex = stripped.indexOf('=')
    if (eqIndex === -1) continue

    const key   = stripped.slice(0, eqIndex).trim()
    let   value = stripped.slice(eqIndex + 1).trim()

    if (!key) continue

    // strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    pairs.push({ key, value })
  }
  return pairs
}

// ── envlock import ────────────────────────────────────────────────────────────

export async function cmdImport(options) {
  const env = options.env

  console.log(chalk.bold(`\n  envlock import → ${chalk.cyan(env)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  // permission check
  const level = getMyLevel(repoRoot, env, identity)
  if (!level) {
    console.log(chalk.red(`  ✗ you don't have access to ${chalk.bold(env)}\n`))
    const config = readConfig(repoRoot)
    if (config) {
      const manageNames = readAllTokens(repoRoot, env)
        .filter(t => t.level === 'manage')
        .map(t => Object.entries(config.members).find(([, m]) => m.fingerprint === t.fingerprint)?.[0])
        .filter(Boolean)
      if (manageNames.length > 0) {
        console.log(`  ask ${chalk.bold(manageNames.join(' or '))} to grant you access first\n`)
      }
    }
    return
  }

  if (LEVELS[level] < LEVELS.write) {
    console.log(chalk.red(`  ✗ permission denied — you need write access on ${chalk.bold(env)}\n`))
    return
  }

  // resolve the .env file to read
  const filePath = options.file
    ? join(repoRoot, options.file)
    : join(repoRoot, `.env.${env}`)

  // fallback: try plain .env if .env.<env> doesn't exist and no --file given
  const fallbackPath = join(repoRoot, '.env')
  const resolvedPath = existsSync(filePath)
    ? filePath
    : (!options.file && existsSync(fallbackPath) ? fallbackPath : null)

  if (!resolvedPath) {
    const tried = options.file
      ? options.file
      : `.env.${env} (also tried .env)`
    console.log(chalk.red(`  ✗ file not found: ${tried}\n`))
    console.log(`  ${chalk.dim('specify a file explicitly with')} ${chalk.bold('--file <path>')}`)
    console.log(`  ${chalk.dim('e.g.')} envlock import --env ${env} --file .env.example\n`)
    return
  }

  const content = readFileSync(resolvedPath, 'utf8')
  const pairs   = parseEnvFile(content)

  if (pairs.length === 0) {
    console.log(chalk.yellow(`  ⚠  no key=value pairs found in ${resolvedPath}\n`))
    return
  }

  console.log(`  ${chalk.dim('reading')} ${resolvedPath}`)
  console.log(`  ${chalk.dim('found')} ${pairs.length} var${pairs.length !== 1 ? 's' : ''}\n`)

  // check which keys already exist
  const existingKeys = new Set(listKeys(repoRoot, env).map(k => k.key))

  const { default: Enquirer } = await import('enquirer')

  // multiselect — new keys pre-checked, existing keys unchecked with [exists] hint
  const { selected } = await new Enquirer().prompt({
    type:     'multiselect',
    name:     'selected',
    message:  `select vars to import into ${env}`,
    hint:     '(space to toggle, a to select all, enter to confirm)',
    choices:  pairs.map(({ key }) => ({
      name:    key,
      value:   key,
      hint:    existingKeys.has(key) ? chalk.yellow('exists — will overwrite') : '',
      enabled: !existingKeys.has(key), // new keys pre-checked, existing unchecked
    })),
  })
  console.log()

  if (!selected || selected.length === 0) {
    console.log(`  ${chalk.dim('nothing selected — import cancelled')}\n`)
    return
  }

  const toImport = pairs.filter(p => selected.includes(p.key))

  const tokenCount = readAllTokens(repoRoot, env).length
  const spinner    = ora(`encrypting ${toImport.length} var${toImport.length !== 1 ? 's' : ''} for ${tokenCount} member${tokenCount !== 1 ? 's' : ''}...`).start()

  let imported  = 0
  let failed    = 0

  for (const { key, value } of toImport) {
    try {
      setVar(repoRoot, env, key, value, identity)
      imported++
    } catch {
      failed++
      spinner.text = `encrypting... (failed: ${key})`
    }
  }

  if (failed === 0) {
    spinner.succeed(`imported ${imported} var${imported !== 1 ? 's' : ''} into ${chalk.cyan(env)}`)
  } else {
    spinner.warn(`imported ${imported}, failed ${failed}`)
  }

  console.log()
  for (const { key } of toImport) {
    const wasExisting = existingKeys.has(key)
    console.log(`  ${wasExisting ? chalk.yellow('~') : chalk.green('+')} ${key}${wasExisting ? chalk.dim(' (overwritten)') : ''}`)
  }
  console.log()
  console.log(`  ${chalk.dim('commit with:')} git add .envlock/envs/${env}/ && git commit -m "feat: import vars into ${env}"`)
  console.log()
}

// ── prompt version — used by setup after creating envs ───────────────────────

export async function promptImport(repoRoot, envs, identity) {
  const { existsSync, readFileSync } = await import('fs')
  const { join } = await import('path')
  const { default: Enquirer } = await import('enquirer')
  const { setVar, listKeys, readAllTokens } = await import('../config/lockfile.js')

  // find which .env files exist in the repo root
  const candidates = [
    ...envs.map(e => ({ env: e, file: `.env.${e}` })),
    { env: envs[0], file: '.env' },
  ].filter(({ file }) => existsSync(join(repoRoot, file)))

  if (candidates.length === 0) return

  console.log(`  ${chalk.dim('found existing env files:')}`)
  for (const { file } of candidates) {
    console.log(`    ${chalk.dim('–')} ${file}`)
  }
  console.log()

  const { doImport } = await new Enquirer().prompt({
    type:    'confirm',
    name:    'doImport',
    message: 'import vars from existing .env files now?',
    initial: true,
  })
  console.log()

  if (!doImport) {
    console.log(`  ${chalk.dim('skipped — run')} ${chalk.bold('envlock import --env <env>')} ${chalk.dim('any time to import later')}`)
    console.log()
    return
  }

  for (const { env, file } of candidates) {
    const filePath = join(repoRoot, file)
    const content  = readFileSync(filePath, 'utf8')
    const pairs    = parseEnvFile(content)

    if (pairs.length === 0) continue

    const tokenCount = readAllTokens(repoRoot, env).length
    const spinner    = ora(`importing ${file} → ${env} (${tokenCount} member${tokenCount !== 1 ? 's' : ''})...`).start()

    let imported = 0
    for (const { key, value } of pairs) {
      try {
        setVar(repoRoot, env, key, value, identity)
        imported++
      } catch {
        // skip dupes or errors silently in prompt mode
      }
    }

    spinner.succeed(`${file} → ${chalk.cyan(env)}: ${imported} var${imported !== 1 ? 's' : ''} imported`)
  }

  console.log()
}
