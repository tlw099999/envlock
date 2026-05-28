import chalk from 'chalk'
import ora from 'ora'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig } from '../config/config.js'
import { setVar, removeVar, listKeys, getMyLevel, readAllTokens } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

const LEVELS = { read: 1, write: 2, manage: 3 }

export async function cmdAdd(assignment, options) {
  const env = options.env
  console.log(chalk.bold(`\n  envlock add → ${chalk.cyan(env)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  // parse KEY=VALUE — split on first = only so values can contain =
  const eqIndex = assignment.indexOf('=')
  if (eqIndex === -1) {
    console.log(chalk.red('  ✗ invalid format — use KEY=VALUE\n'))
    return
  }
  const key   = assignment.slice(0, eqIndex).trim()
  const value = assignment.slice(eqIndex + 1).trim()

  if (!key) {
    console.log(chalk.red('  ✗ key cannot be empty\n'))
    return
  }

  // verify write permission via own token proof
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
        console.log(`  ask ${chalk.bold(manageNames.join(' or '))} to run: envlock sync ${identity.name}\n`)
      }
    }
    return
  }

  if (LEVELS[level] < LEVELS.write) {
    console.log(chalk.red(`  ✗ permission denied — you need write access on ${chalk.bold(env)}\n`))
    return
  }

  // guard: add errors if key already exists, update errors if it doesn't
  const existing = listKeys(repoRoot, env)
  if (options.add && existing.find(k => k.key === key)) {
    console.log(chalk.yellow(`  ⚠  "${key}" already exists in ${env}`))
    console.log(`  use ${chalk.bold(`envlock update ${assignment} --env ${env}`)} to update it\n`)
    return
  }

  const tokenCount = readAllTokens(repoRoot, env).length
  const spinner    = ora(`encrypting for ${tokenCount} member${tokenCount !== 1 ? 's' : ''}...`).start()

  try {
    setVar(repoRoot, env, key, value, identity)
    spinner.succeed(`${chalk.green(key)} added to ${chalk.cyan(env)}`)
    console.log()
    console.log(`  ${chalk.dim('commit with:')} git add .envlock/envs/${env}/ && git commit -m "feat: add ${key} to ${env}"`)
    console.log()
  } catch (err) {
    spinner.fail('failed to add variable')
    throw err
  }
}

export async function cmdUpdate(assignment, options) {
  const env = options.env
  const key = assignment.split('=')[0].trim()

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const existing = listKeys(repoRoot, env)
  if (!existing.find(k => k.key === key)) {
    console.log(chalk.red(`\n  ✗ "${key}" does not exist in ${env}`))
    console.log(`  use ${chalk.bold(`envlock add ${assignment} --env ${env}`)} to add it\n`)
    return
  }

  await cmdAdd(assignment, { ...options, add: false })
}

export async function cmdRemove(key, options) {
  const env = options.env
  console.log(chalk.bold(`\n  envlock remove → ${chalk.cyan(env)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const level = getMyLevel(repoRoot, env, identity)
  if (!level || LEVELS[level] < LEVELS.write) {
    console.log(chalk.red(`  ✗ permission denied — you need write access on ${chalk.bold(env)}\n`))
    return
  }

  try {
    removeVar(repoRoot, env, key)
    console.log(`  ${chalk.green('✓')} removed ${chalk.bold(key)} from ${chalk.cyan(env)}\n`)
    console.log(`  ${chalk.dim('commit with:')} git add .envlock/envs/${env}/ && git commit -m "chore: remove ${key} from ${env}"`)
    console.log()
  } catch (err) {
    console.log(chalk.red(`  ✗ ${err.message}\n`))
  }
}
