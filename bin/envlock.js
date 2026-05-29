#!/usr/bin/env node

import { program } from 'commander'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))

program
  .name('envlock')
  .description('secure encrypted env var sharing for teams')
  .version(pkg.version)
  .enablePositionalOptions()

// ─── setup ────────────────────────────────────────────────────────────

program
  .command('init')
  .description('generate your personal keypair (run once per machine)')
  .option('-f, --force', 'overwrite existing keypair')
  .action(async (opts) => {
    const { cmdInit } = await import('../src/commands/init.js')
    await handle(cmdInit, opts)
  })

program
  .command('setup')
  .description('initialise envlock in this repo (run once per repo)')
  .action(async () => {
    const { cmdSetup } = await import('../src/commands/setup.js')
    await handle(cmdSetup)
  })

// ─── members ──────────────────────────────────────────────────────────

program
  .command('join')
  .description('join an envlock repo (adds your public key)')
  .action(async () => {
    const { cmdJoin } = await import('../src/commands/join.js')
    await handle(cmdJoin)
  })

program
  .command('members')
  .description('list all members and their permissions')
  .action(async () => {
    const { cmdMembers } = await import('../src/commands/members.js')
    await handle(cmdMembers)
  })

program
  .command('whoami')
  .description('show your identity and access in this repo')
  .action(async () => {
    const { cmdWhoami } = await import('../src/commands/members.js')
    await handle(cmdWhoami)
  })

program
  .command('status')
  .description('show your personal access and blob health across all envs')
  .action(async () => {
    const { cmdStatus } = await import('../src/commands/status.js')
    await handle(cmdStatus)
  })

program
  .command('add-member <name>')
  .description('grant a member access to one or more environments')
  .option('--env <env>',    'environment (repeat to add multiple)', (v, a) => [...(a ?? []), v])
  .option('--access <lvl>', 'access level: read, write, manage (paired with each --env)', (v, a) => [...(a ?? []), v])
  .action(async (name, opts) => {
    const { cmdAddMember } = await import('../src/commands/rewrap.js')
    await handle(() => cmdAddMember(name, opts))
  })

program
  .command('revoke <name>')
  .description('remove a member\'s access (one env, multiple, or all)')
  .option('--env <env>',  'environment (repeat for multiple)', (v, a) => [...(a ?? []), v])
  .option('--all-envs',   'revoke from every environment they have access to')
  .action(async (name, opts) => {
    const { cmdRevoke } = await import('../src/commands/rewrap.js')
    await handle(() => cmdRevoke(name, opts))
  })

program
  .command('sync <name>')
  .description('encrypt all current vars for a member across every env they have access to')
  .action(async (name) => {
    const { cmdSync } = await import('../src/commands/rewrap.js')
    await handle(() => cmdSync(name))
  })

// ─── variables ────────────────────────────────────────────────────────

program
  .command('import')
  .description('import vars from an existing .env file into an environment')
  .requiredOption('--env <env>', 'environment name')
  .option('--file <path>', 'path to .env file (default: .env.<env>)')
  .action(async (opts) => {
    const { cmdImport } = await import('../src/commands/import.js')
    await handle(() => cmdImport(opts))
  })

program
  .command('add <KEY=VALUE>')
  .description('add a new env var')
  .requiredOption('--env <env>', 'environment name')
  .action(async (assignment, opts) => {
    const { cmdAdd } = await import('../src/commands/add.js')
    await handle(() => cmdAdd(assignment, { ...opts, add: true }))
  })

program
  .command('update <KEY=VALUE>')
  .description('update an existing env var')
  .requiredOption('--env <env>', 'environment name')
  .action(async (assignment, opts) => {
    const { cmdUpdate } = await import('../src/commands/add.js')
    await handle(() => cmdUpdate(assignment, opts))
  })

program
  .command('remove <KEY>')
  .description('remove an env var')
  .requiredOption('--env <env>', 'environment name')
  .action(async (key, opts) => {
    const { cmdRemove } = await import('../src/commands/add.js')
    await handle(() => cmdRemove(key, opts))
  })

program
  .command('list')
  .description('list all var names in an environment')
  .requiredOption('--env <env>', 'environment name')
  .action(async (opts) => {
    const { cmdList } = await import('../src/commands/list.js')
    await handle(() => cmdList(opts))
  })

