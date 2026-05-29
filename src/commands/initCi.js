import chalk        from 'chalk'
import ora          from 'ora'
import { createServer } from 'http'
import { exec }     from 'child_process'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join }     from 'path'
import { loadIdentity, generateKeypair } from '../crypto/keygen.js'
import { readConfig, writeConfig, keysDir } from '../config/config.js'
import { writeToken, readAllTokens, readVarsLock, writeVarsLock } from '../config/lockfile.js'
import { sealBox, openSealedBox }  from '../crypto/encrypt.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'

// ── browser detection ─────────────────────────────────────────────────────────

export function isHeadless() {
  if (process.env.SSH_TTY || process.env.SSH_CONNECTION) return true
  if (process.platform === 'linux' && !process.env.DISPLAY) return true
  return false
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open'
  exec(cmd + ' ' + url, () => {})
}

// ── one-time HTML page ────────────────────────────────────────────────────────

export function buildHtml({ fingerprint, privateKeyB64, publicKeyB64, envs }) {
  const workflowSnippet = `- name: Set up envlock CI identity
  env:
    ENVLOCK_CI_KEY: \${{ secrets.ENVLOCK_CI_KEY }}
    ENVLOCK_CI_PUB: \${{ secrets.ENVLOCK_CI_PUB }}
    ENVLOCK_CI_FP:  \${{ secrets.ENVLOCK_CI_FINGERPRINT }}
  run: |
    mkdir -p ~/.envlock
    echo "$ENVLOCK_CI_KEY" | base64 -d > ~/.envlock/$ENVLOCK_CI_FP.key
    echo "$ENVLOCK_CI_PUB" | base64 -d > ~/.envlock/$ENVLOCK_CI_FP.pub
    echo '{"name":"ci","fingerprint":"'$ENVLOCK_CI_FP'","publicKey":"${publicKeyB64}"}' \\
      > ~/.envlock/identity.json

- name: Decrypt secrets
  run: |
${envs.map(e => `    envlock decrypt --env ${e}`).join('\n')}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>envlock CI setup</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }

    :root {
      --bg:          #07080D;
      --card:        #0F111A;
      --surface:     #161824;
      --border:      rgba(255,255,255,0.07);
      --border-light:rgba(255,255,255,0.12);
      --accent:      #7B61FF;
      --accent-soft: rgba(123,97,255,0.12);
      --accent-glow: rgba(123,97,255,0.25);
      --text:        rgba(255,255,255,0.92);
      --text-dim:    rgba(255,255,255,0.55);
      --text-muted:  rgba(255,255,255,0.30);
      --green:       #34D399;
      --green-soft:  rgba(52,211,153,0.12);
      --red:         #F87171;
      --radius:      8px;
      --radius-lg:   12px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 20px 60px;
    }

    /* ── header ── */
    .header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      margin-bottom: 36px;
      text-align: center;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .logo-text {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: var(--text);
    }

    .header-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
    }

    .header-sub {
      font-size: 13px;
      color: var(--text-dim);
      max-width: 480px;
      line-height: 1.6;
    }

    .warning-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(248,113,113,0.10);
      border: 1px solid rgba(248,113,113,0.25);
      color: var(--red);
      border-radius: 99px;
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 500;
    }

    /* ── card ── */
    .card {
      width: 100%;
      max-width: 620px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: 16px;
      overflow: hidden;
    }

    .card-head {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .copy-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: background 0.15s;
    }
    .copy-btn:hover { background: var(--accent-glow) }
    .copy-btn.copied {
      background: var(--green-soft);
      color: var(--green);
    }

    .card-body {
      padding: 14px 18px;
    }

    .secret-value {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12px;
      color: var(--text-dim);
      word-break: break-all;
      line-height: 1.6;
      background: var(--surface);
      border-radius: 6px;
      padding: 10px 12px;
    }

    .fp-value {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      color: var(--accent);
      letter-spacing: 0.5px;
    }

    /* ── workflow snippet ── */
    .snippet {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12px;
      color: var(--text-dim);
      white-space: pre;
      overflow-x: auto;
      line-height: 1.7;
      background: var(--surface);
      border-radius: 6px;
      padding: 14px;
    }

    /* ── envs list ── */
    .envs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 14px 18px;
    }

    .env-chip {
      padding: 3px 10px;
      border-radius: 99px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 12px;
      font-weight: 500;
      border: 1px solid rgba(123,97,255,0.20);
    }

    /* ── done button ── */
    .done-wrap {
      width: 100%;
      max-width: 620px;
      margin-top: 8px;
    }

    .done-btn {
      width: 100%;
      padding: 13px;
      border-radius: var(--radius);
      background: var(--accent);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s;
    }
    .done-btn:hover { opacity: 0.88 }

    .done-sub {
      text-align: center;
      margin-top: 10px;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ── divider ── */
    .divider {
      width: 100%;
      max-width: 620px;
      height: 1px;
      background: var(--border);
      margin: 8px 0 16px;
    }

    .section-title {
      width: 100%;
      max-width: 620px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 10px;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="logo">
      <svg class="logo-icon" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#5B41E0"/>
            <stop offset="100%" stop-color="#9070FF"/>
          </linearGradient>
          <linearGradient id="shine" x1="100" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="white" stop-opacity="0.13"/>
            <stop offset="100%" stop-color="white" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="200" height="200" rx="46" fill="url(#bg)"/>
        <rect width="200" height="100" rx="46" fill="url(#shine)"/>
        <path d="M71 114 L71 87 A29 29 0 0 1 129 87 L129 114"
          stroke="white" stroke-width="15" stroke-linecap="round" fill="none" stroke-opacity="0.97"/>
        <rect x="49" y="112" width="102" height="66" rx="14" fill="white" fill-opacity="0.96"/>
        <circle cx="100" cy="139" r="11.5" fill="url(#bg)"/>
        <rect x="95.5" y="145" width="9" height="14" rx="3.5" fill="url(#bg)"/>
      </svg>
      <span class="logo-text">envlock</span>
    </div>
    <div class="header-title">CI Setup</div>
    <div class="header-sub">
      Copy these secrets into your CI provider. This page is served locally
      and will shut down once you click Done.
    </div>
    <div class="warning-pill">
      ⚠ These values will not be shown again
    </div>
  </div>

  <!-- CI Environments -->
  <div class="section-title">CI has access to</div>
  <div class="card" style="margin-bottom:16px">
    <div class="envs">
      ${envs.map(e => `<span class="env-chip">${e}</span>`).join('\n      ')}
    </div>
  </div>

  <div class="divider"></div>
  <div class="section-title">Secrets to add to your CI provider</div>

  <!-- ENVLOCK_CI_FINGERPRINT -->
  <div class="card">
    <div class="card-head">
      <span class="card-label">ENVLOCK_CI_FINGERPRINT</span>
      <button class="copy-btn" onclick="copyValue('fp', this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>
    </div>
    <div class="card-body">
      <div class="fp-value" id="fp">${fingerprint}</div>
    </div>
  </div>

  <!-- ENVLOCK_CI_KEY -->
  <div class="card">
    <div class="card-head">
      <span class="card-label">ENVLOCK_CI_KEY</span>
      <button class="copy-btn" onclick="copyValue('key', this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>
    </div>
    <div class="card-body">
      <div class="secret-value" id="key">${privateKeyB64}</div>
    </div>
  </div>

  <!-- ENVLOCK_CI_PUB -->
  <div class="card">
    <div class="card-head">
      <span class="card-label">ENVLOCK_CI_PUB</span>
      <button class="copy-btn" onclick="copyValue('pub', this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>
    </div>
    <div class="card-body">
      <div class="secret-value" id="pub">${publicKeyB64}</div>
    </div>
  </div>

  <div class="divider"></div>
  <div class="section-title">GitHub Actions workflow snippet</div>

  <!-- Workflow snippet -->
  <div class="card">
    <div class="card-head">
      <span class="card-label">Add to your workflow YAML</span>
      <button class="copy-btn" onclick="copyValue('snippet', this)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>
    </div>
    <div class="card-body">
      <pre class="snippet" id="snippet">${workflowSnippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>
  </div>

  <!-- Done button -->
  <div class="done-wrap">
    <button class="done-btn" onclick="done()">Done — shut down this page</button>
    <div class="done-sub">Clicking Done will permanently close this server. The secrets shown here will not be accessible again.</div>
  </div>

  <script>
    async function copyValue(id, btn) {
      const text = document.getElementById(id).innerText
      await navigator.clipboard.writeText(text)
      btn.classList.add('copied')
      btn.innerHTML = \`
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Copied
      \`
      setTimeout(() => {
        btn.classList.remove('copied')
        btn.innerHTML = \`
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        \`
      }, 2000)
    }

    async function done() {
      await fetch('/done').catch(() => {})
      document.body.innerHTML = \`
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px;color:rgba(255,255,255,0.4);font-family:system-ui">
          <svg width="40" height="40" viewBox="0 0 200 200" fill="none">
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#5B41E0"/><stop offset="100%" stop-color="#9070FF"/>
              </linearGradient>
            </defs>
            <rect width="200" height="200" rx="46" fill="url(#g)"/>
            <polyline points="60,105 90,135 145,75" stroke="white" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          <div style="font-size:15px;color:rgba(255,255,255,0.6)">All done — server shut down</div>
          <div style="font-size:12px">You can close this tab</div>
        </div>
      \`
    }
  </script>

</body>
</html>`
}

