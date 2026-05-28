import chalk from 'chalk'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig, fingerprintToName } from '../config/config.js'
import { listKeys, getMyLevel } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo, timeAgo } from '../utils/repo.js'

export async function cmdList(options) {
  const env = options.env
  console.log(chalk.bold(`\n  envlock list → ${chalk.cyan(env)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config = readConfig(repoRoot)
  if (!config.envs.includes(env)) {
    console.log(chalk.red(`  ✗ unknown environment: ${env}`))
    console.log(`  valid envs: ${config.envs.join(', ')}\n`)
    return
  }

  const level = getMyLevel(repoRoot, env, identity)
  if (!level) {
    console.log(chalk.red(`  ✗ you don't have access to ${chalk.bold(env)}\n`))
    return
  }

  const keys = listKeys(repoRoot, env)

  if (keys.length === 0) {
    console.log(`  ${chalk.dim('no variables in')} ${env} ${chalk.dim('yet')}`)
    console.log(`  add one: ${chalk.bold(`envlock add KEY=value --env ${env}`)}\n`)
    return
  }

  const maxKeyLen = Math.max(...keys.map(k => k.key.length))

  console.log(`  ${chalk.dim('KEY'.padEnd(maxKeyLen + 2))}  ${'ADDED BY'.padEnd(14)}  WHEN`)
  console.log('  ' + chalk.dim('─'.repeat(maxKeyLen + 35)))

  for (const { key, by, at } of keys) {
    const name = fingerprintToName(config, by)
    console.log(
      `  ${chalk.bold(key.padEnd(maxKeyLen + 2))}  ${chalk.dim(name.padEnd(14))}  ${chalk.dim(timeAgo(at))}`
    )
  }

  console.log()
  console.log(`  ${chalk.dim(keys.length + ' variable' + (keys.length !== 1 ? 's' : ''))}`)
  console.log()
}
