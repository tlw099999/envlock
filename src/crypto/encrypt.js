import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
const { encodeBase64, decodeBase64 } = naclUtil

// Sealed box — encrypt using only the recipient's public key.
// An ephemeral keypair is generated per encryption and immediately discarded.
// Decryption requires only the recipient's private key (no sender tracking needed).
// Format: base64( ephemeralPubKey[32] | nonce[24] | ciphertext )
export function sealBox(plaintext, recipientPublicKeyB64) {
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64)
  const ephemeral          = nacl.box.keyPair()
  const nonce              = nacl.randomBytes(nacl.box.nonceLength)
  const message            = new TextEncoder().encode(plaintext)

  const ciphertext = nacl.box(message, nonce, recipientPublicKey, ephemeral.secretKey)
  if (!ciphertext) throw new Error('encryption failed')

  const combined = new Uint8Array(
    nacl.box.publicKeyLength + nonce.length + ciphertext.length
  )
  combined.set(ephemeral.publicKey)
  combined.set(nonce,       nacl.box.publicKeyLength)
  combined.set(ciphertext,  nacl.box.publicKeyLength + nonce.length)

  return encodeBase64(combined)
}

// Open a sealed box using only the recipient's private key.
export function openSealedBox(blob, recipientSecretKeyB64) {
  const combined          = decodeBase64(blob)
  const recipientSecretKey = decodeBase64(recipientSecretKeyB64)

  const ephemeralPublicKey = combined.slice(0, nacl.box.publicKeyLength)
  const nonce              = combined.slice(
    nacl.box.publicKeyLength,
    nacl.box.publicKeyLength + nacl.box.nonceLength
  )
  const ciphertext = combined.slice(nacl.box.publicKeyLength + nacl.box.nonceLength)

  const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, recipientSecretKey)
  if (!decrypted) throw new Error('decryption failed — wrong key or corrupted data')

  return new TextDecoder().decode(decrypted)
}

// Encrypt plaintext for multiple recipients — returns { fingerprint: sealedBlob }
export function sealForAll(plaintext, recipients) {
  const result = {}
  for (const { fingerprint, publicKey } of recipients) {
    result[fingerprint] = sealBox(plaintext, publicKey)
  }
  return result
}
