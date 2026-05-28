import chalk from 'chalk'
import ora from 'ora'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { loadIdentity } from '../crypto/keygen.js'
import { writeConfig, ENVLOCK_FOLDER, CONFIG_FILE, keysDir, accessDir, varsLockPath } from '../config/config.js'
import { writeToken } from '../config/lockfile.js'
import { requireRepoRoot } from '../utils/repo.js'
import { promptInstallHooks } from './installHooks.js'
import { promptInstallCi }    from './ci.js'

// ── hook scripts written to .envlock/hooks/ (committed to repo) ───────────────
// exported so removeEnv.js can refresh them in existing repos

export const PRE_COMMIT_SCRIPT = `#!/bin/bash

# ── block committing decrypted env files ─────────────────────────────────────
env_file=\$(git diff --cached --name-only 2>/dev/null | grep -E '^\\.env($|\\..+)' | head -1)
if [ -n "\$env_file" ]; then
  echo ""
  echo "  envlock: refusing to commit decrypted env file"
  echo "    \$env_file"
  echo "    remove it: git reset HEAD \\"\$env_file\\""
  echo ""
  exit 1
fi

# ── guard token and vars.lock deletions ───────────────────────────────────────
# Deleting a single token file is only allowed via: envlock revoke <name> --env <env>
# Deleting vars.lock alone is never allowed.
# Deleting an entire env (all tokens + vars.lock together) is allowed via: envlock remove-env <env>

deleted_tokens=\$(git diff --cached --name-only --diff-filter=D 2>/dev/null | grep -E '^\\.envlock/envs/[^/]+/access/[^/]+\\.token\$')
deleted_vars_locks=\$(git diff --cached --name-only --diff-filter=D 2>/dev/null | grep -E '^\\.envlock/envs/[^/]+/vars\\.lock\$')

# for each deleted token, require that its env's vars.lock is also being deleted (full remove-env)
while IFS= read -r token_path; do
  [ -z "\$token_path" ] && continue
  env_name=\$(echo "\$token_path" | cut -d/ -f3)
  if ! echo "\$deleted_vars_locks" | grep -qF ".envlock/envs/\${env_name}/vars.lock"; then
    echo ""
    echo "  envlock: refusing to commit raw deletion of token file"
    echo "    \$token_path"
    echo "    use: envlock revoke <name> --env \${env_name}"
    echo ""
    exit 1
  fi
done <<< "\$deleted_tokens"

# for each deleted vars.lock, require that all its env's tokens are also gone from the index
while IFS= read -r vars_path; do
  [ -z "\$vars_path" ] && continue
  env_name=\$(echo "\$vars_path" | cut -d/ -f3)
  remaining=\$(git ls-files ".envlock/envs/\${env_name}/access/" 2>/dev/null | grep '\\.token\$')
  if [ -n "\$remaining" ]; then
    echo ""
    echo "  envlock: refusing to commit deletion of vars.lock"
    echo "    \$vars_path"
    echo "    use: envlock remove-env \${env_name}"
    echo ""
    exit 1
  fi
done <<< "\$deleted_vars_locks"

exit 0
`

export const POST_MERGE_SCRIPT = `#!/bin/bash

changed=\$(git diff --name-only ORIG_HEAD HEAD 2>/dev/null | grep '^\\.envlock/')

if [ -n "\$changed" ]; then
  echo ""
  echo "  envlock: lock files changed in this pull"
  echo ""
  echo "\$changed" | sed 's/^/    /'
  echo ""

  if command -v envlock &>/dev/null; then
    envlock verify
  else
    echo "  run envlock verify to check integrity"
    echo ""
  fi
fi
`

// ── command ───────────────────────────────────────────────────────────────────

export async function cmdSetup() {
  console.log(chalk.bold('\n  envlock setup\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity found'))
    console.log(`    run ${chalk.bold('envlock init')} first\n`)
    return
  }

  const repoRoot = requireRepoRoot()

  if (existsSync(join(repoRoot, ENVLOCK_FOLDER, CONFIG_FILE))) {
    console.log(chalk.yellow('  ⚠  envlock is already set up in this repo'))
    console.log(`    to re-setup, delete ${chalk.dim('.envlock/')} and run again\n`)
    return
  }

  const { default: Enquirer } = await import('enquirer')
  const enquirer = new Enquirer()

  const { envInput } = await enquirer.prompt({
    type:     'input',
    name:     'envInput',
    message:  'environments (comma separated)',
    initial:  'local,dev,staging,prod',
    validate: v => v.trim().length > 0 || 'enter at least one environment',
  })

  const envs = envInput.split(',').map(e => e.trim()).filter(Boolean)

  const spinner = ora('setting up envlock...').start()

  try {
    // create folder structure
    mkdirSync(keysDir(repoRoot), { recursive: true })

    // copy our public key into the repo
    writeFileSync(
      join(keysDir(repoRoot), `${identity.fingerprint}.pub`),
      JSON.stringify({ name: identity.name, fingerprint: identity.fingerprint, publicKey: identity.publicKey }, null, 2) + '\n'
    )

    // build config.json — display only
    const config = {
      version: 2,
      project: repoRoot.split('/').pop(),
      envs,
      members: {
        [identity.name]: {
          fingerprint: identity.fingerprint,
          publicKey:   identity.publicKey,
        }
      }
    }
    writeConfig(repoRoot, config)

    // create per-env structure: access/ folder + empty vars.lock + founder token
    for (const env of envs) {
      mkdirSync(accessDir(repoRoot, env), { recursive: true })
      writeFileSync(
        varsLockPath(repoRoot, env),
        JSON.stringify({ version: 2, vars: {} }, null, 2) + '\n'
      )
      writeToken(repoRoot, env, identity, 'manage')
    }

    // write hook scripts to .envlock/hooks/ (these get committed)
    const hooksDir = join(repoRoot, ENVLOCK_FOLDER, 'hooks')
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(join(hooksDir, 'pre-commit'),  PRE_COMMIT_SCRIPT,  { mode: 0o755 })
    writeFileSync(join(hooksDir, 'post-merge'),  POST_MERGE_SCRIPT,  { mode: 0o755 })

    // update .gitignore
    const gitignorePath = join(repoRoot, '.gitignore')
    const existing      = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
    if (!existing.includes('# envlock')) {
      const additions = [
        '',
        '# envlock — decrypted env files (never commit these)',
        ...envs.map(e => `.env.${e}`),
        '.env',
        '.envlock/keys/*.key',
      ].join('\n')
      appendFileSync(gitignorePath, additions + '\n')
    }

    spinner.succeed('envlock set up successfully')

    console.log()
    console.log(`  ${chalk.green('✓')} created ${chalk.dim('.envlock/')} folder`)
    console.log(`  ${chalk.green('✓')} you are ${chalk.bold('manage')} on: ${chalk.cyan(envs.join(', '))}`)
    console.log(`  ${chalk.green('✓')} hook scripts written to ${chalk.dim('.envlock/hooks/')}`)
    console.log(`  ${chalk.green('✓')} updated ${chalk.dim('.gitignore')}`)
    console.log()
    console.log('  ' + chalk.dim('commit these files to your repo:'))
    console.log('  ' + chalk.bold('git add .envlock/ .gitignore && git commit -m "chore: init envlock"'))
    console.log()

  } catch (err) {
    spinner.fail('setup failed')
    throw err
  }

  // prompt to install hooks (after spinner is done)
  await promptInstallHooks(repoRoot)

  // prompt to add GitHub Actions CI workflow
  await promptInstallCi(repoRoot)
}
