import chalk from 'chalk'
import { existsSync } from 'fs'
import { loadIdentity, loadPublicKey, deriveFingerprint } from '../crypto/keygen.js'
import { readConfig, keysDir, accessDir, varsLockPath } from '../config/config.js'
import { readAllTokens, readToken, getMyLevel, readVarsLock, decryptAll } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

export async function cmdVerify() {
  console.log(chalk.bold('\n  envlock verify\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  let issues = 0
  const fail = (msg) => { console.log(`  ${chalk.red('✗')}  ${msg}`); issues++ }
  const warn = (msg) => { console.log(`  ${chalk.yellow('⚠')}  ${msg}`); issues++ }
  const pass = (msg) =>   console.log(`  ${chalk.green('✓')}  ${msg}`)
  const skip = (msg) =>   console.log(`  ${chalk.dim('–')}  ${msg}`)

  // ── config ────────────────────────────────────────────────────────────────
  console.log(chalk.dim('  config'))

  const config = readConfig(repoRoot)
  if (!config) {
    fail('config.json — missing or invalid JSON')
    console.log()
    return
  }
  pass('config.json — valid')
  console.log()

  // ── keys ──────────────────────────────────────────────────────────────────
  console.log(chalk.dim('  keys'))

  for (const [name, member] of Object.entries(config.members)) {
    const pubData = loadPublicKey(repoRoot, member.fingerprint)
    if (!pubData) {
      fail(`${name} — key file missing (.envlock/keys/${member.fingerprint}.pub)`)
      continue
    }
    const derivedFp = deriveFingerprint(pubData.publicKey)
    if (derivedFp !== member.fingerprint) {
      fail(`${name} — fingerprint mismatch (key file corrupted or swapped)`)
    } else {
      pass(`${name} ${chalk.dim(member.fingerprint)} — key OK`)
    }
  }
  console.log()

  // ── environments ──────────────────────────────────────────────────────────
  for (const env of config.envs) {
    console.log(chalk.dim(`  ${env}`))

    // access/ folder
    if (!existsSync(accessDir(repoRoot, env))) {
      fail(`${env}/access/ — folder missing`)
      console.log()
      continue
    }

    // vars.lock
    if (!existsSync(varsLockPath(repoRoot, env))) {
      fail(`${env}/vars.lock — file missing`)
      console.log()
      continue
    }

    const tokens  = readAllTokens(repoRoot, env)
    const lockData = readVarsLock(repoRoot, env)
    const varKeys  = Object.keys(lockData.vars || {})

    // every member listed in config with envs access should have a token
    const membersWithAccess = Object.entries(config.members)
      .filter(([, m]) => m.envs?.[env])

    for (const [name, member] of membersWithAccess) {
      const token = tokens.find(t => t.fingerprint === member.fingerprint)
      if (!token) {
        fail(`${name} — no token file in ${env} (run: envlock sync ${name})`)
      } else {
        pass(`${name} — token present (${chalk.bold(token.level)})`)
      }
    }

    // every var must have a blob for every token holder
    if (varKeys.length === 0) {
      skip('no vars yet')
    } else {
      let missingBlobs = 0
      for (const token of tokens) {
        const memberName = Object.entries(config.members)
          .find(([, m]) => m.fingerprint === token.fingerprint)?.[0] || token.fingerprint.slice(0, 8)
        for (const key of varKeys) {
          if (!lockData.vars[key]?.blobs?.[token.fingerprint]) {
            fail(`${key} — missing blob for ${memberName} (run: envlock sync ${memberName})`)
            missingBlobs++
          }
        }
      }
      if (missingBlobs === 0) {
        pass(`${varKeys.length} var${varKeys.length !== 1 ? 's' : ''} — all members have blobs`)
      }
    }

    // verify own token proof decrypts and matches plain level
    const myToken = readToken(repoRoot, env, identity.fingerprint)
    if (myToken) {
      const verifiedLevel = getMyLevel(repoRoot, env, identity)
      if (!verifiedLevel) {
        fail(`your token in ${env} — proof failed to decrypt or level was tampered`)
      } else {
        pass(`your token proof decrypts — ${chalk.bold(verifiedLevel)}`)
      }

      // verify own var blobs decrypt
      if (varKeys.length > 0) {
        try {
          const decrypted = decryptAll(repoRoot, env, identity)
          const count     = Object.keys(decrypted).length
          if (count === varKeys.length) {
            pass(`your var blobs decrypt — ${count}/${varKeys.length}`)
          } else {
            warn(`your var blobs partially decrypt — ${count}/${varKeys.length} (run: envlock sync ${identity.name})`)
          }
        } catch (err) {
          fail(`your var blobs failed to decrypt — ${err.message}`)
        }
      }
    } else {
      skip(`your token — not present (you don't have access to ${env})`)
    }

    // orphan tokens — token files for fingerprints not in config.members
    const configFps = new Set(Object.values(config.members).map(m => m.fingerprint))
    for (const token of tokens) {
      if (!configFps.has(token.fingerprint)) {
        warn(`orphan token for unknown fingerprint ${token.fingerprint.slice(0, 8)}... in ${env}`)
      }
    }

    console.log()
  }

  // ── summary ───────────────────────────────────────────────────────────────
  if (issues === 0) {
    console.log(`  ${chalk.green('✓')} all checks passed\n`)
  } else {
    console.log(`  ${chalk.red('✗')} ${issues} issue${issues !== 1 ? 's' : ''} found\n`)
    process.exitCode = 1
  }
}
