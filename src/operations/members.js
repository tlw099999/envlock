/**
 * Pure business logic for member operations.
 * No chalk, no enquirer, no ora, no process.exit.
 * Called by both CLI command functions and the UI API handlers.
 *
 * Every function throws a descriptive Error on validation failure.
 * The caller (CLI or API) decides how to present that error.
 */

import {
  writeToken, deleteToken, readToken, readAllTokens, getMyLevel, rewrapVars,
} from '../config/lockfile.js'
import { writeConfig } from '../config/config.js'

export const LEVELS       = { read: 1, write: 2, manage: 3 }
export const VALID_LEVELS = ['read', 'write', 'manage']

// ── addMember ─────────────────────────────────────────────────────────────────
//
// Grant a member access to one or more environments.
// Does NOT sync vars — call syncMember separately after this.
//
// @param envAccess  [{ env: string, access: 'read'|'write'|'manage' }]
// @returns          { grantedEnvs: string[] }

export function addMember(repoRoot, identity, config, targetName, envAccess) {
  const targetMember = config.members[targetName]
  if (!targetMember) {
    throw new Error(`"${targetName}" has not joined this repo yet — they need to run envlock join first`)
  }

  // validate everything before writing anything
  for (const { env, access } of envAccess) {
    if (!config.envs.includes(env)) {
      throw new Error(`unknown environment: "${env}" — valid: ${config.envs.join(', ')}`)
    }
    if (!VALID_LEVELS.includes(access)) {
      throw new Error(`invalid access level: "${access}" — valid: ${VALID_LEVELS.join(', ')}`)
    }
    const myLevel = getMyLevel(repoRoot, env, identity)
    if (!myLevel || LEVELS[myLevel] < LEVELS.manage) {
      throw new Error(`you need manage access on "${env}" to add members`)
    }
  }

  // write tokens
  if (!config.members[targetName].envs)    config.members[targetName].envs    = {}
  if  (config.members[targetName].pending) delete config.members[targetName].pending

  for (const { env, access } of envAccess) {
    writeToken(repoRoot, env, targetMember, access)
    config.members[targetName].envs[env] = access
  }

  writeConfig(repoRoot, config)

  return { grantedEnvs: envAccess.map(e => e.env) }
}

// ── syncMember ────────────────────────────────────────────────────────────────
//
// Re-encrypt all vars for a member across every env where the caller has manage.
// Call after addMember or any time blobs are missing.
//
// @returns { syncedEnvs: string[], skipped: { [env]: string[] } }

export function syncMember(repoRoot, identity, config, targetName) {
  const targetMember = config.members[targetName]
  if (!targetMember) {
    throw new Error(`"${targetName}" is not a member of this repo`)
  }

  const syncedEnvs = []
  const skipped    = {}

  for (const env of config.envs) {
    const targetToken = readToken(repoRoot, env, targetMember.fingerprint)
    const myLevel     = getMyLevel(repoRoot, env, identity)
    if (!targetToken || !myLevel || LEVELS[myLevel] < LEVELS.manage) continue

    const { skipped: envSkipped } = rewrapVars(repoRoot, env, identity)
    syncedEnvs.push(env)
    if (envSkipped.length > 0) skipped[env] = envSkipped
  }

  return { syncedEnvs, skipped }
}

// ── revokeMember ──────────────────────────────────────────────────────────────
//
// Remove a member's access from one or more environments and rewrap all vars
// so their blobs are gone. Validates ALL envs before touching any files.
//
// @param targetEnvs  string[] — list of env names to revoke from
// @returns           { revokedEnvs: string[] }

export function revokeMember(repoRoot, identity, config, targetName, targetEnvs) {
  const targetMember = config.members[targetName]
  if (!targetMember) {
    throw new Error(`"${targetName}" is not a member`)
  }

  // validate everything before writing anything
  for (const env of targetEnvs) {
    if (!config.envs.includes(env)) {
      throw new Error(`unknown environment: "${env}" — valid: ${config.envs.join(', ')}`)
    }
    const myLevel = getMyLevel(repoRoot, env, identity)
    if (!myLevel || LEVELS[myLevel] < LEVELS.manage) {
      throw new Error(`you need manage access on "${env}" to revoke members`)
    }
    const manageTokens = readAllTokens(repoRoot, env).filter(t => t.level === 'manage')
    if (
      manageTokens.some(t => t.fingerprint === targetMember.fingerprint) &&
      manageTokens.length === 1
    ) {
      throw new Error(
        `cannot revoke "${targetName}" from "${env}" — they are the only manage member. ` +
        `Grant someone else manage first.`
      )
    }
  }

  // execute
  if (!config.members[targetName].envs) config.members[targetName].envs = {}

  for (const env of targetEnvs) {
    deleteToken(repoRoot, env, targetMember.fingerprint)
    rewrapVars(repoRoot, env, identity)
    delete config.members[targetName].envs[env]
  }

  writeConfig(repoRoot, config)

  return { revokedEnvs: targetEnvs }
}
