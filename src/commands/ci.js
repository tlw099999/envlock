import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { findRepoRoot } from '../utils/repo.js'

// ── CI workflow template ──────────────────────────────────────────────────────
// Embedded as a string so it's always available regardless of install method.
// Written verbatim to .github/workflows/envlock-verify.yml in the user's repo.

export const CI_WORKFLOW = `# envlock integrity check
#
# Runs envlock verify on every push and PR.
# Exits 1 (blocks merge) if any token file or var blob is missing or tampered.
#
# Common failures and fixes:
#   "missing blob for <member> on <key>"  → run: envlock sync <member>
#   "missing token for <member>"          → run: envlock add-member <member> --env <env> --access read
#   "tampered token: <member>"            → restore the .token file from git
#
# No secrets needed — envlock verify only checks structure and coverage, not values.

name: envlock verify

on:
  push:
    branches: ["**"]
  pull_request:
    branches: ["**"]

jobs:
  verify:
    name: Verify envlock integrity
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - name: Install envlock
        run: npm install -g envlock

      - name: Verify envlock integrity
        run: envlock verify
`

// ── core install function ─────────────────────────────────────────────────────

/**
 * Write the CI workflow file to <repoRoot>/.github/workflows/envlock-verify.yml
 * Returns 'installed' | 'already' | 'overwritten'
 */
export function installCi(repoRoot, options = {}) {
  const workflowsDir  = join(repoRoot, '.github', 'workflows')
  const workflowPath  = join(workflowsDir, 'envlock-verify.yml')

  const alreadyExists = existsSync(workflowPath)
  if (alreadyExists && !options.force) return 'already'

  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(workflowPath, CI_WORKFLOW)

  return alreadyExists ? 'overwritten' : 'installed'
}

// ── envlock install-ci command ────────────────────────────────────────────────

export async function cmdInstallCi(options = {}) {
  const repoRoot = findRepoRoot()
  if (!repoRoot) {
    console.log(chalk.red('  ✗ not inside a git repository\n'))
    return
  }

  console.log(chalk.bold('\n  envlock install-ci\n'))

  const workflowPath = join(repoRoot, '.github', 'workflows', 'envlock-verify.yml')

  if (existsSync(workflowPath) && !options.force) {
    console.log(`  ${chalk.dim('–')}  .github/workflows/envlock-verify.yml already exists`)
    console.log(`       run with ${chalk.bold('--force')} to overwrite\n`)
    return
  }

  const status = installCi(repoRoot, options)

  if (status === 'overwritten') {
    console.log(`  ${chalk.green('✓')}  .github/workflows/envlock-verify.yml — overwritten`)
  } else {
    console.log(`  ${chalk.green('✓')}  .github/workflows/envlock-verify.yml — created`)
  }

  console.log()
  console.log(`  ${chalk.dim('commit it to enable the check on every PR:')}`)
  console.log(`  ${chalk.bold('git add .github/workflows/envlock-verify.yml && git commit -m "ci: add envlock verify"')}`)
  console.log()
}

// ── prompt version — used by setup ───────────────────────────────────────────

export async function promptInstallCi(repoRoot) {
  const workflowPath = join(repoRoot, '.github', 'workflows', 'envlock-verify.yml')

  if (existsSync(workflowPath)) {
    console.log(`  ${chalk.dim('–')}  envlock CI workflow already present`)
    console.log()
    return
  }

  console.log(`  envlock can add a GitHub Actions workflow to your repo:`)
  console.log(`    ${chalk.dim('envlock-verify.yml')} — blocks PRs when tokens or blobs are missing`)
  console.log()

  const { default: Enquirer } = await import('enquirer')
  const { install } = await new Enquirer().prompt({
    type:    'confirm',
    name:    'install',
    message: 'add GitHub Actions CI workflow? (.github/workflows/envlock-verify.yml)',
    initial: true,
  })

  console.log()

  if (install) {
    const status = installCi(repoRoot)
    if (status === 'installed') {
      console.log(`  ${chalk.green('✓')}  .github/workflows/envlock-verify.yml — created`)
      console.log()
      console.log(`  ${chalk.dim('commit it:')} ${chalk.bold('git add .github/ && git commit -m "ci: add envlock verify"')}`)
    }
  } else {
    console.log(`  ${chalk.dim('skipped — run')} ${chalk.bold('envlock install-ci')} ${chalk.dim('any time to add it later')}`)
  }

  console.log()
}
