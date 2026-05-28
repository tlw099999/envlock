import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateKeypair } from '../../src/crypto/keygen.js'
import { writeConfig, keysDir, accessDir, varsLockPath } from '../../src/config/config.js'
import {
  writeToken, readToken, readAllTokens, deleteToken, getMyLevel,
  setVar, decryptAll, listKeys, removeVar, rewrapVars, readVarsLock,
} from '../../src/config/lockfile.js'

// ── test fixtures ─────────────────────────────────────────────────────────────

function setupRepo(repoRoot, members, envs = ['dev']) {
  // create .envlock/keys/ first — recursive: true also creates .envlock/
  const kd = keysDir(repoRoot)
  mkdirSync(kd, { recursive: true })

  // config.json (needs .envlock/ to exist)
  writeConfig(repoRoot, {
    version: 2,
    project: 'test',
    envs,
    members: Object.fromEntries(
      members.map(m => [m.name, { fingerprint: m.fingerprint, publicKey: m.publicKey }])
    ),
  })

  // public key files
  for (const m of members) {
    writeFileSync(
      join(kd, `${m.fingerprint}.pub`),
      JSON.stringify({ name: m.name, fingerprint: m.fingerprint, publicKey: m.publicKey }, null, 2)
    )
  }

  // per-env: access/ dir + empty vars.lock
  for (const env of envs) {
    mkdirSync(accessDir(repoRoot, env), { recursive: true })
    writeFileSync(varsLockPath(repoRoot, env), JSON.stringify({ version: 2, vars: {} }) + '\n')
  }
}

// ── token operations ──────────────────────────────────────────────────────────

describe('token: writeToken / readToken', () => {
  let dir, alice

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-token-'))
    alice = generateKeypair('alice')
    setupRepo(dir, [alice])
    writeToken(dir, 'dev', alice, 'manage')
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('readToken returns the written token', () => {
    const token = readToken(dir, 'dev', alice.fingerprint)
    assert.ok(token)
    assert.equal(token.fingerprint, alice.fingerprint)
    assert.equal(token.level, 'manage')
    assert.equal(token.version, 2)
    assert.ok(token.proof)
  })

  test('readToken returns null for unknown fingerprint', () => {
    assert.equal(readToken(dir, 'dev', 'nonexistent'), null)
  })

  test('readToken returns null for unknown env', () => {
    assert.equal(readToken(dir, 'prod', alice.fingerprint), null)
  })
})

describe('token: readAllTokens', () => {
  let dir, alice, bob

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-alltokens-'))
    alice = generateKeypair('alice')
    bob   = generateKeypair('bob')
    setupRepo(dir, [alice, bob])
    writeToken(dir, 'dev', alice, 'manage')
    writeToken(dir, 'dev', bob,   'read')
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('returns all tokens for the env', () => {
    const tokens = readAllTokens(dir, 'dev')
    assert.equal(tokens.length, 2)
  })

  test('tokens include correct fingerprints', () => {
    const fps = readAllTokens(dir, 'dev').map(t => t.fingerprint)
    assert.ok(fps.includes(alice.fingerprint))
    assert.ok(fps.includes(bob.fingerprint))
  })

  test('returns empty array for env with no tokens', () => {
    const tokens = readAllTokens(dir, 'staging')
    assert.deepEqual(tokens, [])
  })
})

describe('token: deleteToken', () => {
  let dir, alice

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-delete-'))
    alice = generateKeypair('alice')
    setupRepo(dir, [alice])
    writeToken(dir, 'dev', alice, 'manage')
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('after delete, readToken returns null', () => {
    deleteToken(dir, 'dev', alice.fingerprint)
    assert.equal(readToken(dir, 'dev', alice.fingerprint), null)
  })

  test('deleting a non-existent token does not throw', () => {
    assert.doesNotThrow(() => deleteToken(dir, 'dev', 'ghost-fp'))
  })
})

