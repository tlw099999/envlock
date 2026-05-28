import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
const { encodeBase64, decodeBase64 } = naclUtil
import { createHash } from 'crypto'
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import os from 'os'

export const ENVLOCK_DIR = join(os.homedir(), '.envlock')

// generate a new keypair for a developer
export function generateKeypair(name) {
  const keypair     = nacl.box.keyPair()
  const publicKey   = encodeBase64(keypair.publicKey)
  const privateKey  = encodeBase64(keypair.secretKey)
  const fingerprint = deriveFingerprint(publicKey)
  return { name, publicKey, privateKey, fingerprint }
}

// derive a short fingerprint from a public key
export function deriveFingerprint(publicKey) {
  return createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 16)
}

// save keypair to ~/.envlock/
export function saveKeypair(name, publicKey, privateKey, fingerprint) {
  if (!existsSync(ENVLOCK_DIR)) {
    mkdirSync(ENVLOCK_DIR, { recursive: true })
  }

  // private key — owner read/write only
  writeFileSync(
    join(ENVLOCK_DIR, `${fingerprint}.key`),
    JSON.stringify({ name, fingerprint, privateKey }, null, 2),
    { mode: 0o600 }
  )

  // public key — world readable
  writeFileSync(
    join(ENVLOCK_DIR, `${fingerprint}.pub`),
    JSON.stringify({ name, fingerprint, publicKey }, null, 2),
    { mode: 0o644 }
  )

  // identity pointer — who are we on this machine
  writeFileSync(
    join(ENVLOCK_DIR, 'identity.json'),
    JSON.stringify({ name, fingerprint }, null, 2),
    { mode: 0o600 }
  )
}

// load your own identity from ~/.envlock/
export function loadIdentity() {
  const identityPath = join(ENVLOCK_DIR, 'identity.json')
  if (!existsSync(identityPath)) return null

  const { name, fingerprint } = JSON.parse(readFileSync(identityPath, 'utf8'))
  const keyPath = join(ENVLOCK_DIR, `${fingerprint}.key`)
  const pubPath = join(ENVLOCK_DIR, `${fingerprint}.pub`)

  if (!existsSync(keyPath) || !existsSync(pubPath)) return null

  return {
    name,
    fingerprint,
    privateKey: JSON.parse(readFileSync(keyPath, 'utf8')).privateKey,
    publicKey:  JSON.parse(readFileSync(pubPath,  'utf8')).publicKey,
  }
}

// load a public key by fingerprint from repo
export function loadPublicKey(repoRoot, fingerprint) {
  const pubPath = join(repoRoot, '.envlock', 'keys', `${fingerprint}.pub`)
  if (!existsSync(pubPath)) return null
  return JSON.parse(readFileSync(pubPath, 'utf8'))
}

// load all public keys from repo
export function loadAllPublicKeys(repoRoot) {
  const keysDir = join(repoRoot, '.envlock', 'keys')
  if (!existsSync(keysDir)) return []
  return readdirSync(keysDir)
    .filter(f => f.endsWith('.pub'))
    .map(f => JSON.parse(readFileSync(join(keysDir, f), 'utf8')))
}
