/**
 * Unit tests for the import command's core logic:
 * - parseEnvFile: parses various .env formats correctly
 * - import behaviour: new keys added, existing keys handled, empty files
 *
 * We test the parsing and encryption logic directly (not the CLI prompts).
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join }   from 'node:path'

import { generateKeypair }                                          from '../../src/crypto/keygen.js'
import { writeConfig, keysDir, accessDir, varsLockPath }           from '../../src/config/config.js'
import { writeToken, setVar, decryptAll, listKeys, readAllTokens } from '../../src/config/lockfile.js'
import { parseEnvFile }                                            from '../../src/commands/import.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function setupRepo(repoRoot, members, envs = ['dev']) {
  const kd = keysDir(repoRoot)
  mkdirSync(kd, { recursive: true })

  writeConfig(repoRoot, {
    version: 2,
    project: 'import-test',
    envs,
    members: Object.fromEntries(
      members.map(m => [m.name, { fingerprint: m.fingerprint, publicKey: m.publicKey }])
    ),
  })

  for (const m of members) {
    writeFileSync(
      join(kd, `${m.fingerprint}.pub`),
      JSON.stringify({ name: m.name, fingerprint: m.fingerprint, publicKey: m.publicKey }, null, 2)
    )
  }

  for (const env of envs) {
    mkdirSync(accessDir(repoRoot, env), { recursive: true })
    writeFileSync(varsLockPath(repoRoot, env), JSON.stringify({ version: 2, vars: {} }) + '\n')
  }
}

// ── parseEnvFile ──────────────────────────────────────────────────────────────

describe('parseEnvFile', () => {
  test('parses simple KEY=VALUE pairs', () => {
    const result = parseEnvFile('FOO=bar\nBAZ=qux')
    assert.deepEqual(result, [
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ])
  })

  test('strips double quotes from values', () => {
    const result = parseEnvFile('FOO="hello world"')
    assert.deepEqual(result, [{ key: 'FOO', value: 'hello world' }])
  })

  test('strips single quotes from values', () => {
    const result = parseEnvFile("FOO='hello world'")
    assert.deepEqual(result, [{ key: 'FOO', value: 'hello world' }])
  })

  test('handles export prefix', () => {
    const result = parseEnvFile('export FOO=bar')
    assert.deepEqual(result, [{ key: 'FOO', value: 'bar' }])
  })

  test('skips comment lines', () => {
    const result = parseEnvFile('# this is a comment\nFOO=bar')
    assert.deepEqual(result, [{ key: 'FOO', value: 'bar' }])
  })

  test('skips blank lines', () => {
    const result = parseEnvFile('\n\nFOO=bar\n\n')
    assert.deepEqual(result, [{ key: 'FOO', value: 'bar' }])
  })

  test('handles values containing = signs', () => {
    const result = parseEnvFile('DB_URL=postgres://user:pass@host/db?ssl=true')
    assert.deepEqual(result, [{ key: 'DB_URL', value: 'postgres://user:pass@host/db?ssl=true' }])
  })

  test('returns empty array for blank file', () => {
    const result = parseEnvFile('')
    assert.deepEqual(result, [])
  })

  test('returns empty array for comments-only file', () => {
    const result = parseEnvFile('# just a comment\n# another comment')
    assert.deepEqual(result, [])
  })

  test('handles mixed content', () => {
    const content = `
# Database
DATABASE_URL=postgres://localhost:5432/mydb

# Auth
export JWT_SECRET="super secret"
API_KEY='abc123'

# flags
DEBUG=true
`
    const result = parseEnvFile(content)
    assert.equal(result.length, 4)
    assert.deepEqual(result[0], { key: 'DATABASE_URL', value: 'postgres://localhost:5432/mydb' })
    assert.deepEqual(result[1], { key: 'JWT_SECRET',   value: 'super secret' })
    assert.deepEqual(result[2], { key: 'API_KEY',      value: 'abc123' })
    assert.deepEqual(result[3], { key: 'DEBUG',        value: 'true' })
  })
})

// ── import logic ──────────────────────────────────────────────────────────────

describe('import encryption', () => {
  let repoRoot, alice

  before(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'envlock-import-'))
    alice    = generateKeypair('alice')
    setupRepo(repoRoot, [alice], ['dev', 'prod'])
    writeToken(repoRoot, 'dev',  alice, 'manage')
    writeToken(repoRoot, 'prod', alice, 'manage')
  })

  after(() => rmSync(repoRoot, { recursive: true, force: true }))

  test('importing vars encrypts them and makes them decryptable', () => {
    const pairs = parseEnvFile('DATABASE_URL=postgres://localhost/db\nSECRET_KEY=abc123')

    for (const { key, value } of pairs) {
      setVar(repoRoot, 'dev', key, value, alice)
    }

    const decrypted = decryptAll(repoRoot, 'dev', alice)
    assert.equal(decrypted['DATABASE_URL'], 'postgres://localhost/db')
    assert.equal(decrypted['SECRET_KEY'],   'abc123')
  })

  test('importing into prod does not affect dev', () => {
    setVar(repoRoot, 'prod', 'PROD_ONLY', 'prod-value', alice)

    const devKeys  = listKeys(repoRoot, 'dev').map(k => k.key)
    const prodKeys = listKeys(repoRoot, 'prod').map(k => k.key)

    assert.ok(!devKeys.includes('PROD_ONLY'),  'PROD_ONLY should not be in dev')
    assert.ok(prodKeys.includes('PROD_ONLY'),  'PROD_ONLY should be in prod')
  })

  test('overwriting an existing key updates the value', () => {
    setVar(repoRoot, 'dev', 'DATABASE_URL', 'postgres://localhost/db', alice)
    setVar(repoRoot, 'dev', 'DATABASE_URL', 'postgres://newhost/db',   alice)

    const decrypted = decryptAll(repoRoot, 'dev', alice)
    assert.equal(decrypted['DATABASE_URL'], 'postgres://newhost/db')
  })

  test('importing for multiple members encrypts for all', () => {
    const bob = generateKeypair('bob')

    // add bob to the repo
    writeFileSync(
      join(keysDir(repoRoot), `${bob.fingerprint}.pub`),
      JSON.stringify({ name: bob.name, fingerprint: bob.fingerprint, publicKey: bob.publicKey }, null, 2)
    )
    writeToken(repoRoot, 'dev', bob, 'read')

    setVar(repoRoot, 'dev', 'SHARED_KEY', 'shared-value', alice)

    const aliceDecrypted = decryptAll(repoRoot, 'dev', alice)
    const bobDecrypted   = decryptAll(repoRoot, 'dev', bob)

    assert.equal(aliceDecrypted['SHARED_KEY'], 'shared-value')
    assert.equal(bobDecrypted['SHARED_KEY'],   'shared-value')
  })

  test('values with special characters survive roundtrip', () => {
    const specialValue = 'p@$$w0rd!#%^&*()=+[]{};:,.<>?'
    setVar(repoRoot, 'dev', 'SPECIAL', specialValue, alice)

    const decrypted = decryptAll(repoRoot, 'dev', alice)
    assert.equal(decrypted['SPECIAL'], specialValue)
  })

  test('values with = signs survive roundtrip', () => {
    const pairs = parseEnvFile('DB_URL=postgres://user:pass@host/db?ssl=true&pool=5')
    setVar(repoRoot, 'dev', pairs[0].key, pairs[0].value, alice)

    const decrypted = decryptAll(repoRoot, 'dev', alice)
    assert.equal(decrypted['DB_URL'], 'postgres://user:pass@host/db?ssl=true&pool=5')
  })
})
