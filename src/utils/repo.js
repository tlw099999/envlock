import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { execSync, execFileSync } from 'child_process'
import { ENVLOCK_FOLDER, CONFIG_FILE } from '../config/config.js'

// find the repo root by walking up from cwd
export function findRepoRoot(startDir = process.cwd()) {
  let dir = resolve(startDir)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

export function requireRepoRoot() {
  const root = findRepoRoot()
  if (!root) throw new Error('not inside a git repository — run git init first')
  return root
}

export function requireEnvlockRepo(repoRoot) {
  if (!existsSync(join(repoRoot, ENVLOCK_FOLDER, CONFIG_FILE))) {
    throw new Error('envlock is not set up in this repo — run envlock setup first')
  }
}

// run a git command and return trimmed stdout
export function git(repoRoot, ...args) {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd:   repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim()
  } catch (err) {
    throw new Error(`git ${args[0]} failed: ${err.stderr?.toString().trim() || err.message}`)
  }
}

// run git with an arg array — safe for format strings containing shell-special chars
export function gitFile(repoRoot, ...args) {
  try {
    return execFileSync('git', args, {
      cwd:   repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim()
  } catch (err) {
    throw new Error(`git ${args[0]} failed: ${err.stderr?.toString().trim() || err.message}`)
  }
}

export function gitAdd(repoRoot, ...files) {
  git(repoRoot, 'add', ...files.map(f => `"${f}"`))
}

export function gitCommit(repoRoot, message) {
  try {
    git(repoRoot, 'commit', '-m', `"${message}"`)
  } catch (err) {
    if (!err.message.includes('nothing to commit')) throw err
  }
}

// human-readable relative time from an ISO string
export function timeAgo(isoString) {
  if (!isoString) return 'unknown'
  const diff  = Date.now() - new Date(isoString).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  const weeks = Math.floor(diff / 604800000)
  if (mins  < 1)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 7)  return `${days}d ago`
  return `${weeks}w ago`
}
