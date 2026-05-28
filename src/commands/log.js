import chalk from 'chalk'
import { loadIdentity } from '../crypto/keygen.js'
import { readConfig, ENVLOCK_FOLDER } from '../config/config.js'
import { requireRepoRoot, requireEnvlockRepo, timeAgo, gitFile } from '../utils/repo.js'

// relative path of vars.lock inside the repo — used for git show
function varsLockRelPath(env) {
  return `${ENVLOCK_FOLDER}/envs/${env}/vars.lock`
}

// fetch vars.lock JSON at a specific git ref — null if not found
function getVarsLockAt(repoRoot, ref, env) {
  try {
    return JSON.parse(gitFile(repoRoot, 'show', `${ref}:${varsLockRelPath(env)}`))
  } catch {
    return null
  }
}

// true if any fingerprint's blob changed between two blobs maps
function blobsChanged(prevBlobs = {}, currBlobs = {}) {
  const fps = new Set([...Object.keys(prevBlobs), ...Object.keys(currBlobs)])
  for (const fp of fps) {
    if (prevBlobs[fp] !== currBlobs[fp]) return true
  }
  return false
}

function nameForFp(config, fp) {
  for (const [name, member] of Object.entries(config.members)) {
    if (member.fingerprint === fp) return name
  }
  return fp.slice(0, 8) + '...'
}

// ── envlock log ───────────────────────────────────────────────────────────────

export async function cmdLog(options) {
  const env = options.env
  console.log(chalk.bold(`\n  envlock log → ${chalk.cyan(env)}\n`))

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

  const SEP = '\x1f'
  let logOutput
  try {
    logOutput = gitFile(
      repoRoot,
      'log', '--follow',
      `--pretty=format:%H${SEP}%an${SEP}%ai${SEP}%s`,
      '--', varsLockRelPath(env)
    )
  } catch {
    console.log(chalk.yellow(`  ⚠  no git history found for ${env}\n`))
    return
  }

  if (!logOutput) {
    console.log(`  ${chalk.dim(`no commits yet for ${env} — has vars.lock been committed?`)}\n`)
    return
  }

  const commits = logOutput.split('\n').map(line => {
    const [hash, author, date, ...rest] = line.split(SEP)
    return { hash, author, date, message: rest.join(SEP) }
  })

  for (const { hash, author, date, message } of commits) {
    console.log(`  ${chalk.yellow(hash.slice(0, 8))}  ${chalk.bold(message)}`)
    console.log(`  ${chalk.dim(author + ' · ' + timeAgo(date))}`)

    const curr = getVarsLockAt(repoRoot, hash,       env)
    const prev = getVarsLockAt(repoRoot, `${hash}~1`, env)

    if (curr) {
      const currKeys = new Set(Object.keys(curr.vars  || {}))
      const prevKeys = new Set(Object.keys(prev?.vars || {}))

      const added   = [...currKeys].filter(k => !prevKeys.has(k))
      const removed = [...prevKeys].filter(k => !currKeys.has(k))
      const updated = [...currKeys].filter(k =>
        prevKeys.has(k) && blobsChanged(prev.vars[k]?.blobs, curr.vars[k]?.blobs)
      )

      for (const k of added)   console.log(`    ${chalk.green('+')} ${k}`)
      for (const k of updated) console.log(`    ${chalk.blue('~')} ${k}`)
      for (const k of removed) console.log(`    ${chalk.red('-')} ${k}`)

      if (!added.length && !updated.length && !removed.length) {
        console.log(`    ${chalk.dim('(metadata or blob rotation)')}`)
      }
    }

    console.log()
  }

  console.log(`  ${chalk.dim(commits.length + ' commit' + (commits.length !== 1 ? 's' : ''))}\n`)
}

// ── envlock diff ──────────────────────────────────────────────────────────────

export async function cmdDiff(options) {
  const env = options.env
  console.log(chalk.bold(`\n  envlock diff → ${chalk.cyan(env)}\n`))

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

  const curr = getVarsLockAt(repoRoot, 'HEAD',    env)
  const prev = getVarsLockAt(repoRoot, 'HEAD~1',  env)

  if (!curr) {
    console.log(chalk.yellow(`  ⚠  ${env}/vars.lock has not been committed yet\n`))
    return
  }
  if (!prev) {
    console.log(`  ${chalk.dim('first commit — nothing to diff against')}\n`)
    return
  }

  const currKeys = new Set(Object.keys(curr.vars  || {}))
  const prevKeys = new Set(Object.keys(prev.vars  || {}))

  const added   = [...currKeys].filter(k => !prevKeys.has(k))
  const removed = [...prevKeys].filter(k => !currKeys.has(k))
  const updated = [...currKeys].filter(k =>
    prevKeys.has(k) && blobsChanged(prev.vars[k]?.blobs, curr.vars[k]?.blobs)
  )

  if (!added.length && !removed.length && !updated.length) {
    console.log(`  ${chalk.dim(`no changes to ${env} in last commit`)}\n`)
    return
  }

  console.log(`  ${chalk.dim('vars')}`)
  for (const k of added)   console.log(`    ${chalk.green('+')} ${chalk.bold(k.padEnd(24))}  ${chalk.dim('by ' + nameForFp(config, curr.vars[k]?.by))}`)
  for (const k of updated) console.log(`    ${chalk.blue('~')} ${chalk.bold(k.padEnd(24))}  ${chalk.dim('by ' + nameForFp(config, curr.vars[k]?.by))}`)
  for (const k of removed) console.log(`    ${chalk.red('-')} ${chalk.bold(k)}`)
  console.log()

  const total = added.length + updated.length + removed.length
  console.log(`  ${chalk.dim(`${total} var change${total !== 1 ? 's' : ''} in last commit`)}\n`)
}
