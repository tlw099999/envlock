import { createServer }   from 'http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, statSync } from 'fs'
import { extname, join, dirname } from 'path'
import { homedir }        from 'os'
import { exec, spawn }    from 'child_process'
import { fileURLToPath }  from 'url'
import chalk              from 'chalk'
import ora                from 'ora'

import { loadIdentity }              from '../crypto/keygen.js'
import { requireRepoRoot, requireEnvlockRepo } from '../utils/repo.js'
import { readConfig }                from '../config/config.js'
import { readAllTokens, getMyLevel, listKeys, readVarsLock, setVar, removeVar, decryptAll } from '../config/lockfile.js'

const __dir = dirname(fileURLToPath(import.meta.url))

const UI_SRC_DIR   = join(__dir, '../../ui-src')
const UI_CACHE_DIR = join(homedir(), '.envlock', 'ui')
const UI_DIST_DIR  = join(UI_CACHE_DIR, 'dist')
const VERSION_FILE = join(UI_CACHE_DIR, '.version')

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.png':   'image/png',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.ttf':   'font/ttf',
}

const LEVELS = { read: 1, write: 2, manage: 3 }

// ── version helpers ───────────────────────────────────────────────────────────

function getPackageVersion() {
  return JSON.parse(readFileSync(join(__dir, '../../package.json'), 'utf8')).version
}

function getCachedVersion() {
  return existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, 'utf8').trim() : null
}

// ── build helpers ─────────────────────────────────────────────────────────────

