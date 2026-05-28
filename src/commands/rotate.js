import chalk from 'chalk'
import ora from 'ora'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { loadIdentity, generateKeypair, saveKeypair, ENVLOCK_DIR } from '../crypto/keygen.js'
import { sealBox, openSealedBox } from '../crypto/encrypt.js'
import { readConfig, writeConfig, keysDir } from '../config/config.js'
import { readToken, writeToken, deleteToken, readVarsLock, writeVarsLock } from '../config/lockfile.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

// ── envlock rotate ────────────────────────────────────────────────────────────
//
// Proactive key rotation: generate a new keypair, re-encrypt all your var blobs
// and token proofs under the new key, then update the repo and local identity.
//
// Emergency rotation (key lost/compromised):
//   1. Delete ~/.envlock/identity.json  (or just run envlock init --force)
//   2. Run envlock init  — generates a fresh identity
//   3. Run envlock join  — adds your new public key to the repo
//   4. Ask a manage member to run: envlock add-member <you> && envlock sync <you>

export async function cmdRotate() {
  console.log(chalk.bold('\n  envlock rotate\n'))

  const oldIdentity = loadIdentity()
  if (!oldIdentity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config = readConfig(repoRoot)

  // find this member in config by fingerprint
  const memberName = Object.entries(config.members)
    .find(([, m]) => m.fingerprint === oldIdentity.fingerprint)?.[0]

  if (!memberName) {
    console.log(chalk.red('  ✗ your identity is not a member of this repo'))
    console.log(`    run ${chalk.bold('envlock join')} first\n`)
    return
  }

  // discover which envs we currently have a token in
  const envsWithAccess = []
  for (const env of config.envs) {
    const token = readToken(repoRoot, env, oldIdentity.fingerprint)
    if (token) envsWithAccess.push({ env, level: token.level })
  }

  if (envsWithAccess.length === 0) {
    console.log(chalk.yellow('  ⚠  you have no active env tokens to rotate\n'))
    return
  }

  console.log(`  rotating keys for ${chalk.bold(memberName)}`)
  console.log(`  envs: ${chalk.cyan(envsWithAccess.map(e => e.env).join(', '))}`)
  console.log()

  const { default: Enquirer } = await import('enquirer')
  const { confirm } = await new Enquirer().prompt({
    type:    'confirm',
    name:    'confirm',
    message: 'generate a new keypair and re-encrypt all your blobs?',
    initial: true,
  })
  console.log()

  if (!confirm) {
    console.log(`  ${chalk.dim('rotation cancelled')}\n`)
    return
  }

  const spinner = ora('generating new keypair...').start()

  try {
    // 1. generate new keypair
    const newKp = generateKeypair(oldIdentity.name)
    const newIdentity = {
      name:        newKp.name,
      fingerprint: newKp.fingerprint,
      publicKey:   newKp.publicKey,
      privateKey:  newKp.privateKey,
    }

    spinner.text = 're-encrypting vars...'

    // 2. re-encrypt all var blobs from old key → new key, and swap token files
    for (const { env, level } of envsWithAccess) {
      const lockData = readVarsLock(repoRoot, env)

      for (const [key, varData] of Object.entries(lockData.vars || {})) {
        const myBlob = varData.blobs?.[oldIdentity.fingerprint]
        if (!myBlob) continue  // var we can't decrypt — skip (another manage member has it)

        const plaintext = openSealedBox(myBlob, oldIdentity.privateKey)

        // add blob for new fingerprint, remove old
        varData.blobs[newIdentity.fingerprint] = sealBox(plaintext, newIdentity.publicKey)
        delete varData.blobs[oldIdentity.fingerprint]
      }

      writeVarsLock(repoRoot, env, lockData)

      // swap token files
      writeToken(repoRoot, env, newIdentity, level)
      deleteToken(repoRoot, env, oldIdentity.fingerprint)
    }

    spinner.text = 'updating repo public key...'

    // 3. update public key file in repo
    const oldPubPath = join(keysDir(repoRoot), `${oldIdentity.fingerprint}.pub`)
    if (existsSync(oldPubPath)) unlinkSync(oldPubPath)

    writeFileSync(
      join(keysDir(repoRoot), `${newIdentity.fingerprint}.pub`),
      JSON.stringify({ name: newIdentity.name, fingerprint: newIdentity.fingerprint, publicKey: newIdentity.publicKey }, null, 2) + '\n'
    )

    // 4. update config.json
    config.members[memberName] = {
      ...config.members[memberName],
      fingerprint: newIdentity.fingerprint,
      publicKey:   newIdentity.publicKey,
    }
    // update envs map keys (stored under old fingerprint in some fields — they're just display)
    writeConfig(repoRoot, config)

    spinner.text = 'saving new identity locally...'

    // 5. save new identity to ~/.envlock/ and point identity.json at new fingerprint
    saveKeypair(newIdentity.name, newIdentity.publicKey, newIdentity.privateKey, newIdentity.fingerprint)

    // 6. delete old private key file so it can't be used again
    const oldKeyPath = join(ENVLOCK_DIR, `${oldIdentity.fingerprint}.key`)
    if (existsSync(oldKeyPath)) unlinkSync(oldKeyPath)

    spinner.succeed('key rotation complete')

    console.log()
    console.log(`  ${chalk.green('✓')} new fingerprint: ${chalk.dim(newIdentity.fingerprint)}`)
    console.log(`  ${chalk.green('✓')} re-encrypted vars in: ${chalk.cyan(envsWithAccess.map(e => e.env).join(', '))}`)
    console.log(`  ${chalk.green('✓')} old private key deleted from local machine`)
    console.log()
    console.log('  ' + chalk.dim('commit these changes to your repo:'))
    console.log('  ' + chalk.bold(`git add .envlock/ && git commit -m "chore: rotate keys for ${memberName}"`))
    console.log()
    console.log(`  ${chalk.yellow('⚠')}  if you had vars you couldn't decrypt, ask another manage member to run:`)
    console.log(`     ${chalk.bold(`envlock sync ${memberName}`)}`)
    console.log()

  } catch (err) {
    spinner.fail('rotation failed')
    throw err
  }
}
