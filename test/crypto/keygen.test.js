import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeypair, deriveFingerprint } from '../../src/crypto/keygen.js'

describe('generateKeypair', () => {
  test('returns expected shape', () => {
    const kp = generateKeypair('alice')
    assert.equal(kp.name, 'alice')
    assert.equal(typeof kp.publicKey,  'string')
    assert.equal(typeof kp.privateKey, 'string')
    assert.equal(typeof kp.fingerprint, 'string')
  })

  test('fingerprint is 16 hex chars', () => {
    const { fingerprint } = generateKeypair('alice')
    assert.match(fingerprint, /^[0-9a-f]{16}$/)
  })

  test('two calls produce different keypairs', () => {
    const a = generateKeypair('alice')
    const b = generateKeypair('alice')
    assert.notEqual(a.publicKey,   b.publicKey)
    assert.notEqual(a.privateKey,  b.privateKey)
    assert.notEqual(a.fingerprint, b.fingerprint)
  })

  test('base64-encoded keys are non-empty', () => {
    const { publicKey, privateKey } = generateKeypair('test')
    assert.ok(publicKey.length  > 0)
    assert.ok(privateKey.length > 0)
  })
})

describe('deriveFingerprint', () => {
  test('is deterministic — same key always gives same fingerprint', () => {
    const { publicKey, fingerprint } = generateKeypair('alice')
    assert.equal(deriveFingerprint(publicKey), fingerprint)
    assert.equal(deriveFingerprint(publicKey), deriveFingerprint(publicKey))
  })

  test('different keys produce different fingerprints', () => {
    const a = generateKeypair('a')
    const b = generateKeypair('b')
    assert.notEqual(deriveFingerprint(a.publicKey), deriveFingerprint(b.publicKey))
  })

  test('fingerprint matches the one stored on the keypair', () => {
    const kp = generateKeypair('test')
    assert.equal(kp.fingerprint, deriveFingerprint(kp.publicKey))
  })
})