// ── terminal fallback (headless / SSH) ────────────────────────────────────────

async function terminalFallback({ fingerprint, privateKeyB64, publicKeyB64, envs }) {
  const readline = await import('readline')

  console.log()
  console.log(chalk.yellow('  ⚠  no browser detected — displaying secrets in terminal'))
  console.log(chalk.dim('  copy the values below into your CI provider\n'))

  console.log(`  ${chalk.bold('ENVLOCK_CI_FINGERPRINT')}`)
  console.log(`  ${chalk.cyan(fingerprint)}\n`)

  console.log(`  ${chalk.bold('ENVLOCK_CI_KEY')}`)
  console.log(`  ${chalk.dim(privateKeyB64)}\n`)

  console.log(`  ${chalk.bold('ENVLOCK_CI_PUB')}`)
  console.log(`  ${chalk.dim(publicKeyB64)}\n`)

  console.log(`  ${chalk.bold('GitHub Actions snippet')}`)
  console.log(chalk.dim(`
  - name: Set up envlock CI identity
    env:
      ENVLOCK_CI_KEY: \${{ secrets.ENVLOCK_CI_KEY }}
      ENVLOCK_CI_PUB: \${{ secrets.ENVLOCK_CI_PUB }}
      ENVLOCK_CI_FP:  \${{ secrets.ENVLOCK_CI_FINGERPRINT }}
    run: |
      mkdir -p ~/.envlock
      echo "$ENVLOCK_CI_KEY" | base64 -d > ~/.envlock/$ENVLOCK_CI_FP.key
      echo "$ENVLOCK_CI_PUB" | base64 -d > ~/.envlock/$ENVLOCK_CI_FP.pub
      echo '{"name":"ci","fingerprint":"'$ENVLOCK_CI_FP'","publicKey":"${publicKeyB64}"}' \\
        > ~/.envlock/identity.json

  - name: Decrypt secrets
    run: |
${envs.map(e => `      envlock decrypt --env ${e}`).join('\n')}
  `))

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise(resolve => {
    rl.question(`  ${chalk.dim('Press Enter to clear the screen...')}`, () => {
      rl.close()
      resolve()
    })
  })

  // clear terminal
  process.stdout.write('\x1Bc')
  console.log(`\n  ${chalk.green('✓')} screen cleared\n`)
  console.log(`  ${chalk.dim('tip: run')} ${chalk.bold('history -c')} ${chalk.dim('to clear shell history too')}\n`)
}