// ── tamper detection ──────────────────────────────────────────────────────────

describe('getMyLevel — tamper detection', () => {
  let dir, alice

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-tamper-'))
    alice = generateKeypair('alice')
    setupRepo(dir, [alice])
    writeToken(dir, 'dev', alice, 'manage')
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('returns the correct level for a valid token', () => {
    assert.equal(getMyLevel(dir, 'dev', alice), 'manage')
  })

  test('returns null when no token exists', () => {
    assert.equal(getMyLevel(dir, 'prod', alice), null)
  })

  test('returns null when plain level field is tampered', () => {
    // write valid token, then manually downgrade the plain level field
    const tokenPath = join(dir, '.envlock', 'envs', 'dev', 'access', `${alice.fingerprint}.token`)
    const token     = JSON.parse(readFileSync(tokenPath, 'utf8'))
    token.level = 'read'   // downgrade — proof still says 'manage'
    writeFileSync(tokenPath, JSON.stringify(token, null, 2) + '\n')

    // getMyLevel decrypts proof and compares — mismatch → null
    assert.equal(getMyLevel(dir, 'dev', alice), null)
  })

  test('returns null when proof blob is corrupted', () => {
    // re-write a valid token first
    writeToken(dir, 'dev', alice, 'manage')
    const tokenPath = join(dir, '.envlock', 'envs', 'dev', 'access', `${alice.fingerprint}.token`)
    const token     = JSON.parse(readFileSync(tokenPath, 'utf8'))
    token.proof = 'aGVsbG8='  // valid base64 but garbage ciphertext
    writeFileSync(tokenPath, JSON.stringify(token, null, 2) + '\n')

    assert.equal(getMyLevel(dir, 'dev', alice), null)
  })
})

// ── var operations ────────────────────────────────────────────────────────────

describe('setVar / decryptAll', () => {
  let dir, alice

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-vars-'))
    alice = generateKeypair('alice')
    setupRepo(dir, [alice])
    writeToken(dir, 'dev', alice, 'manage')
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('setVar then decryptAll returns original value', () => {
    setVar(dir, 'dev', 'SECRET_KEY', 'abc123', alice)
    const result = decryptAll(dir, 'dev', alice)
    assert.equal(result['SECRET_KEY'], 'abc123')
  })

  test('multiple vars all decrypt correctly', () => {
    setVar(dir, 'dev', 'DB_URL',    'postgres://localhost/db', alice)
    setVar(dir, 'dev', 'API_TOKEN', 'tok_live_xyz',            alice)
    const result = decryptAll(dir, 'dev', alice)
    assert.equal(result['DB_URL'],    'postgres://localhost/db')
    assert.equal(result['API_TOKEN'], 'tok_live_xyz')
  })

  test('special characters in value survive roundtrip', () => {
    const secret = 'p@$$w0rd!#%&*()=+[]{}'
    setVar(dir, 'dev', 'SPECIAL', secret, alice)
    assert.equal(decryptAll(dir, 'dev', alice)['SPECIAL'], secret)
  })

  test('update overwrites the previous value', () => {
    setVar(dir, 'dev', 'COUNTER', 'v1', alice)
    setVar(dir, 'dev', 'COUNTER', 'v2', alice)
    assert.equal(decryptAll(dir, 'dev', alice)['COUNTER'], 'v2')
  })

  test('setVar records the author fingerprint and timestamp', () => {
    setVar(dir, 'dev', 'AUTHORED', 'value', alice)
    const lockData = readVarsLock(dir, 'dev')
    assert.equal(lockData.vars['AUTHORED'].by, alice.fingerprint)
    assert.ok(lockData.vars['AUTHORED'].at)
  })

  test('decryptAll skips vars where caller has no blob', () => {
    // manually inject a var without a blob for alice
    const lockData = readVarsLock(dir, 'dev')
    lockData.vars['GHOST'] = { by: 'other-fp', at: new Date().toISOString(), blobs: { 'other-fp': 'abc' } }
    writeFileSync(varsLockPath(dir, 'dev'), JSON.stringify(lockData, null, 2) + '\n')
    const result = decryptAll(dir, 'dev', alice)
    assert.equal(result['GHOST'], undefined)
  })
})

