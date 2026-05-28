import chalk from 'chalk'
import ora   from 'ora'
import { loadIdentity }                    from '../crypto/keygen.js'
import { readConfig }                      from '../config/config.js'
import { readToken }                       from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'
import { addMember, syncMember, revokeMember } from '../operations/members.js'

// ── shared commit hint helpers ────────────────────────────────────────────────

function syncCommitHint(targetName) {
  return `git add .envlock/ && git commit -m "chore: sync keys for ${targetName}"`
}

function revokeCommitHint(targetName) {
  return `git add .envlock/ && git commit -m "chore: revoke ${targetName}"`
}

function printSkipped(targetName, skipped) {
  if (Object.keys(skipped).length === 0) return
  console.log(`  ${chalk.yellow('⚠')}  some vars were skipped — you don't have them in your blobs:`)
  for (const [env, keys] of Object.entries(skipped)) {
    console.log(`     ${chalk.cyan(env)}: ${keys.join(', ')}`)
  }
  console.log(`  another manage member should also run: ${chalk.bold(`envlock sync ${targetName}`)}`)
  console.log()
}

// ── envlock add-member ────────────────────────────────────────────────────────

export async function cmdAddMember(targetName, options) {
  // normalise to arrays — supports both single and repeated flags
  const envs     = [options.env    ?? []].flat().filter(Boolean)
  const accesses = [options.access ?? []].flat().filter(Boolean)

  if (envs.length === 0) {
    console.log(chalk.red('  ✗ --env is required\n')); return
  }
  if (accesses.length === 0) {
    console.log(chalk.red('  ✗ --access is required\n')); return
  }
  if (envs.length !== accesses.length) {
    console.log(chalk.red(
      `  ✗ ${envs.length} --env flag${envs.length !== 1 ? 's' : ''} but ` +
      `${accesses.length} --access flag${accesses.length !== 1 ? 's' : ''} — they must be paired`
    ))
    console.log()
    console.log(`  example:`)
    console.log(`    ${chalk.bold(`envlock add-member ${targetName} --env prod --access read --env dev --access write`)}`)
    console.log()
    return
  }

  const envAccess  = envs.map((env, i) => ({ env, access: accesses[i] }))
  const envSummary = envAccess.map(p => `${chalk.cyan(p.env)}:${chalk.bold(p.access)}`).join('  ')

  console.log(chalk.bold(`\n  envlock add-member → ${chalk.cyan(targetName)}\n`))
  console.log(`  ${envSummary}\n`)

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n')); return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)
  const config = readConfig(repoRoot)

  try {
    const { grantedEnvs } = addMember(repoRoot, identity, config, targetName, envAccess)
    for (const env of grantedEnvs) {
      const access = envAccess.find(p => p.env === env).access
      console.log(`  ${chalk.green('✓')} ${chalk.bold(targetName)} → ${chalk.cyan(env)}: ${chalk.bold(access)}`)
    }
    console.log()
  } catch (err) {
    console.log(chalk.red(`  ✗ ${err.message}\n`))
    return
  }

  // prompt to sync vars
  const { default: Enquirer } = await import('enquirer')
  const { syncNow } = await new Enquirer().prompt({
    type:    'confirm',
    name:    'syncNow',
    message: `sync vars for ${chalk.bold(targetName)} now?`,
    initial: true,
  })
  console.log()

  if (!syncNow) {
    console.log(
      `  ${chalk.dim('skipped — run')} ${chalk.bold(`envlock sync ${targetName}`)} ` +
      `${chalk.dim('when ready')}\n`
    )
    return
  }

  const spinner = ora(`syncing vars for ${targetName}...`).start()

  try {
    const { syncedEnvs, skipped } = syncMember(repoRoot, identity, config, targetName)

    if (syncedEnvs.length === 0) {
      spinner.warn(`no vars to sync yet — add some with ${chalk.bold('envlock add')}`)
      console.log()
      return
    }

    spinner.succeed(`${chalk.bold(targetName)} synced: ${chalk.cyan(syncedEnvs.join(', '))}`)
    console.log()
    printSkipped(targetName, skipped)
    console.log('  ' + chalk.dim('commit with:'))
    console.log('  ' + chalk.bold(syncCommitHint(targetName)))
    console.log()
  } catch (err) {
    spinner.fail(`sync failed: ${err.message}`)
    throw err
  }
}