// ── main command ──────────────────────────────────────────────────────────────

export async function cmdInitCi(options = {}) {
  console.log(chalk.bold('\n  envlock init-ci\n'))

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity — run envlock init first\n'))
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  const config = readConfig(repoRoot)

  // check if CI member already exists
  const existingCi = Object.entries(config.members).find(([name]) => name === 'ci')
  if (existingCi && !options.force) {
    console.log(chalk.yellow('  ⚠  a CI identity already exists in this repo'))
    console.log(`  run with ${chalk.bold('--force')} to regenerate\n`)
    return
  }

  const { default: Enquirer } = await import('enquirer')
  const enquirer = new Enquirer()

  // pick envs
  const { selectedEnvs } = await enquirer.prompt({
    type:    'multiselect',
    name:    'selectedEnvs',
    message: 'which environments should CI have access to?',
    choices: config.envs,
    initial: config.envs,
  })
  console.log()

  if (!selectedEnvs || selectedEnvs.length === 0) {
    console.log(chalk.yellow('  no environments selected — cancelled\n'))
    return
  }

  // generate CI keypair
  const spinner = ora('generating CI keypair...').start()

  const ciKp = generateKeypair('ci')

  // add CI to config
  config.members['ci'] = {
    fingerprint: ciKp.fingerprint,
    publicKey:   ciKp.publicKey,
  }
  writeConfig(repoRoot, config)

  // write CI public key to repo
  writeFileSync(
    join(keysDir(repoRoot), `${ciKp.fingerprint}.pub`),
    JSON.stringify({ name: 'ci', fingerprint: ciKp.fingerprint, publicKey: ciKp.publicKey }, null, 2) + '\n'
  )

  // grant read access + sync vars for each selected env
  spinner.text = `syncing vars for CI across ${selectedEnvs.join(', ')}...`

  for (const env of selectedEnvs) {
    writeToken(repoRoot, env, ciKp, 'read')

    // rewrap all vars for CI using manager's identity
    const lockData = readVarsLock(repoRoot, env)
    const myLevel  = (await import('../config/lockfile.js')).getMyLevel(repoRoot, env, identity)

    if (!myLevel || myLevel === 'read') {
      spinner.warn(`skipping ${env} — you need write or manage access to sync`)
      continue
    }

    // decrypt each var with our key, re-encrypt for CI
    for (const [key, varData] of Object.entries(lockData.vars || {})) {
      const myBlob = varData.blobs?.[identity.fingerprint]
      if (!myBlob) continue
      const plaintext = openSealedBox(myBlob, identity.privateKey)
      varData.blobs[ciKp.fingerprint] = sealBox(plaintext, ciKp.publicKey)
    }

    writeVarsLock(repoRoot, env, lockData)
  }

  spinner.succeed('CI identity created and vars synced')

  console.log()
  console.log(`  ${chalk.green('✓')} fingerprint: ${chalk.dim(ciKp.fingerprint)}`)
  console.log(`  ${chalk.green('✓')} access: ${chalk.cyan(selectedEnvs.join(', '))} (read)`)
  console.log()
  console.log('  ' + chalk.dim('commit these changes:'))
  console.log('  ' + chalk.bold('git add .envlock/ && git commit -m "ci: add CI identity"'))
  console.log()

  // encode keys as base64 for CI secrets
  const privateKeyB64 = Buffer.from(ciKp.privateKey, 'base64').toString('base64')
  const publicKeyB64  = ciKp.publicKey

  const setupData = {
    fingerprint:   ciKp.fingerprint,
    privateKeyB64: ciKp.privateKey,
    publicKeyB64:  ciKp.publicKey,
    envs:          selectedEnvs,
  }

  // ── show secrets ──
  if (!isHeadless() && !options.noOpen) {
    // browser mode
    const html = buildHtml(setupData)

    const server = createServer((req, res) => {
      if (req.url === '/done') {
        res.writeHead(200)
        res.end('ok')
        console.log(`  ${chalk.green('✓')} browser setup complete — server shut down\n`)
        server.close()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })

    const port = options.port || 7778
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}`
      console.log(`  ${chalk.dim('opening browser at')} ${chalk.bold(url)}`)
      console.log(`  ${chalk.dim('click "Done" in the browser when finished\n')}`)
      openBrowser(url)
    })

    server.on('error', async () => {
      // fallback to terminal if server fails
      await terminalFallback(setupData)
    })

  } else {
    // headless fallback
    await terminalFallback(setupData)
  }
}