function runProc(cmd, args, cwd, silent = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: silent ? 'pipe' : 'inherit' })
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} failed (exit ${code})`)))
    proc.on('error', reject)
  })
}

async function setupUi(options = {}) {
  const version   = getPackageVersion()
  const cached    = getCachedVersion()
  const isBuilt   = existsSync(UI_DIST_DIR)
  const upToDate  = isBuilt && cached === version

  if (upToDate && !options.rebuild) return

  const isFirst = !isBuilt || !cached
  console.log(chalk.bold(isFirst
    ? '\n  setting up envlock UI (first time)...\n'
    : `\n  updating envlock UI (v${cached} → v${version})...\n`
  ))

  // clear stale dist
  if (existsSync(UI_DIST_DIR)) rmSync(UI_DIST_DIR, { recursive: true, force: true })

  // copy source files to cache dir (not node_modules or dist)
  mkdirSync(UI_CACHE_DIR, { recursive: true })
  for (const f of ['package.json', 'vite.config.js', 'index.html', 'src', 'public']) {
    const src = join(UI_SRC_DIR, f)
    if (existsSync(src)) cpSync(src, join(UI_CACHE_DIR, f), { recursive: true, force: true })
  }

  // install deps if needed
  const needsInstall = !existsSync(join(UI_CACHE_DIR, 'node_modules')) || options.rebuild
  if (needsInstall) {
    console.log(`  ${chalk.dim('installing UI dependencies...')}`)
    await runProc('npm', ['install', '--prefer-offline'], UI_CACHE_DIR, false)
    console.log()
  }

  // build
  const spinner = ora('building UI...').start()
  try {
    await runProc('npm', ['run', 'build'], UI_CACHE_DIR, true)
    spinner.succeed('UI built successfully')
    console.log()
  } catch (err) {
    spinner.fail('UI build failed')
    console.log(chalk.dim('\n  run with --rebuild to try again\n'))
    throw err
  }

  writeFileSync(VERSION_FILE, version)
}

// ── data collection ───────────────────────────────────────────────────────────

function collectData(repoRoot, identity) {
  const config = readConfig(repoRoot)
  const envs   = config?.envs ?? []
  const envsData = {}

  for (const env of envs) {
    const tokens     = readAllTokens(repoRoot, env)
    const keys       = listKeys(repoRoot, env)
    const myLevel    = getMyLevel(repoRoot, env, identity)
    const varsLock   = readVarsLock(repoRoot, env)
    const varEntries = Object.entries(varsLock.vars ?? {})

    const members = tokens.map(token => {
      const memberName = Object.entries(config?.members ?? {})
        .find(([, m]) => m.fingerprint === token.fingerprint)?.[0]
        ?? token.fingerprint.slice(0, 8)

      const blobCount = varEntries.filter(([, v]) => v.blobs?.[token.fingerprint]).length

      return {
        name:        memberName,
        fingerprint: token.fingerprint,
        level:       token.level,
        blobCount,
        totalVars:   varEntries.length,
      }
    })

    envsData[env] = {
      myLevel,
      varCount:    keys.length,
      memberCount: tokens.length,
      vars:        keys,
      members,
    }
  }

  const allMembers = Object.entries(config?.members ?? {}).map(([name, m]) => {
    const envAccess = {}
    for (const env of envs) {
      const token = readAllTokens(repoRoot, env).find(t => t.fingerprint === m.fingerprint)
      envAccess[env] = token?.level ?? null
    }
    return {
      name,
      fingerprint: m.fingerprint,
      isMe:        m.fingerprint === identity.fingerprint,
      envAccess,
    }
  })

  return {
    project:   config?.project,
    envs,
    identity:  { name: identity.name, fingerprint: identity.fingerprint },
    envsData,
    allMembers,
  }
}

// ── open browser ──────────────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32'  ? 'start'
            : 'xdg-open'
  exec(cmd + ' ' + url, () => {})
}

// ── static file serving ───────────────────────────────────────────────────────

function serveFile(res, filePath) {
  try {
    const content = readFileSync(filePath)
    const ext     = extname(filePath)
    const mime    = MIME[ext] ?? 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type':  mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    })
    res.end(content)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }
}

// ── body parser ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', chunk => raw += chunk)
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) }
      catch { reject(new Error('invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(data))
}

// ── request handler ───────────────────────────────────────────────────────────

function makeHandler(repoRoot, identity) {
  return async (req, res) => {
    const url = req.url.split('?')[0]
    res.setHeader('Cache-Control', 'no-cache')

    try {
      // ── GET /api/data ────────────────────────────────────────────────────
      if (url === '/api/data' && req.method === 'GET') {
        const data = collectData(repoRoot, identity)
        return json(res, 200, data)
      }

      // ── POST /api/vars  — add a new variable ─────────────────────────────
      if (url === '/api/vars' && req.method === 'POST') {
        const { env, key, value } = await readBody(req)
        if (!env || !key || value === undefined) {
          return json(res, 400, { error: 'env, key and value are required' })
        }
        const config = readConfig(repoRoot)
        const level  = getMyLevel(repoRoot, env, identity)
        if (!level || LEVELS[level] < LEVELS.write) {
          return json(res, 403, { error: `you need write access on "${env}"` })
        }
        const existing = listKeys(repoRoot, env)
        if (existing.find(k => k.key === key)) {
          return json(res, 409, { error: `"${key}" already exists — use PUT to update` })
        }
        setVar(repoRoot, env, key, value, identity)
        return json(res, 200, { ok: true })
      }

      // ── PUT /api/vars  — update an existing variable ──────────────────────
      if (url === '/api/vars' && req.method === 'PUT') {
        const { env, key, value } = await readBody(req)
        if (!env || !key || value === undefined) {
          return json(res, 400, { error: 'env, key and value are required' })
        }
        const level = getMyLevel(repoRoot, env, identity)
        if (!level || LEVELS[level] < LEVELS.write) {
          return json(res, 403, { error: `you need write access on "${env}"` })
        }
        const existing = listKeys(repoRoot, env)
        if (!existing.find(k => k.key === key)) {
          return json(res, 404, { error: `"${key}" does not exist in "${env}"` })
        }
        setVar(repoRoot, env, key, value, identity)
        return json(res, 200, { ok: true })
      }

      // ── DELETE /api/vars  — remove a variable ─────────────────────────────
      if (url === '/api/vars' && req.method === 'DELETE') {
        const { env, key } = await readBody(req)
        if (!env || !key) return json(res, 400, { error: 'env and key are required' })
        const level = getMyLevel(repoRoot, env, identity)
        if (!level || LEVELS[level] < LEVELS.write) {
          return json(res, 403, { error: `you need write access on "${env}"` })
        }
        removeVar(repoRoot, env, key)
        return json(res, 200, { ok: true })
      }

      // ── POST /api/reveal  — decrypt and return a single var value ─────────
      if (url === '/api/reveal' && req.method === 'POST') {
        const { env, key } = await readBody(req)
        if (!env || !key) return json(res, 400, { error: 'env and key are required' })
        const level = getMyLevel(repoRoot, env, identity)
        if (!level) return json(res, 403, { error: `you don't have access to "${env}"` })
        // decrypt just this one key
        const allDecrypted = decryptAll(repoRoot, env, identity)
        if (!(key in allDecrypted)) {
          return json(res, 403, { error: `no blob for "${key}" — run: envlock sync ${identity.name}` })
        }
        return json(res, 200, { value: allDecrypted[key] })
      }

      // ── POST /api/members/grant  — add member to env ──────────────────────
      if (url === '/api/members/grant' && req.method === 'POST') {
        const { targetName, env, access, syncAfter } = await readBody(req)
        if (!targetName || !env || !access) {
          return json(res, 400, { error: 'targetName, env, and access are required' })
        }
        const { addMember, syncMember } = await import('../operations/members.js')
        const config = readConfig(repoRoot)
        const { grantedEnvs } = addMember(repoRoot, identity, config, targetName, [{ env, access }])
        let syncResult = null
        if (syncAfter) {
          syncResult = syncMember(repoRoot, identity, readConfig(repoRoot), targetName)
        }
        return json(res, 200, { grantedEnvs, syncResult })
      }

      // ── DELETE /api/members/grant  — revoke member from env(s) ───────────
      if (url === '/api/members/grant' && req.method === 'DELETE') {
        const { targetName, envs } = await readBody(req)
        if (!targetName || !envs?.length) {
          return json(res, 400, { error: 'targetName and envs are required' })
        }
        const { revokeMember } = await import('../operations/members.js')
        const config = readConfig(repoRoot)
        const { revokedEnvs } = revokeMember(repoRoot, identity, config, targetName, envs)
        return json(res, 200, { revokedEnvs })
      }

      // ── POST /api/members/sync  — sync vars for member ────────────────────
      if (url === '/api/members/sync' && req.method === 'POST') {
        const { targetName } = await readBody(req)
        if (!targetName) return json(res, 400, { error: 'targetName is required' })
        const { syncMember } = await import('../operations/members.js')
        const config = readConfig(repoRoot)
        const result = syncMember(repoRoot, identity, config, targetName)
        return json(res, 200, result)
      }

      // ── DELETE /api/envs/:env  — remove environment ───────────────────────
      if (url.startsWith('/api/envs/') && req.method === 'DELETE') {
        const env = decodeURIComponent(url.slice('/api/envs/'.length))
        if (!env) return json(res, 400, { error: 'env name required' })
        const { removeEnv } = await import('../operations/envs.js')
        const config = readConfig(repoRoot)
        const result = removeEnv(repoRoot, identity, config, env)
        return json(res, 200, result)
      }

    } catch (err) {
      return json(res, 500, { error: err.message })
    }

    // Static file serving with SPA fallback
    const candidate = join(UI_DIST_DIR, url === '/' ? 'index.html' : url)
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return serveFile(res, candidate)
    }
    serveFile(res, join(UI_DIST_DIR, 'index.html'))
  }
}

// ── command ───────────────────────────────────────────────────────────────────

export async function cmdUi(options = {}) {
  const port = parseInt(options.port ?? 7777, 10)

  const identity = loadIdentity()
  if (!identity) {
    console.log(chalk.red('  ✗ no envlock identity found'))
    console.log(`    run ${chalk.bold('envlock init')} first\n`)
    return
  }

  const repoRoot = requireRepoRoot()
  requireEnvlockRepo(repoRoot)

  // build / update the React app if needed
  await setupUi({ rebuild: !!options.rebuild })

  const server = createServer(makeHandler(repoRoot, identity))

  server.listen(port, '127.0.0.1', () => {
    const url = 'http://localhost:' + port
    console.log(chalk.bold('\n  envlock ui\n'))
    console.log(`  ${chalk.dim('dashboard at')} ${chalk.cyan(url)}`)
    console.log(`  ${chalk.dim('press Ctrl+C to stop')}\n`)
    if (!options.noOpen) openBrowser(url)
  })

  process.on('SIGINT', () => {
    console.log('\n  ' + chalk.dim('stopped\n'))
    server.close()
    process.exit(0)
  })
}
