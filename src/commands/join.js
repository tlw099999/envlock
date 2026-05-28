import chalk from 'chalk'
import ora from 'ora'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig, writeConfig, keysDir } from '../config/config.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'
import { promptInstallHooks } from './installHooks.js'

export async function cmdJoin() {
  console.log(chalk.bold('\n  envlock join\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config = readConfig(repoRoot)

  // check if already a member
  const existing = Object.values(config.members)
    .find(m => m.fingerprint === identity.fingerprint)

  if (existing) {
    console.log(chalk.yellow('  ⚠  you are already a member of this repo\n'))
    console.log(`  run ${chalk.bold('envlock whoami')} to see your access\n`)
    return
  }

  const spinner = ora('adding your public key to repo...').start()

  try {
    // copy public key into repo
    writeFileSync(
      join(keysDir(repoRoot), `${identity.fingerprint}.pub`),
      JSON.stringify({ name: identity.name, fingerprint: identity.fingerprint, publicKey: identity.publicKey }, null, 2) + '\n'
    )

    // add to config with no access yet (pending token writes from a manage member)
    config.members[identity.name] = {
      fingerprint: identity.fingerprint,
      publicKey:   identity.publicKey,
      pending:     true,
    }
    writeConfig(repoRoot, config)

    spinner.succeed('public key added')

    console.log()
    console.log(`  ${chalk.green('✓')} your public key is now in ${chalk.dim('.envlock/keys/')}`)
    console.log(`  ${chalk.yellow('⏳')} pending — you have no env access yet`)
    console.log()

    // find manage members from token files across all envs
    const manageMembers = []
    for (const env of config.envs) {
      const { readAllTokens } = await import('../config/lockfile.js')
      const tokens = readAllTokens(repoRoot, env)
      for (const t of tokens) {
        if (t.level === 'manage' && !manageMembers.includes(t.fingerprint)) {
          manageMembers.push(t.fingerprint)
        }
      }
    }

    const manageNames = manageMembers
      .map(fp => Object.entries(config.members).find(([, m]) => m.fingerprint === fp)?.[0])
      .filter(Boolean)

    if (manageNames.length > 0) {
      console.log(`  ask ${chalk.bold(manageNames.join(' or '))} to run:`)
      console.log(`  ${chalk.bold(`envlock add-member ${identity.name} --env <env> --access <level>`)}`)
      console.log(`  ${chalk.dim('(it will prompt to sync your vars automatically)')}`)
    }

    console.log()
    console.log('  ' + chalk.dim('commit your public key:'))
    console.log('  ' + chalk.bold(`git add .envlock/ && git commit -m "chore: ${identity.name} joins envlock"`))
    console.log()

  } catch (err) {
    spinner.fail('failed to join')
    throw err
  }

  // prompt to install hooks (after spinner is done)
  await promptInstallHooks(repoRoot)
}