describe('listKeys / removeVar', () => {
  let dir, alice

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-list-'))
    alice = generateKeypair('alice')
    setupRepo(dir, [alice])
    writeToken(dir, 'dev', alice, 'manage')
    setVar(dir, 'dev', 'KEY_A', 'a', alice)
    setVar(dir, 'dev', 'KEY_B', 'b', alice)
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('listKeys returns all key names', () => {
    const keys = listKeys(dir, 'dev').map(k => k.key)
    assert.ok(keys.includes('KEY_A'))
    assert.ok(keys.includes('KEY_B'))
  })

  test('removeVar deletes the key', () => {
    removeVar(dir, 'dev', 'KEY_A')
    const keys = listKeys(dir, 'dev').map(k => k.key)
    assert.ok(!keys.includes('KEY_A'))
    assert.ok(keys.includes('KEY_B'))
  })

  test('removeVar throws for unknown key', () => {
    assert.throws(() => removeVar(dir, 'dev', 'NONEXISTENT'), /not found/)
  })
})

// ── rewrapVars ────────────────────────────────────────────────────────────────

describe('rewrapVars', () => {
  let dir, alice, bob

  before(() => {
    dir   = mkdtempSync(join(tmpdir(), 'envlock-rewrap-'))
    alice = generateKeypair('alice')
    bob   = generateKeypair('bob')
    setupRepo(dir, [alice, bob])
    writeToken(dir, 'dev', alice, 'manage')
    // initially only alice has a token — bob is not in the env yet
    setVar(dir, 'dev', 'API_KEY', 'sk_live_abc', alice)
    setVar(dir, 'dev', 'DB_URL',  'postgres://x', alice)
  })

  after(() => rmSync(dir, { recursive: true, force: true }))

  test('before rewrap, bob cannot decrypt', () => {
    const result = decryptAll(dir, 'dev', bob)
    assert.equal(Object.keys(result).length, 0)
  })

  test('after granting bob a token and rewrapping, bob can decrypt all vars', () => {
    writeToken(dir, 'dev', bob, 'read')
    rewrapVars(dir, 'dev', alice)
    const result = decryptAll(dir, 'dev', bob)
    assert.equal(result['API_KEY'], 'sk_live_abc')
    assert.equal(result['DB_URL'],  'postgres://x')
  })

  test('alice can still decrypt after rewrap', () => {
    const result = decryptAll(dir, 'dev', alice)
    assert.equal(result['API_KEY'], 'sk_live_abc')
  })

  test('after revoking bob and rewrapping, bob cannot decrypt', () => {
    deleteToken(dir, 'dev', bob.fingerprint)
    rewrapVars(dir, 'dev', alice)
    const result = decryptAll(dir, 'dev', bob)
    assert.equal(Object.keys(result).length, 0)
  })

  test('rewrapVars returns skipped list for vars the caller cannot decrypt', () => {
    // inject a var that only bob could decrypt (alice has no blob)
    const lockData = readVarsLock(dir, 'dev')
    lockData.vars['BOB_ONLY'] = {
      by: bob.fingerprint,
      at: new Date().toISOString(),
      blobs: { [bob.fingerprint]: 'some-blob' },
    }
    writeFileSync(varsLockPath(dir, 'dev'), JSON.stringify(lockData, null, 2) + '\n')
    writeToken(dir, 'dev', bob, 'read')  // put bob back

    const { skipped } = rewrapVars(dir, 'dev', alice)
    assert.ok(skipped.includes('BOB_ONLY'))
  })
})
