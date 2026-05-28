import chalk from 'chalk'
import ora   from 'ora'
import { loadIdentity }                       from '../crypto/keygen.js'
import { readConfig }                         from '../config/config.js'
import { readVarsLock, readAllTokens }        from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'
import { removeEnv }                          from '../operations/envs.js'

export async function cmdRemoveEnv(env) {
  console.log(chalk.bold(`\n  envlock remove-env → ${chalk.cyan(env)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n')); return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)
  const config = readConfig(repoRoot)

  if (!config.envs.includes(env)) {
    console.log(chalk.red(`  ✗ unknown environment: ${env}`))
    console.log(`  valid envs: ${config.envs.join(', ')}\n`)
    return
  }

  // show deletion summary before the prompts
  const lockData   = readVarsLock(repoRoot, env)
  const varCount   = Object.keys(lockData.vars || {}).length
  const tokenCount = readAllTokens(repoRoot, env).length

  console.log(`  ${chalk.yellow('⚠')}  this will permanently delete:`)
  console.log(`       ${tokenCount} access token${tokenCount !== 1 ? 's' : ''}`)
  console.log(`       ${varCount} encrypted var${varCount !== 1 ? 's' : ''} (all member copies)`)
  console.log(`       vars.lock`)
  console.log()
  console.log(`  ${chalk.red('this cannot be undone')} except via git revert`)
  console.log()

  const { default: Enquirer } = await import('enquirer')
  const enquirer = new Enquirer()

  const { confirm } = await enquirer.prompt({
    type:    'confirm',
    name:    'confirm',
    message: `remove the ${chalk.bold(env)} environment?`,
    initial: false,
  })
  console.log()

  if (!confirm) {
    console.log(`  ${chalk.dim('cancelled')}\n`); return
  }

  // extra type-to-confirm for prod / production
  if (env === 'prod' || env === 'production') {
    const { typed } = await enquirer.prompt({
      type:    'input',
      name:    'typed',
      message: `type "${env}" to confirm`,
    })
    console.log()
    if (typed.trim() !== env) {
      console.log(`  ${chalk.dim('cancelled — input did not match')}\n`); return
    }
  }

  const spinner = ora(`removing ${env}...`).start()

  try {
    removeEnv(repoRoot, identity, config, env)

    spinner.succeed(`${chalk.bold(env)} removed`)
    console.log()
    console.log(`  ${chalk.green('✓')} deleted ${chalk.dim(`.envlock/envs/${env}/`)}`)
    console.log(`  ${chalk.green('✓')} updated ${chalk.dim('config.json')}`)
    console.log(`  ${chalk.green('✓')} updated ${chalk.dim('.envlock/hooks/pre-commit')}`)
    console.log()
    console.log('  ' + chalk.dim('commit with:'))
    console.log('  ' + chalk.bold(`git add -A .envlock/ && git commit -m "chore: remove ${env} environment"`))
    console.log()
  } catch (err) {
    spinner.fail(err.message)
    console.log()
  }
}