// ── envlock sync ──────────────────────────────────────────────────────────────

export async function cmdSync(targetName) {
  console.log(chalk.bold(`\n  envlock sync → ${chalk.cyan(targetName)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n')); return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)
  const config = readConfig(repoRoot)

  if (!config.members[targetName]) {
    console.log(chalk.red(`  ✗ "${targetName}" is not a member of this repo\n`))
    console.log(`  run ${chalk.bold('envlock members')} to see all members\n`)
    return
  }

  const targetMember = config.members[targetName]
  const hasAnyToken  = config.envs.some(env => readToken(repoRoot, env, targetMember.fingerprint))
  if (!hasAnyToken) {
    console.log(chalk.yellow(`  ⚠  ${targetName} has no env access yet`))
    console.log(`  grant access first: ${chalk.bold(`envlock add-member ${targetName} --env <env> --access read`)}\n`)
    return
  }

  const spinner = ora(`syncing vars for ${targetName}...`).start()

  try {
    const { syncedEnvs, skipped } = syncMember(repoRoot, identity, config, targetName)

    if (syncedEnvs.length === 0) {
      spinner.warn(`no envs where you have manage access over ${targetName}`)
      console.log()
      return
    }

    spinner.succeed(`${chalk.bold(targetName)} synced: ${chalk.cyan(syncedEnvs.join(', '))}`)
    console.log()
    printSkipped(targetName, skipped)
    console.log('  ' + chalk.dim('commit with:'))
    console.log('  ' + chalk.bold(syncCommitHint(targetName)))
    console.log()
  } catch (err) {
    spinner.fail(`sync failed: ${err.message}`)
    throw err
  }
}

// ── envlock revoke ────────────────────────────────────────────────────────────

export async function cmdRevoke(targetName, options) {
  console.log(chalk.bold(`\n  envlock revoke → ${chalk.cyan(targetName)}\n`))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n')); return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)
  const config = readConfig(repoRoot)

  if (!config.members[targetName]) {
    console.log(chalk.red(`  ✗ "${targetName}" is not a member\n`)); return
  }

  // resolve which envs to revoke from
  let targetEnvs
  const targetMember = config.members[targetName]

  if (options.allEnvs) {
    targetEnvs = config.envs.filter(env => readToken(repoRoot, env, targetMember.fingerprint))
    if (targetEnvs.length === 0) {
      console.log(chalk.yellow(`  ⚠  ${targetName} has no active tokens to revoke\n`)); return
    }
    console.log(`  revoking from all envs: ${chalk.cyan(targetEnvs.join(', '))}\n`)
  } else {
    targetEnvs = [options.env ?? []].flat().filter(Boolean)
    if (targetEnvs.length === 0) {
      console.log(chalk.red('  ✗ specify --env <env> or use --all-envs\n')); return
    }
  }

  const spinner = ora(`revoking ${targetName}...`).start()

  try {
    const { revokedEnvs } = revokeMember(repoRoot, identity, config, targetName, targetEnvs)

    spinner.succeed(
      revokedEnvs.length === 1
        ? `${chalk.bold(targetName)} revoked from ${chalk.cyan(revokedEnvs[0])}`
        : `${chalk.bold(targetName)} revoked from ${chalk.cyan(revokedEnvs.join(', '))}`
    )
    console.log()
    console.log(`  ${chalk.dim('their existing .env files still work until they pull')}`)
    console.log()
    console.log('  ' + chalk.dim('commit with:'))
    console.log('  ' + chalk.bold(revokeCommitHint(targetName)))
    console.log()
  } catch (err) {
    spinner.fail(err.message)
    console.log()
  }
}
