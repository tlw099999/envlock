<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tlw099999/envlock/main/assets/wordmark-white.svg">
    <img src="https://raw.githubusercontent.com/tlw099999/envlock/main/assets/wordmark.svg" alt="envlock" height="72" />
  </picture>
  <br/><br/>
  <strong>Encrypted env vars that live in your repo. No servers. No shared secrets. Just git.</strong>
  <br/><br/>
  <img src="https://img.shields.io/badge/node-%3E%3D18-8b5cf6?style=flat-square" alt="Node ≥18"/>
  <img src="https://img.shields.io/badge/license-ELv2-7b61ff?style=flat-square" alt="ELv2"/>
</div>

---

Every developer gets their own encrypted copy of the secrets they need. You commit them like code. When someone joins, you run one command. When someone leaves, you run one command. Git is the audit log.

---

## The problem

You've done this. Everyone has.

```
"hey can you send me the .env file?"
```

Or the `.env` is sitting in a shared Notion page. Or it got emailed during onboarding. Or it's the same password it's been since 2021 and nobody knows who still has it.

Tools like Doppler and Vault fix this — but they do it by becoming the new single point of trust. You're not trusting your teammate anymore, you're trusting their servers. And now your CI pipeline, your dev machines, and your production deploys all depend on a third-party being up.

**envlock takes a different approach:** secrets are stored in your repo, encrypted to each person's public key using NaCl asymmetric cryptography. Your private key never leaves your machine. The ciphertext in git is useless to anyone who doesn't have the matching key. There is no server to go down, no account to lock you out, no vendor to trust.

---

## How it works

```
┌─────────────────────────────────────────────────────────┐
│  ~/.envlock/                                             │
│    abc123.key  ← your private key (never leaves here)   │
│    abc123.pub  ← your public key                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  .envlock/  (committed to your repo)                    │
│    keys/                                                │
│      abc123.pub    ← alice's public key                 │
│      def456.pub    ← bob's public key                   │
│    envs/                                                │
│      prod/                                              │
│        vars.lock   ← STRIPE_KEY encrypted for alice     │
│                      STRIPE_KEY encrypted for bob       │
│        access/                                          │
│          abc123.token  ← alice: manage                  │
│          def456.token  ← bob: read                      │
└─────────────────────────────────────────────────────────┘
```

When you add a secret, envlock encrypts it **separately** for every person who has access — using their public key. Only that person's private key can decrypt their copy. Not yours. Not envlock's. Theirs.

When you add a teammate, you run `envlock sync` which re-encrypts all the existing vars for their key too. When someone leaves, you run `envlock revoke` which removes their token and rotates the blobs so their old decrypted files can't be refreshed.

The encrypted files get committed to git. Diffs are readable (`envlock log`). Access is auditable. Rollbacks are `git revert`.

---

## Install

```bash
npm install -g envlock-git
```

> **Note:** The `-g` flag is required — envlock is a global CLI tool, not a project dependency.

Requires Node 18+. Works on macOS, Linux, and Windows.

---

## Quick start

### Setting up a new repo

```bash
# 1. generate your identity — once per machine, stores keys in ~/.envlock/
envlock init

# 2. initialise envlock in your repo
envlock setup
# → prompts for environment names (e.g. local, dev, staging, prod)
# → creates .envlock/ folder structure
# → writes you as the first manage member on every env
# → asks if you want to install git hooks

# 3. add secrets
envlock add STRIPE_SECRET_KEY=sk_live_abc123 --env prod
envlock add DATABASE_URL=postgres://... --env prod
envlock add DEBUG=true --env dev

# 4. decrypt locally whenever you need the .env file
envlock decrypt --env prod
# → writes .env.prod (gitignored automatically)

# 5. commit the encrypted state
git add .envlock/ .gitignore
git commit -m "chore: init envlock"
```

### Onboarding a teammate

```bash
# teammate runs on their machine:
envlock init
envlock join
git add .envlock/
git commit -m "chore: alice joins envlock"
git push

# you run on your machine (after pulling):
envlock add-member alice --env prod --access read --env dev --access write --env staging --access read
# → prompts: "sync vars for alice now?" — say yes
# → encrypts all vars alice can access, in one shot

git add .envlock/
git commit -m "chore: grant alice access"
git push

# alice can now run:
envlock decrypt --env prod
envlock decrypt --env dev
# → .env.prod and .env.dev appear on her machine
```

### Migrating an existing project

Already have `.env` files? Import them in one shot:

```bash
envlock import --env prod
# → detects .env.prod automatically
# → shows a checklist of all vars (new ones pre-checked)
# → you choose exactly what to import or overwrite
# → encrypts everything for all members

# or point to any file explicitly
envlock import --env dev --file .env.example
```

`envlock setup` also prompts to import automatically when it detects existing `.env` files.

### Opening the dashboard

```bash
envlock ui
# → opens a local web UI at localhost:7777
# → browse vars, reveal values, manage members — all in the browser
```

### Running a process with secrets injected

