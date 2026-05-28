import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export const ENVLOCK_FOLDER = '.envlock'
export const CONFIG_FILE    = 'config.json'

// ── path helpers ─────────────────────────────────────────────────────────────

export function keysDir(repoRoot) {
  return join(repoRoot, ENVLOCK_FOLDER, 'keys')
}

export function envDir(repoRoot, env) {
  return join(repoRoot, ENVLOCK_FOLDER, 'envs', env)
}

export function accessDir(repoRoot, env) {
  return join(repoRoot, ENVLOCK_FOLDER, 'envs', env, 'access')
}

export function tokenPath(repoRoot, env, fingerprint) {
  return join(repoRoot, ENVLOCK_FOLDER, 'envs', env, 'access', `${fingerprint}.token`)
}

export function varsLockPath(repoRoot, env) {
  return join(repoRoot, ENVLOCK_FOLDER, 'envs', env, 'vars.lock')
}

// ── plain config (display only — never trusted for permission checks) ─────────

export function readConfig(repoRoot) {
  const configPath = join(repoRoot, ENVLOCK_FOLDER, CONFIG_FILE)
  if (!existsSync(configPath)) return null
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

export function writeConfig(repoRoot, config) {
  const configPath = join(repoRoot, ENVLOCK_FOLDER, CONFIG_FILE)
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

// ── helpers ───────────────────────────────────────────────────────────────────

export function fingerprintToName(config, fingerprint) {
  if (!config?.members) return fingerprint.slice(0, 8) + '...'
  for (const [name, member] of Object.entries(config.members)) {
    if (member.fingerprint === fingerprint) return name
  }
  return fingerprint.slice(0, 8) + '...'
}