program
  .command('decrypt')
  .description('decrypt vars to a local .env file')
  .option('--env <env...>', 'environment name(s)')
  .option('--output <path>', 'write to this file instead of .env.<env>')
  .action(async (opts) => {
    const { cmdDecrypt } = await import('../src/commands/decrypt.js')
    await handle(() => cmdDecrypt(opts))
  })

program
  .command('reveal <KEY>')
  .description('show a single var value in terminal (clears after 10s)')
  .requiredOption('--env <env>', 'environment name')
  .action(async (key, opts) => {
    const { cmdReveal } = await import('../src/commands/decrypt.js')
    await handle(() => cmdReveal(key, opts))
  })

// ─── env management ───────────────────────────────────────────────────

program
  .command('remove-env <env>')
  .description('permanently remove an environment and all its encrypted vars')
  .action(async (env) => {
    const { cmdRemoveEnv } = await import('../src/commands/removeEnv.js')
    await handle(() => cmdRemoveEnv(env))
  })

// ─── hooks ────────────────────────────────────────────────────────────

program
  .command('install-hooks')
  .description('install git hooks that call .envlock/hooks/ scripts')
  .option('-f, --force', 'reinstall even if already installed')
  .action(async (opts) => {
    const { cmdInstallHooks } = await import('../src/commands/installHooks.js')
    await handle(() => cmdInstallHooks(opts))
  })

program
  .command('install-ci')
  .description('add the envlock GitHub Actions CI workflow to this repo')
  .option('-f, --force', 'overwrite if already exists')
  .action(async (opts) => {
    const { cmdInstallCi } = await import('../src/commands/ci.js')
    await handle(() => cmdInstallCi(opts))
  })

program
  .command('init-ci')
  .description('create a dedicated CI identity and display its secrets securely')
  .option('--force', 'regenerate even if CI identity already exists')
  .option('--no-open', 'skip browser, use terminal fallback')
  .option('-p, --port <port>', 'port for the setup browser page', '7778')
  .action(async (opts) => {
    const { cmdInitCi } = await import('../src/commands/initCi.js')
    await handle(() => cmdInitCi(opts))
  })

// ─── key rotation ─────────────────────────────────────────────────────

program
  .command('rotate')
  .description('rotate your keypair and re-encrypt all your var blobs')
  .action(async () => {
    const { cmdRotate } = await import('../src/commands/rotate.js')
    await handle(cmdRotate)
  })

// ─── run ──────────────────────────────────────────────────────────────

program
  .command('run')
  .description('run a command with decrypted env vars injected')
  .requiredOption('--env <env>', 'environment name')
  .argument('<cmd...>', 'command and args (prefix with -- if they contain flags)')
  .passThroughOptions(true)
  .action(async (cmd, opts) => {
    const { cmdRun } = await import('../src/commands/run.js')
    await handle(() => cmdRun(cmd, opts))
  })

// ─── ui ───────────────────────────────────────────────────────────────

program
  .command('ui')
  .description('open the local dashboard in your browser')
  .option('-p, --port <port>', 'port to listen on', '7777')
  .option('--no-open', 'print the URL but do not open the browser')
  .option('--rebuild', 'force rebuild the UI (use after envlock updates)')
  .action(async (opts) => {
    const { cmdUi } = await import('../src/commands/ui.js')
    await handle(() => cmdUi(opts))
  })

// ─── audit ────────────────────────────────────────────────────────────

program
  .command('verify')
  .description('check integrity of all lock files and keys')
  .action(async () => {
    const { cmdVerify } = await import('../src/commands/verify.js')
    await handle(cmdVerify)
  })

program
  .command('log')
  .description('show change history for an environment')
  .requiredOption('--env <env>', 'environment name')
  .action(async (opts) => {
    const { cmdLog } = await import('../src/commands/log.js')
    await handle(() => cmdLog(opts))
  })

program
  .command('diff')
  .description('show what changed in the last commit for an environment')
  .requiredOption('--env <env>', 'environment name')
  .action(async (opts) => {
    const { cmdDiff } = await import('../src/commands/log.js')
    await handle(() => cmdDiff(opts))
  })

// ─── global error handler ─────────────────────────────────────────────

async function handle(fn, ...args) {
  try {
    await fn(...args)
  } catch (err) {
    console.error(`\n  ${chalk.red('✗')} ${err.message}\n`)
    process.exit(1)
  }
}

program.parse()
