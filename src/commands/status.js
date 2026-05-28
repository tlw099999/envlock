import chalk from 'chalk'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig } from '../config/config.js'
import { readToken, getMyLevel, readVarsLock } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

// ── envlock status ────────────────────────────────────────────────────────────
//
// Quick personal health-check: which envs you have access to, your level on each,
// and whether all your var blobs are present (or if a rewrap is needed).
//
// Unlike `envlock verify`, this only checks YOUR access — fast and personal.

const LEVEL_COLOR = {
  manage: chalk.magenta,
  write:  chalk.yellow,
  read:   chalk.cyan,
}

export async function cmdStatus() {
  console.log(chalk.bold('\n  envlock status\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config = readConfig(repoRoot)

  // find yourself in config by fingerprint (name could have changed)
  const memberEntry = Object.entries(config.members)
    .find(([, m]) => m.fingerprint === identity.fingerprint)
  const memberName = memberEntry?.[0]

  // identity line
  console.log(
    `  ${chalk.dim('identity')}   ${chalk.bold(memberName ?? identity.name)}` +
    `  ${chalk.dim(identity.fingerprint)}`
  )
  console.log()

  // not in the repo at all
  if (!memberName) {
    console.log(`  ${chalk.yellow('⚠')}  you are not a member of this repo`)
    console.log(`     run ${chalk.bold('envlock join')} to request access\n`)
    return
  }

  // joined but pending (no tokens yet)
  const isPending = config.members[memberName]?.pending === true
  if (isPending) {
    console.log(`  ${chalk.yellow('⏳')} pending — you have joined but haven't been granted access yet`)
    console.log()
    console.log(`  ask a manage member to run:`)
    console.log(`    ${chalk.bold(`envlock add-member ${memberName} --env <env> --access read`)}`)
    console.log(`    ${chalk.bold(`envlock sync ${memberName}`)}`)
    console.log()
    return
  }

  // per-env breakdown
  let needsRewrap = false
  const envColWidth = Math.max(...config.envs.map(e => e.length), 6)

  for (const env of config.envs) {
    const envLabel  = chalk.bold(env.padEnd(envColWidth))
    const token     = readToken(repoRoot, env, identity.fingerprint)

    if (!token) {
      console.log(`  ${chalk.dim('–')}  ${envLabel}  ${chalk.dim('no access')}`)
      continue
    }

    // verify proof (tamper detection)
    const verifiedLevel = getMyLevel(repoRoot, env, identity)
    if (!verifiedLevel) {
      console.log(`  ${chalk.red('✗')}  ${envLabel}  ${chalk.red('token proof invalid — file may be tampered')}`)
      needsRewrap = true
      continue
    }

    const levelStr  = (LEVEL_COLOR[verifiedLevel] ?? chalk.white)(verifiedLevel.padEnd(7))

    // count blobs
    const lockData   = readVarsLock(repoRoot, env)
    const allKeys    = Object.keys(lockData.vars || {})
    const myBlobKeys = allKeys.filter(k => lockData.vars[k]?.blobs?.[identity.fingerprint])
    const total      = allKeys.length
    const have       = myBlobKeys.length

    if (total === 0) {
      console.log(`  ${chalk.green('✓')}  ${envLabel}  ${levelStr}  ${chalk.dim('no vars yet')}`)
    } else if (have === total) {
      console.log(`  ${chalk.green('✓')}  ${envLabel}  ${levelStr}  ${chalk.dim(`${total} var${total !== 1 ? 's' : ''}  ✓`)}`)
    } else {
      needsRewrap = true
      const missing = total - have
      console.log(
        `  ${chalk.yellow('⚠')}  ${envLabel}  ${levelStr}  ` +
        `${chalk.yellow(`${have}/${total} vars`)}  ` +
        `${chalk.dim(`${missing} missing blob${missing !== 1 ? 's' : ''}`)}`
      )
    }
  }

  console.log()

  if (needsRewrap) {
    console.log(
      `  ${chalk.yellow('⚠')}  some vars are missing — ask a manage member to run:\n` +
      `     ${chalk.bold(`envlock sync ${memberName}`)}\n`
    )
  }
}
