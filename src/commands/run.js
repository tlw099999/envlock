import { spawn } from 'child_process'
import chalk from 'chalk'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig } from '../config/config.js'
import { getMyLevel, decryptAll } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

// ── envlock run ───────────────────────────────────────────────────────────────
//
// Decrypt an environment's vars and inject them into a child process.
//
// Usage:
//   envlock run --env dev node server.js
//   envlock run --env staging -- npm run build --watch

export async function cmdRun(cmdArgs, options) {
  const env = options.env

  if (!cmdArgs || cmdArgs.length === 0) {
    console.log(chalk.red('  ✗ no command given'))
    console.log(`    usage: envlock run --env ${env} <command> [args...]\n`)
    return
  }

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
    console.log(chalk.red(`  ✗ you don't have access to ${chalk.bold(env)}`))
    console.log(`  ask a manage member to run: envlock add-member ${identity.name} --env ${env} --access read\n`)
    return
  }

  // decrypt all vars for this env
  let vars
  try {
    vars = decryptAll(repoRoot, env, identity)
  } catch (err) {
    console.log(chalk.red(`  ✗ failed to decrypt vars for ${env}: ${err.message}\n`))
    return
  }

  const varCount = Object.keys(vars).length

  // print a brief banner so the user knows envlock injected vars
  process.stderr.write(
    chalk.dim(`  envlock: injecting ${varCount} var${varCount !== 1 ? 's' : ''} from ${env}\n\n`)
  )

  const [cmd, ...args] = cmdArgs

  const child = spawn(cmd, args, {
    env:   { ...process.env, ...vars },
    stdio: 'inherit',
    shell: false,
  })

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(chalk.red(`\n  ✗ command not found: ${cmd}\n`))
    } else {
      console.error(chalk.red(`\n  ✗ failed to start process: ${err.message}\n`))
    }
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      // child was killed by a signal — re-raise so the parent exits the same way
      process.kill(process.pid, signal)
    } else {
      process.exit(code ?? 0)
    }
  })
}