```bash
# instead of: source .env.prod && node server.js
envlock run --env prod node server.js

# works with any command
envlock run --env staging -- npm run db:migrate
envlock run --env dev -- pytest tests/
```

---

## All commands

### Identity & setup

| Command | Description |
|---|---|
| `envlock init` | Generate your keypair (once per machine) |
| `envlock setup` | Initialise envlock in a repo |
| `envlock join` | Add yourself to a repo as a pending member |
| `envlock whoami` | Show your identity and access levels |
| `envlock status` | Your personal access health-check across all envs |

### Secrets

| Command | Description |
|---|---|
| `envlock import --env <env>` | Import vars from an existing `.env` file |
| `envlock add KEY=VALUE --env <env>` | Add a new secret |
| `envlock update KEY=VALUE --env <env>` | Update an existing secret |
| `envlock remove KEY --env <env>` | Remove a secret |
| `envlock list --env <env>` | List all key names (no values) |
| `envlock decrypt --env <env>` | Write decrypted `.env.<env>` file |
| `envlock reveal KEY --env <env>` | Print one value to terminal, clears after 10s |
| `envlock run --env <env> <cmd...>` | Run a command with secrets injected as env vars |

### Team

| Command | Description |
|---|---|
| `envlock members` | Show all members and their access levels |
| `envlock add-member <name> --env <env> --access <level> [...]` | Grant access to one or more envs (prompts to sync immediately) |
| `envlock sync <name>` | Encrypt all current vars for a member across every env they have access to |
| `envlock revoke <name> --env <env> [...]` | Revoke access from one or more envs |
| `envlock revoke <name> --all-envs` | Revoke from every environment at once |
| `envlock remove-env <env>` | Permanently remove an environment and all its vars |

### Key rotation

| Command | Description |
|---|---|
| `envlock rotate` | Generate a new keypair and re-encrypt all your blobs |

### Audit

| Command | Description |
|---|---|
| `envlock verify` | Check integrity of all tokens, keys, and blobs |
| `envlock log --env <env>` | Change history with per-commit key diffs |
| `envlock diff --env <env>` | What changed in the last commit |

### Git hooks & CI

| Command | Description |
|---|---|
| `envlock install-hooks` | Install git hooks locally |
| `envlock install-ci` | Add GitHub Actions CI workflow to this repo |
| `envlock init-ci` | Create a dedicated CI identity and display its secrets securely |

### Dashboard

| Command | Description |
|---|---|
| `envlock ui` | Open the local web dashboard in your browser |

---

## Access levels

Permissions are per-environment. Alice can have `write` on `dev` and only `read` on `prod`.

| Level | Can do |
|---|---|
| `read` | Decrypt and list vars |
| `write` | Add, update, remove vars |
| `manage` | Everything above + add/remove members, sync |

---

## Granting access

`--env` and `--access` are paired flags — repeat them together to grant access to multiple environments in one command:

```bash
# single environment
envlock add-member alice --env prod --access read

# multiple environments, different levels per env
envlock add-member alice \
  --env prod    --access read   \
  --env staging --access read   \
  --env dev     --access write

# add-member prompts to sync immediately — say yes and it's done.
# if you skipped it, or need to re-sync later:
envlock sync alice
```

Access levels are per-environment and independent of each other. Alice can have `write` on `dev` and `read` on `prod` — the same person, different trust levels per environment.

If you forget to pair `--env` with `--access` (or get the counts wrong), envlock tells you exactly what's missing before touching anything.

---

## Revoking access

```bash
# single environment
envlock revoke alice --env prod

# multiple environments
envlock revoke alice --env prod --env staging

# all environments at once — for when someone leaves the team
envlock revoke alice --all-envs
```

Revoke removes their token file and immediately re-encrypts all vars in those environments for the remaining members. Their existing decrypted `.env` files still work locally until they pull.

---

## Git hooks

envlock ships two hooks that protect your repo:

**pre-commit** — blocks you from accidentally committing:
- Decrypted `.env` files (`.env`, `.env.prod`, etc.)
- Raw deletion of token files (use `envlock revoke` instead)
- Raw deletion of `vars.lock` (use `envlock remove` instead)

**post-merge** — runs `envlock verify` after every `git pull` so you know immediately if someone updated access and you need to re-decrypt.

Hooks live in `.envlock/hooks/` and are committed to the repo. `envlock install-hooks` adds thin callers to your local `.git/hooks/` — it never overwrites an existing hook, only appends.

---

## What if I lose my private key?

Your private key is in `~/.envlock/<fingerprint>.key`. If you lose it:

1. Run `envlock init` on a new machine — generates a fresh identity
2. Run `envlock join` — adds your new public key to the repo
3. Ask a manage member to run `envlock add-member <you>` then `envlock sync <you>`

You lose access to any existing decrypted files but get re-encrypted copies of everything from the current state. The git history is intact.

If your key is **compromised** (not just lost), the manage member should run `envlock revoke <you>` first to rotate the blobs, then re-add you with a new key.

---

## Security model

