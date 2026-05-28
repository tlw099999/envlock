# envlock roadmap

## ✅ completed

### core commands
- [x] `envlock init` — generate personal keypair in `~/.envlock/`
- [x] `envlock setup` — initialise envlock in a repo
- [x] `envlock join` — join an existing envlock repo (adds public key + pending flag)
- [x] `envlock add KEY=VALUE --env <env>` — add a new env var
- [x] `envlock update KEY=VALUE --env <env>` — update an existing env var
- [x] `envlock remove KEY --env <env>` — remove an env var
- [x] `envlock decrypt --env <env>` — decrypt vars to local `.env` file
- [x] `envlock reveal KEY --env <env>` — show single value in terminal, clears after 10s
- [x] `envlock list --env <env>` — list key names + metadata (no values)
- [x] `envlock members` — show all members and permissions
- [x] `envlock whoami` — show your identity and access levels
- [x] `envlock add-member <name> --env <env> --access <level>` — grant access
- [x] `envlock revoke <name> --env <env>` — revoke access + rewrap remaining vars
- [x] `envlock rewrap <name>` — encrypt all vars for a member (run after add-member)

### security architecture (v2 redesign)
- [x] switched from `nacl.box` (authenticated) to sealed boxes (ephemeral sender key, anonymous) — no `senderPublicKey` bug
- [x] per-member token files (`access/<fp>.token`) replace shared `config.json.lock` — eliminates concurrent write conflicts
- [x] token proof: level is encrypted to the member's own public key — tamper detection without a trusted server
- [x] `vars.lock` stores per-member blobs (`blobs: { <fp>: sealedBox }`) — one file per env, no shared symmetric key

### audit commands
- [x] `envlock verify` — check integrity of all token files, key fingerprints, blob coverage. exits 1 on issues (CI-safe)
- [x] `envlock log --env <env>` — change history from git log with per-commit key diffs
- [x] `envlock diff --env <env>` — what changed in the last commit for an env

### git hooks + developer experience
- [x] `envlock install-hooks` — installs git hooks locally (append-only, never overwrites existing hooks)
- [x] `pre-commit` hook — blocks committing decrypted `.env` files + raw deletion of token files / `vars.lock`
- [x] `post-merge` hook — runs `envlock verify` after every pull so drift is caught immediately
- [x] `setup` and `join` prompt the user before installing hooks (y/n, never auto-installs)
- [x] hook scripts live in `.envlock/hooks/` (committed) — thin callers in `.git/hooks/` delegate to them

### power commands
- [x] `envlock rotate` — proactive key rotation: generates new keypair, re-encrypts all your blobs, swaps token files, deletes old private key
- [x] `envlock run --env <env> <cmd...>` — decrypt vars and inject them into a child process (`envlock run --env prod node server.js`)
- [x] `envlock remove-env <env>` — safe env deletion (manage only): removes all tokens + vars.lock, updates config, refreshes hook script so git doesn't block the commit
- [x] `envlock status` — personal health-check: your level per env, blob coverage, pending/tampered token detection

---

### tests
- [x] `node:test` set up (built-in, ESM-native, no extra deps) — 67 tests passing
- [x] `test/crypto/encrypt.test.js` — sealBox/openSealedBox roundtrip, wrong-key + tamper rejection, sealForAll
- [x] `test/crypto/keygen.test.js` — keypair generation, fingerprint determinism + uniqueness
- [x] `test/config/lockfile.test.js` — token CRUD, tamper detection, setVar/decryptAll/rewrapVars lifecycle
- [x] `test/integration/workflow.test.js` — full 31-step story: setup → vars → grant → sync → tamper → revoke → rotate

### GitHub Actions
- [x] `.github/workflows/test.yml` — `npm test` on push + PR, Node 18 + 20 (envlock's own CI)
- [x] `envlock install-ci` — drops `envlock-verify.yml` into user's `.github/workflows/` with `--force` flag
- [x] `envlock setup` prompts to add the CI workflow after hooks prompt
- [x] CI workflow template embedded in `src/commands/ci.js` (not a file in the envlock repo)
- [x] README "CI integration" section updated

---

## 🔲 up next

### 1. npm publish + release pipeline  ← start here

- [ ] fill in `author` field in package.json with real name/email
- [ ] `npm publish --dry-run` to verify the package contents
- [ ] `npm publish` — first manual publish to claim the package name
- [ ] `.github/workflows/release.yml` — on tag push: run tests → publish to npm → create GitHub release

### 3. landing page

- [ ] envlock.dev — problem statement, one-liner, `npm install -g envlock`, link to GitHub
- [ ] keep it minimal: the README already has the best copy, just needs a web face

---

## 💡 post-launch

- [ ] Homebrew formula — once npm install isn't enough for some users
- [ ] VS Code extension — surface `envlock status` in the status bar, warn when `.env.*` is modified
- [ ] shell integration — `eval "$(envlock shellhook)"` exports vars directly into the current shell session
- [ ] binary builds (`pkg`) — macOS arm64/x64, Linux x64, Windows x64
