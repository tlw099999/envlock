import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { sealBox, openSealedBox, sealForAll } from '../crypto/encrypt.js'
import { loadPublicKey } from '../crypto/keygen.js'
import { accessDir, tokenPath, varsLockPath } from '../config/config.js'

// ── token files (.envlock/envs/<env>/access/<fp>.token) ───────────────────────
//
// Each token file is owned by one member and written by a manage member.
// Structure: { version, fingerprint, level, proof }
//   level → plain text "read" | "write" | "manage"  (visible, for roster reads)
//   proof → sealBox({ level }, memberPublicKey)      (only member can verify)
//
// Tamper detection: decrypt proof and compare level — if they differ, tampered.

export function writeToken(repoRoot, env, member, level) {
  const dir = accessDir(repoRoot, env)
  mkdirSync(dir, { recursive: true })

  const proof = sealBox(JSON.stringify({ level }), member.publicKey)

  writeFileSync(
    tokenPath(repoRoot, env, member.fingerprint),
    JSON.stringify({ version: 2, fingerprint: member.fingerprint, level, proof }, null, 2) + '\n'
  )
}

export function deleteToken(repoRoot, env, fingerprint) {
  const path = tokenPath(repoRoot, env, fingerprint)
  if (existsSync(path)) unlinkSync(path)
}

export function readToken(repoRoot, env, fingerprint) {
  const path = tokenPath(repoRoot, env, fingerprint)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

// returns all token objects for an env — [{ version, fingerprint, level, proof }]
export function readAllTokens(repoRoot, env) {
  const dir = accessDir(repoRoot, env)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.token'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

// decrypt own proof and verify it matches the plain level field
// returns level string or null if no token / decryption fails
export function getMyLevel(repoRoot, env, identity) {
  const token = readToken(repoRoot, env, identity.fingerprint)
  if (!token) return null

  try {
    const { level } = JSON.parse(openSealedBox(token.proof, identity.privateKey))
    if (level !== token.level) return null  // tamper detected
    return level
  } catch {
    return null
  }
}

// ── vars.lock (.envlock/envs/<env>/vars.lock) ─────────────────────────────────
//
// Structure:
// {
//   version: 2,
//   vars: {
//     KEY: { by: <fp>, at: <iso>, blobs: { <fp>: sealedBlob, ... } }
//   }
// }

export function readVarsLock(repoRoot, env) {
  const path = varsLockPath(repoRoot, env)
  if (!existsSync(path)) return { version: 2, vars: {} }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeVarsLock(repoRoot, env, data) {
  writeFileSync(varsLockPath(repoRoot, env), JSON.stringify(data, null, 2) + '\n')
}

// encrypt a var for all current token holders and write it
export function setVar(repoRoot, env, key, value, identity) {
  const lockData   = readVarsLock(repoRoot, env)
  const recipients = readAllTokens(repoRoot, env)
    .map(t => loadPublicKey(repoRoot, t.fingerprint))
    .filter(Boolean)

  if (recipients.length === 0) throw new Error(`no members have access to ${env}`)

  lockData.vars[key] = {
    by:    identity.fingerprint,
    at:    new Date().toISOString(),
    blobs: sealForAll(value, recipients),
  }

  writeVarsLock(repoRoot, env, lockData)
}

export function removeVar(repoRoot, env, key) {
  const lockData = readVarsLock(repoRoot, env)
  if (!lockData.vars?.[key]) throw new Error(`key "${key}" not found in ${env}`)
  delete lockData.vars[key]
  writeVarsLock(repoRoot, env, lockData)
}

// decrypt all vars the caller has access to
export function decryptAll(repoRoot, env, identity) {
  const lockData = readVarsLock(repoRoot, env)
  const result   = {}

  for (const [key, varData] of Object.entries(lockData.vars || {})) {
    const myBlob = varData.blobs?.[identity.fingerprint]
    if (!myBlob) continue
    try {
      result[key] = openSealedBox(myBlob, identity.privateKey)
    } catch {
      throw new Error(`failed to decrypt "${key}" in ${env} — key may be corrupted`)
    }
  }

  return result
}

// list all var names + metadata (no values)
export function listKeys(repoRoot, env) {
  const lockData = readVarsLock(repoRoot, env)
  return Object.entries(lockData.vars || {}).map(([key, varData]) => ({
    key,
    by: varData.by  || 'unknown',
    at: varData.at  || null,
  }))
}

// re-encrypt all vars for the current token holder set.
// call after adding or revoking a member so their blobs are added/removed.
// returns { skipped } for vars the caller cannot decrypt themselves.
export function rewrapVars(repoRoot, env, identity) {
  const lockData = readVarsLock(repoRoot, env)
  if (Object.keys(lockData.vars || {}).length === 0) return { skipped: [] }

  const recipients = readAllTokens(repoRoot, env)
    .map(t => loadPublicKey(repoRoot, t.fingerprint))
    .filter(Boolean)

  const skipped = []

  for (const [key, varData] of Object.entries(lockData.vars)) {
    const myBlob = varData.blobs?.[identity.fingerprint]
    if (!myBlob) {
      skipped.push(key)
      continue
    }
    const plaintext       = openSealedBox(myBlob, identity.privateKey)
    lockData.vars[key]    = { ...varData, blobs: sealForAll(plaintext, recipients) }
  }

  writeVarsLock(repoRoot, env, lockData)
  return { skipped }
}
