import chalk from 'chalk'
import ora from 'ora'
import { existsSync } from 'fs'
import { join } from 'path'
import { generateKeypair, saveKeypair, ENVLOCK_DIR } from '../crypto/keygen.js'

export async function cmdInit(options) {
  console.log(chalk.bold('\n  envlock init\n'))

  // check if already initialised
  const identityPath = join(ENVLOCK_DIR, 'identity.json')
  if (existsSync(identityPath) && !options.force) {
    const identity = JSON.parse((await import('fs')).readFileSync(identityPath, 'utf8'))
    console.log(chalk.yellow('  ⚠  you already have an envlock identity on this machine\n'))
    console.log(`     name:         ${chalk.bold(identity.name)}`)
    console.log(`     fingerprint:  ${chalk.cyan(identity.fingerprint)}\n`)
    console.log(`  run ${chalk.bold('envlock init --force')} to generate a new keypair`)
    console.log(`  ${chalk.dim('(warning: this will invalidate your old key in all repos)')}\n`)
    return
  }

  // ask for name
  const { default: Enquirer } = await import('enquirer')
  const enquirer = new Enquirer()

  const { name } = await enquirer.prompt({
    type:     'input',
    name:     'name',
    message:  'your name (used to identify you in repos)',
    validate: v => v.trim().length >= 2 || 'name must be at least 2 characters',
  })

  const spinner = ora('generating keypair...').start()

  try {
    const { publicKey, privateKey, fingerprint } = generateKeypair(name.trim())
    saveKeypair(name.trim(), publicKey, privateKey, fingerprint)

    spinner.succeed('keypair generated')

    console.log()
    console.log(`  ${chalk.green('✓')} identity created`)
    console.log()
    console.log(`     name:         ${chalk.bold(name.trim())}`)
    console.log(`     fingerprint:  ${chalk.cyan(fingerprint)}`)
    console.log(`     private key:  ${chalk.dim('~/.envlock/' + fingerprint + '.key')}  ${chalk.red('(never share this)')}`)
    console.log(`     public key:   ${chalk.dim('~/.envlock/' + fingerprint + '.pub')}`)
    console.log()
    console.log(`  ${chalk.dim('next: cd into a repo and run')} ${chalk.bold('envlock setup')} ${chalk.dim('or')} ${chalk.bold('envlock join')}`)
    console.log()

  } catch (err) {
    spinner.fail('failed to generate keypair')
    throw err
  }
}
