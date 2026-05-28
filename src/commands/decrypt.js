import chalk from 'chalk'
import ora from 'ora'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig } from '../config/config.js'
import { decryptAll, getMyLevel, readAllTokens } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

export async function cmdDecrypt(options) {
  const envs       = Array.isArray(options.env) ? options.env : [options.env]
  const outputPath = options.output ?? null

  console.log(chalk.bold(`\n  envlock decrypt → ${chalk.cyan(envs.join(', '))}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config     = readConfig(repoRoot)
  const mergedVars = outputPath ? {} : null

  for (const env of envs) {
    if (!config.envs.includes(env)) {
      console.log(chalk.red(`  ✗ unknown environment: ${env}`))
      console.log(`    valid envs: ${config.envs.join(', ')}\n`)
      continue
    }

    const level = getMyLevel(repoRoot, env, identity)
    if (!level) {
      console.log(chalk.red(`  ✗ you don't have access to ${chalk.bold(env)}`))
      const manageNames = readAllTokens(repoRoot, env)
        .filter(t => t.level === 'manage')
        .map(t => Object.entries(config.members).find(([, m]) => m.fingerprint === t.fingerprint)?.[0])
        .filter(Boolean)
      if (manageNames.length > 0) {
        console.log(`    ask ${chalk.bold(manageNames.join(' or '))} to run: envlock sync ${identity.name}`)
      }
      console.log()
      continue
    }

    const spinner = ora(`decrypting ${env}...`).start()

    try {
      const vars  = decryptAll(repoRoot, env, identity)
      const count = Object.keys(vars).length

      if (count === 0) {
        spinner.warn(`${env} has no variables yet`)
        continue
      }

      if (outputPath) {
        Object.assign(mergedVars, vars)
        spinner.succeed(`${chalk.green(count)} vars from ${chalk.cyan(env)} collected`)
      } else {
        const envFilePath = join(repoRoot, `.env.${env}`)
        writeFileSync(envFilePath, buildEnvFile(vars, env), { mode: 0o600 })
        spinner.succeed(`${chalk.green(count)} vars written to ${chalk.dim(`.env.${env}`)}`)
      }

    } catch (err) {
      spinner.fail(`failed to decrypt ${env}: ${err.message}`)
    }
  }

  if (outputPath && mergedVars && Object.keys(mergedVars).length > 0) {
    const count = Object.keys(mergedVars).length
    writeFileSync(join(repoRoot, outputPath), buildEnvFile(mergedVars, envs.join('+')), { mode: 0o600 })
    console.log()
    console.log(`  ${chalk.green('✓')} ${chalk.green(count)} vars written to ${chalk.dim(outputPath)}`)
  }

  console.log()
}

function buildEnvFile(vars, label) {
  return [
    `# envlock — decrypted ${label} vars`,
    `# generated: ${new Date().toISOString()}`,
    `# DO NOT COMMIT THIS FILE`,
    '',
    ...Object.entries(vars).map(([k, v]) => `${k}=${v}`),
  ].join('\n') + '\n'
}

export async function cmdReveal(key, options) {
  const env = options.env
  console.log(chalk.bold(`\n  envlock reveal → ${chalk.cyan(env)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const spinner = ora(`decrypting ${key}...`).start()

  try {
    const vars = decryptAll(repoRoot, env, identity)

    if (!vars[key]) {
      spinner.fail(`"${key}" not found in ${env} or you don't have access`)
      return
    }

    spinner.stop()
    console.log(`  ${chalk.bold(key)}=${chalk.green(vars[key])}`)
    console.log()
    console.log(chalk.dim('  clearing in 10 seconds...'))

    setTimeout(() => {
      process.stdout.write('\x1B[2A\x1B[2K')
      process.stdout.write(`  ${chalk.bold(key)}=${chalk.dim('[cleared]')}\n\n`)
    }, 10000)

  } catch (err) {
    spinner.fail(`failed: ${err.message}`)
  }
}
