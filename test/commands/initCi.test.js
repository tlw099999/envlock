/**
 * Unit tests for the init-ci command:
 * - isHeadless: SSH/headless detection
 * - buildHtml: one-time secret page structure and content
 * - CI identity lifecycle: keypair generation, config update, token creation, var sync
 */

import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join }   from 'node:path'

import { generateKeypair }                                        from '../../src/crypto/keygen.js'
import { writeConfig, readConfig, keysDir, accessDir, varsLockPath } from '../../src/config/config.js'
import { writeToken, setVar, decryptAll, readAllTokens }          from '../../src/config/lockfile.js'
import { isHeadless, buildHtml }                                  from '../../src/commands/initCi.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function setupRepo(repoRoot, members, envs = ['dev', 'prod']) {
  const kd = keysDir(repoRoot)
  mkdirSync(kd, { recursive: true })

  writeConfig(repoRoot, {
    version: 2,
    project: 'ci-test',
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

// Simulate what cmdInitCi does after generating the keypair:
// adds CI to config, writes the pub key file, writes a token, and syncs all vars.
async function addCiIdentity(repoRoot, ciKp, envs, managerIdentity) {
  const { sealBox, openSealedBox } = await import('../../src/crypto/encrypt.js')
  const { readVarsLock, writeVarsLock } = await import('../../src/config/lockfile.js')

  // update config
  const config = readConfig(repoRoot)
  config.members['ci'] = { fingerprint: ciKp.fingerprint, publicKey: ciKp.publicKey }
  writeConfig(repoRoot, config)

  // write pub key
  writeFileSync(
    join(keysDir(repoRoot), `${ciKp.fingerprint}.pub`),
    JSON.stringify({ name: 'ci', fingerprint: ciKp.fingerprint, publicKey: ciKp.publicKey }, null, 2)
  )

  for (const env of envs) {
    writeToken(repoRoot, env, ciKp, 'read')

    // sync vars
    const lockData = readVarsLock(repoRoot, env)
    for (const [, varData] of Object.entries(lockData.vars || {})) {
      const myBlob = varData.blobs?.[managerIdentity.fingerprint]
      if (!myBlob) continue
      const plaintext = openSealedBox(myBlob, managerIdentity.privateKey)
      varData.blobs[ciKp.fingerprint] = sealBox(plaintext, ciKp.publicKey)
    }
    writeVarsLock(repoRoot, env, lockData)
  }
}

// ── isHeadless ────────────────────────────────────────────────────────────────

describe('isHeadless', () => {
  // save original env vars + platform
  let origSshTty, origSshConn, origDisplay, origPlatform

  before(() => {
    origSshTty  = process.env.SSH_TTY
    origSshConn = process.env.SSH_CONNECTION
    origDisplay = process.env.DISPLAY
    origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  })

  after(() => {
    // restore
    if (origSshTty   === undefined) delete process.env.SSH_TTY
    else process.env.SSH_TTY = origSshTty

    if (origSshConn  === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = origSshConn

    if (origDisplay  === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = origDisplay
  })

  test('returns false when no SSH env vars are set (non-linux)', () => {
    delete process.env.SSH_TTY
    delete process.env.SSH_CONNECTION
    // on macOS / Windows the linux DISPLAY check is not reached
    if (process.platform !== 'linux') {
      assert.equal(isHeadless(), false)
    }
  })

  test('returns true when SSH_TTY is set', () => {
    process.env.SSH_TTY = '/dev/pts/0'
    delete process.env.SSH_CONNECTION
    assert.equal(isHeadless(), true)
    delete process.env.SSH_TTY
  })

  test('returns true when SSH_CONNECTION is set', () => {
    delete process.env.SSH_TTY
    process.env.SSH_CONNECTION = '10.0.0.1 12345 10.0.0.2 22'
    assert.equal(isHeadless(), true)
    delete process.env.SSH_CONNECTION
  })

  test('returns false when neither SSH var is set (non-linux)', () => {
    delete process.env.SSH_TTY
    delete process.env.SSH_CONNECTION
    if (process.platform !== 'linux') {
      assert.equal(isHeadless(), false)
    }
  })
})

// ── buildHtml ────────────────────────────────────────────────────────────────

describe('buildHtml', () => {
  const sample = {
    fingerprint:   'abc123def456',
    privateKeyB64: 'PRIVATEKEYBASE64==',
    publicKeyB64:  'PUBLICKEYBASE64==',
    envs:          ['dev', 'prod'],
  }

  test('returns a string', () => {
    assert.equal(typeof buildHtml(sample), 'string')
  })

  test('includes the fingerprint', () => {
    const html = buildHtml(sample)
    assert.ok(html.includes(sample.fingerprint), 'fingerprint not found in HTML')
  })

  test('includes the private key', () => {
    const html = buildHtml(sample)
    assert.ok(html.includes(sample.privateKeyB64), 'privateKeyB64 not found in HTML')
  })

  test('includes the public key', () => {
    const html = buildHtml(sample)
    assert.ok(html.includes(sample.publicKeyB64), 'publicKeyB64 not found in HTML')
  })

  test('renders an env chip for each environment', () => {
    const html = buildHtml(sample)
    for (const env of sample.envs) {
      assert.ok(html.includes(`env-chip">${env}</span>`), `missing chip for env "${env}"`)
    }
  })

  test('includes the workflow snippet with envs', () => {
    const html = buildHtml(sample)
    for (const env of sample.envs) {
      assert.ok(html.includes(`envlock decrypt --env ${env}`), `workflow snippet missing decrypt for "${env}"`)
    }
  })

  test('includes the Done button that hits /done', () => {
    const html = buildHtml(sample)
    assert.ok(html.includes('onclick="done()"'), 'Done button not found')
    assert.ok(html.includes("fetch('/done')"), '/done endpoint not referenced')
  })

  test('contains copy buttons for all three secret names', () => {
    const html = buildHtml(sample)
    assert.ok(html.includes('ENVLOCK_CI_FINGERPRINT'), 'ENVLOCK_CI_FINGERPRINT label missing')
    assert.ok(html.includes('ENVLOCK_CI_KEY'),         'ENVLOCK_CI_KEY label missing')
    assert.ok(html.includes('ENVLOCK_CI_PUB'),         'ENVLOCK_CI_PUB label missing')
  })

  test('escapes > in the workflow snippet (redirect operators)', () => {
    const html = buildHtml(sample)
    // The snippet contains shell redirects: base64 -d > ~/.envlock/...
    // Those > chars must be HTML-escaped inside the <pre> block
    assert.ok(html.includes('&gt;'), 'HTML entity &gt; not found — redirect operators not escaped')
  })

  test('includes envlock logo SVG', () => {
    const html = buildHtml(sample)
    assert.ok(html.includes('logo-icon'), 'logo SVG not found in HTML')
  })

  test('renders correct HTML structure (doctype, head, body)', () => {
    const html = buildHtml(sample)
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'missing doctype')
    assert.ok(html.includes('<head>'), 'missing <head>')
    assert.ok(html.includes('<body>'), 'missing <body>')
  })
})

// ── CI identity lifecycle ─────────────────────────────────────────────────────

describe('CI identity lifecycle', () => {
  let repoRoot, alice, ciKp

  before(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'envlock-initci-'))
    alice    = generateKeypair('alice')
    ciKp     = generateKeypair('ci')
    setupRepo(repoRoot, [alice], ['dev', 'prod'])
    writeToken(repoRoot, 'dev',  alice, 'manage')
    writeToken(repoRoot, 'prod', alice, 'manage')

    // seed some vars so sync has something to work with
    setVar(repoRoot, 'dev',  'DEV_SECRET',  'dev-value',  alice)
    setVar(repoRoot, 'prod', 'PROD_SECRET', 'prod-value', alice)
  })

  after(() => rmSync(repoRoot, { recursive: true, force: true }))

  test('CI keypair has expected shape', () => {
    assert.ok(ciKp.fingerprint,  'fingerprint missing')
    assert.ok(ciKp.publicKey,    'publicKey missing')
    assert.ok(ciKp.privateKey,   'privateKey missing')
    assert.equal(ciKp.name, 'ci')
  })

  test('adding CI to config and writing pub key succeeds', async () => {
    await addCiIdentity(repoRoot, ciKp, ['dev', 'prod'], alice)

    const config = readConfig(repoRoot)
    assert.ok(config.members['ci'], 'ci not in config members')
    assert.equal(config.members['ci'].fingerprint, ciKp.fingerprint)

    const pubPath = join(keysDir(repoRoot), `${ciKp.fingerprint}.pub`)
    assert.ok(existsSync(pubPath), 'CI pub key file not written')
  })

  test('CI has read token in each selected env', () => {
    for (const env of ['dev', 'prod']) {
      const tokens = readAllTokens(repoRoot, env)
      const ciToken = tokens.find(t => t.fingerprint === ciKp.fingerprint)
      assert.ok(ciToken,                  `CI token missing in ${env}`)
      assert.equal(ciToken.level, 'read', `CI token level should be "read" in ${env}`)
    }
  })

  test('CI can decrypt synced vars in dev', () => {
    const decrypted = decryptAll(repoRoot, 'dev', ciKp)
    assert.equal(decrypted['DEV_SECRET'], 'dev-value')
  })

  test('CI can decrypt synced vars in prod', () => {
    const decrypted = decryptAll(repoRoot, 'prod', ciKp)
    assert.equal(decrypted['PROD_SECRET'], 'prod-value')
  })

  test('vars added AFTER CI has a token are automatically encrypted for CI', () => {
    // setVar reads all current token holders and encrypts for each — CI already
    // has a token, so new vars are encrypted for it immediately.
    setVar(repoRoot, 'dev', 'NEW_VAR', 'new-value', alice)

    const decrypted = decryptAll(repoRoot, 'dev', ciKp)
    assert.equal(decrypted['NEW_VAR'], 'new-value',
      'CI should automatically get vars added after it was granted a token')
  })

  test('CI cannot decrypt vars in an env it was not given access to', async () => {
    // create a third env that CI was never added to
    const stagingAccessDir = accessDir(repoRoot, 'staging')
    mkdirSync(stagingAccessDir, { recursive: true })
    writeFileSync(varsLockPath(repoRoot, 'staging'), JSON.stringify({ version: 2, vars: {} }) + '\n')
    // alice needs a token in staging so setVar can encrypt for her
    writeToken(repoRoot, 'staging', alice, 'manage')
    setVar(repoRoot, 'staging', 'STAGING_SECRET', 'staging-value', alice)
    // CI was never given a token in staging, so it has no blob

    const decrypted = decryptAll(repoRoot, 'staging', ciKp)
    assert.equal(decrypted['STAGING_SECRET'], undefined,
      'CI should not decrypt vars in envs it was never given access to')
  })

  test('CI identity is separate — alice vars still decrypt normally', () => {
    const decrypted = decryptAll(repoRoot, 'dev', alice)
    assert.equal(decrypted['DEV_SECRET'],  'dev-value')
    assert.equal(decrypted['NEW_VAR'],     'new-value')
  })
})

// ── buildHtml with real CI keypair data ───────────────────────────────────────

describe('buildHtml with real keypair data', () => {
  test('fingerprint and keys from a real generateKeypair survive HTML round-trip', () => {
    const kp   = generateKeypair('ci')
    const html = buildHtml({
      fingerprint:   kp.fingerprint,
      privateKeyB64: kp.privateKey,
      publicKeyB64:  kp.publicKey,
      envs:          ['staging'],
    })
    assert.ok(html.includes(kp.fingerprint), 'real fingerprint not found in HTML')
    assert.ok(html.includes(kp.privateKey),  'real private key not found in HTML')
    assert.ok(html.includes(kp.publicKey),   'real public key not found in HTML')
  })

  test('multiple envs all appear as chips', () => {
    const kp   = generateKeypair('ci')
    const envs = ['dev', 'staging', 'prod']
    const html = buildHtml({
      fingerprint:   kp.fingerprint,
      privateKeyB64: kp.privateKey,
      publicKeyB64:  kp.publicKey,
      envs,
    })
    for (const env of envs) {
      assert.ok(html.includes(`env-chip">${env}</span>`), `chip missing for "${env}"`)
    }
  })
})
