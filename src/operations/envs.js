/**
 * Pure business logic for environment-level operations.
 * No chalk, no enquirer, no ora, no process.exit.
 * Called by both CLI command functions and the UI API handlers.
 */

import { existsSync, writeFileSync, rmSync } from 'fs'
import { join }                              from 'path'
import { writeConfig, ENVLOCK_FOLDER }       from '../config/config.js'
import { getMyLevel }                        from '../config/lockfile.js'
import { PRE_COMMIT_SCRIPT }                 from '../commands/setup.js'
import { LEVELS }                            from './members.js'

// ── removeEnv ─────────────────────────────────────────────────────────────────
//
// Permanently remove an environment:
//   1. Delete .envlock/envs/<env>/ (all tokens + vars.lock)
//   2. Remove env from config.envs and from each member's envs map
//   3. Refresh .envlock/hooks/pre-commit so the deletion can be committed
//
// The CLI command handles the "are you sure?" prompts before calling this.
// The API handler handles confirmation via its own modal flow.
//
// @returns { deletedEnv: string }

export function removeEnv(repoRoot, identity, config, env) {
  if (!config.envs.includes(env)) {
    throw new Error(`unknown environment: "${env}" — valid: ${config.envs.join(', ')}`)
  }

  const myLevel = getMyLevel(repoRoot, env, identity)
  if (!myLevel || LEVELS[myLevel] < LEVELS.manage) {
    throw new Error(`you need manage access on "${env}" to remove it`)
  }

  // 1. delete the env directory
  const envDir = join(repoRoot, ENVLOCK_FOLDER, 'envs', env)
  if (existsSync(envDir)) {
    rmSync(envDir, { recursive: true, force: true })
  }

  // 2. update config
  config.envs = config.envs.filter(e => e !== env)
  for (const member of Object.values(config.members)) {
    if (member.envs?.[env]) delete member.envs[env]
  }
  writeConfig(repoRoot, config)

  // 3. refresh pre-commit hook so the deletions can be committed without being blocked
  const preCommitPath = join(repoRoot, ENVLOCK_FOLDER, 'hooks', 'pre-commit')
  if (existsSync(preCommitPath)) {
    writeFileSync(preCommitPath, PRE_COMMIT_SCRIPT, { mode: 0o755 })
  }

  return { deletedEnv: env }
}