- **Asymmetric encryption** — NaCl `box` with Curve25519 keys + XSalsa20-Poly1305. Each var is encrypted separately for each recipient.
- **Sealed boxes** — encryption uses an ephemeral sender keypair discarded immediately. No `senderPublicKey` is embedded in the ciphertext. Forward secrecy: old blobs cannot be decrypted even if a key is later compromised.
- **Per-member token files** — access tokens are individual files (`access/<fingerprint>.token`). Different teammates writing different tokens never conflict in git.
- **Tamper detection** — each token contains a plain `level` field and an encrypted `proof`. `envlock verify` decrypts the proof and compares — if they differ, the file was tampered with.
- **Private keys never leave `~/.envlock/`** — nothing in the repo can be used to decrypt anything without the local private key file.
- **No server, no cloud** — envlock has no network calls. The encrypted state is just files in your repo.

---

## CI integration

envlock works with **any git host** — GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, or self-hosted. The encrypted state is just files in your repo. There is no platform-specific dependency.

Run `envlock verify` on every push and PR to catch drift before it hits production — a member added without syncing, a token missing, a blob tampered.

No secrets needed — `envlock verify` only checks structure and coverage, not values.

### Giving CI access to your secrets

CI pipelines need to decrypt secrets too. `envlock init-ci` creates a dedicated CI identity, syncs all the vars it needs, then shows you exactly three secrets to add to your provider — the private key, the public key, and the fingerprint.

```bash
envlock init-ci
# → prompts: which environments should CI have access to?
# → generates a dedicated CI keypair
# → syncs all vars for those environments
# → opens a local browser page with the three secrets to copy
#   (terminal fallback for SSH/headless environments)

# commit the new CI identity
git add .envlock/
git commit -m "ci: add CI identity"
```

The browser page shuts down the moment you click **Done** — the private key is never written to disk, never appears in your terminal, and is not stored anywhere by envlock.

**On headless / SSH machines:** the secrets are printed to the terminal and the screen is cleared after you press Enter, with a reminder to run `history -c`.

Once you've copied the three values into your CI provider, add this step to your workflow:

```yaml
- name: Set up envlock CI identity
  env:
    ENVLOCK_CI_KEY: ${{ secrets.ENVLOCK_CI_KEY }}
    ENVLOCK_CI_PUB: ${{ secrets.ENVLOCK_CI_PUB }}
    ENVLOCK_CI_FP:  ${{ secrets.ENVLOCK_CI_FINGERPRINT }}
  run: |
    mkdir -p ~/.envlock
    echo "$ENVLOCK_CI_KEY" | base64 -d > ~/.envlock/$ENVLOCK_CI_FP.key
    echo "$ENVLOCK_CI_PUB" | base64 -d > ~/.envlock/$ENVLOCK_CI_FP.pub
    echo '{"name":"ci","fingerprint":"'"$ENVLOCK_CI_FP"'","publicKey":"'"$ENVLOCK_CI_PUB"'"}' \
      > ~/.envlock/identity.json

- name: Decrypt secrets
  run: envlock decrypt --env prod
```

### GitHub Actions (verify workflow)

```bash
envlock install-ci
```

Writes `.github/workflows/envlock-verify.yml` into your repo. Commit it and every PR is covered. `envlock setup` also prompts you to add this automatically.

### GitLab CI

```yaml
envlock-verify:
  image: node:20
  script:
    - npm install -g envlock-git
    - envlock verify
```

### Bitbucket Pipelines

```yaml
pipelines:
  default:
    - step:
        name: envlock verify
        image: node:20
        script:
          - npm install -g envlock-git
          - envlock verify
```

### Any other CI

Just install and run:
```bash
npm install -g envlock-git
envlock verify
```

If the check fails, the output tells you exactly what to run to fix it:

| Output | Fix |
|---|---|
| `missing blob for <member> on <key>` | `envlock sync <member>` |
| `missing token for <member>` | `envlock add-member <member> --env <env> --access read` |
| `tampered token: <member>` | Restore `.token` file from git |

---

## Why not Doppler / Vault / AWS Secrets Manager?

Those are good tools. Use them if you're on a team that can manage the operational overhead.

envlock is for teams that want secrets to live where the code lives — in git — with no external dependency, no SaaS subscription, and no vendor lock-in. If your repo is accessible, your secrets are accessible. Offline, airgapped, or just "I don't want another dashboard to log into."

**Works with any git host.** GitHub, GitLab, Bitbucket, Azure DevOps, Gitea, self-hosted — envlock doesn't care. It's files in a repo, not a platform integration.

The tradeoff: envlock doesn't have webhooks or dynamic secret rotation. It's a CLI tool (with a local web UI) that wraps NaCl encryption around your git workflow.

---

## License

[Elastic License 2.0 (ELv2)](LICENSE)

**The short version:**
- ✅ Use envlock freely as your team's secret manager
- ✅ Read and audit the source code
- ✅ Modify it for your own internal use
- ❌ Offer it as a hosted or managed service to others
- ❌ Fork it and build a competing product

The full license text is in [LICENSE](LICENSE).
