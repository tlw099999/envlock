import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
import { sealBox, openSealedBox, sealForAll } from '../../src/crypto/encrypt.js'

const { encodeBase64 } = naclUtil

// ── helpers ───────────────────────────────────────────────────────────────────

function makeKeypair(name = 'anon') {
  const kp = nacl.box.keyPair()
  return {
    name,
    fingerprint: name + '-fp',
    publicKey:   encodeBase64(kp.publicKey),
    privateKey:  encodeBase64(kp.secretKey),
  }
}

// ── sealBox / openSealedBox ───────────────────────────────────────────────────

describe('sealBox / openSealedBox', () => {
  test('roundtrip — short string', () => {
    const { publicKey, privateKey } = makeKeypair()
    const blob = sealBox('hello', publicKey)
    assert.equal(openSealedBox(blob, privateKey), 'hello')
  })

  test('roundtrip — empty string', () => {
    const { publicKey, privateKey } = makeKeypair()
    assert.equal(openSealedBox(sealBox('', publicKey), privateKey), '')
  })

  test('roundtrip — long string with special chars', () => {
    const { publicKey, privateKey } = makeKeypair()
    const secret = 'postgres://user:p@$$w0rd!@host:5432/db?ssl=true&charset=utf8'
    assert.equal(openSealedBox(sealBox(secret, publicKey), privateKey), secret)
  })

  test('roundtrip — unicode', () => {
    const { publicKey, privateKey } = makeKeypair()
    const secret = '🔐 secret: héllo wörld'
    assert.equal(openSealedBox(sealBox(secret, publicKey), privateKey), secret)
  })

  test('two encryptions of the same plaintext produce different blobs (ephemeral key)', () => {
    const { publicKey } = makeKeypair()
    const a = sealBox('same', publicKey)
    const b = sealBox('same', publicKey)
    assert.notEqual(a, b)
  })

  test('wrong private key → throws', () => {
    const sender    = makeKeypair('sender')
    const intruder  = makeKeypair('intruder')
    const blob = sealBox('secret', sender.publicKey)
    assert.throws(
      () => openSealedBox(blob, intruder.privateKey),
      /decryption failed/
    )
  })

  test('tampered ciphertext → throws', () => {
    const { publicKey, privateKey } = makeKeypair()
    const blob  = sealBox('secret', publicKey)
    const bytes = Buffer.from(blob, 'base64')
    bytes[bytes.length - 1] ^= 0xff          // flip last byte
    assert.throws(
      () => openSealedBox(bytes.toString('base64'), privateKey),
      /decryption failed/
    )
  })

  test('truncated blob → throws', () => {
    const { publicKey, privateKey } = makeKeypair()
    const blob  = sealBox('secret', publicKey)
    const short = blob.slice(0, 20)
    assert.throws(() => openSealedBox(short, privateKey))
  })
})

// ── sealForAll ────────────────────────────────────────────────────────────────

describe('sealForAll', () => {
  test('returns one blob per recipient', () => {
    const alice = makeKeypair('alice')
    const bob   = makeKeypair('bob')
    const blobs = sealForAll('secret', [alice, bob])
    assert.ok(blobs['alice-fp'])
    assert.ok(blobs['bob-fp'])
    assert.equal(Object.keys(blobs).length, 2)
  })

  test('each recipient can decrypt their own blob', () => {
    const alice = makeKeypair('alice')
    const bob   = makeKeypair('bob')
    const blobs = sealForAll('my secret', [alice, bob])
    assert.equal(openSealedBox(blobs['alice-fp'], alice.privateKey), 'my secret')
    assert.equal(openSealedBox(blobs['bob-fp'],   bob.privateKey),   'my secret')
  })

  test('each blob is unique despite same plaintext', () => {
    const alice = makeKeypair('alice')
    const bob   = makeKeypair('bob')
    const blobs = sealForAll('same secret', [alice, bob])
    assert.notEqual(blobs['alice-fp'], blobs['bob-fp'])
  })

  test('recipient cannot decrypt another\'s blob', () => {
    const alice = makeKeypair('alice')
    const bob   = makeKeypair('bob')
    const blobs = sealForAll('secret', [alice, bob])
    assert.throws(
      () => openSealedBox(blobs['alice-fp'], bob.privateKey),
      /decryption failed/
    )
  })

  test('single recipient', () => {
    const alice = makeKeypair('alice')
    const blobs = sealForAll('solo', [alice])
    assert.equal(Object.keys(blobs).length, 1)
    assert.equal(openSealedBox(blobs['alice-fp'], alice.privateKey), 'solo')
  })

  test('empty recipient list → empty object', () => {
    const blobs = sealForAll('secret', [])
    assert.deepEqual(blobs, {})
  })
})
