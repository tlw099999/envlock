import chalk from 'chalk'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig } from '../config/config.js'
import { readAllTokens, getMyLevel } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

export async function cmdMembers() {
  console.log(chalk.bold('\n  envlock members\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config  = readConfig(repoRoot)
  const members = Object.entries(config.members)

  if (members.length === 0) {
    console.log('  no members yet\n')
    return
  }

  // build a { fingerprint → { env → level } } map from token files
  const accessMap = {}
  for (const env of config.envs) {
    for (const token of readAllTokens(repoRoot, env)) {
      if (!accessMap[token.fingerprint]) accessMap[token.fingerprint] = {}
      accessMap[token.fingerprint][env] = token.level
    }
  }

  const LEVEL_COLOR = { manage: chalk.red, write: chalk.blue, read: chalk.green }
  const LEVEL_LABEL = { manage: 'manage', write: 'write ', read: 'read  ' }

  for (const [name, member] of members) {
    const isMe    = member.fingerprint === identity.fingerprint
    const nameStr = isMe ? chalk.bold(name) + chalk.dim(' (you)') : chalk.bold(name)
    const envAccess = accessMap[member.fingerprint] || {}

    console.log(`  ${nameStr}`)
    console.log(`  ${chalk.dim(member.fingerprint)}`)

    for (const env of config.envs) {
      const level = envAccess[env]
      if (level) {
        const colorFn = LEVEL_COLOR[level] || chalk.white
        console.log(`    ${chalk.dim(env.padEnd(12))} ${colorFn(LEVEL_LABEL[level] || level)}`)
      } else {
        console.log(`    ${chalk.dim(env.padEnd(12))} ${chalk.dim('no access')}`)
      }
    }
    console.log()
  }
}

export async function cmdWhoami() {
  console.log(chalk.bold('\n  envlock whoami\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  console.log(`  name         ${chalk.bold(identity.name)}`)
  console.log(`  fingerprint  ${chalk.cyan(identity.fingerprint)}`)
  console.log()

  try {
    const repoRoot = requireRepoRoot()
    requireEnvlockRepo(repoRoot)
    const config = readConfig(repoRoot)

    console.log(`  project      ${chalk.bold(config.project)}`)
    console.log()

    const member = config.members[identity.name]
    if (!member) {
      console.log(`  ${chalk.yellow('not a member of this repo')}`)
      console.log(`  run ${chalk.bold('envlock join')} to request access\n`)
      return
    }

    const LEVEL_COLOR = { manage: chalk.red, write: chalk.blue, read: chalk.green }
    console.log('  access:')
    for (const env of config.envs) {
      const level = getMyLevel(repoRoot, env, identity)
      if (level) {
        const colorFn = LEVEL_COLOR[level] || chalk.white
        console.log(`    ${chalk.dim(env.padEnd(12))} ${colorFn(level)}`)
      } else {
        console.log(`    ${chalk.dim(env.padEnd(12))} ${chalk.dim('no access')}`)
      }
    }
  } catch {
    // not in an envlock repo — just show identity
  }

  console.log()
}
