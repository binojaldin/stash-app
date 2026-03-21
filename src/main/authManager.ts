import { execFileSync, execSync } from 'child_process'
import { existsSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// ── Swift helper compilation (same pattern as contacts.ts / ocr.ts) ──

let authBinaryPath: string | null = null
let compiled = false

function getAuthBinaryPath(): string {
  return join(app.getPath('appData'), 'Stash', 'auth_helper')
}

function getAuthSourcePath(): string {
  const devPath = join(__dirname, '../../src/main/auth.swift')
  if (existsSync(devPath)) return devPath
  const prodPath = join(process.resourcesPath, 'auth.swift')
  if (existsSync(prodPath)) return prodPath
  return devPath
}

export function compileAuthHelper(): boolean {
  if (compiled && authBinaryPath) return true

  const binaryPath = getAuthBinaryPath()
  const sourcePath = getAuthSourcePath()
  if (!existsSync(sourcePath)) return false

  if (existsSync(binaryPath)) {
    try {
      const srcMtime = statSync(sourcePath).mtimeMs
      const binMtime = statSync(binaryPath).mtimeMs
      if (srcMtime <= binMtime) {
        authBinaryPath = binaryPath
        compiled = true
        return true
      }
      unlinkSync(binaryPath)
    } catch {
      authBinaryPath = binaryPath
      compiled = true
      return true
    }
  }

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework LocalAuthentication -framework Security`, { timeout: 120000 })
    authBinaryPath = binaryPath
    compiled = true
    console.log('[Auth] Helper compiled successfully')
    return true
  } catch (err) {
    console.error('[Auth] Compile failed:', err)
    return false
  }
}

function runAuthHelper(args: string[]): string {
  if (!authBinaryPath || !existsSync(authBinaryPath)) {
    compileAuthHelper()
  }
  if (!authBinaryPath || !existsSync(authBinaryPath)) {
    throw new Error('Auth helper not available')
  }
  return execFileSync(authBinaryPath, args, { timeout: 30000 }).toString().trim()
}

// ── Prefs integration ──

import { join as pathJoin } from 'path'
import { readFileSync, writeFileSync } from 'fs'

function getPrefsPath(): string {
  return pathJoin(app.getPath('appData'), 'Stash', 'prefs.json')
}

function loadPrefs(): Record<string, unknown> {
  const prefsPath = getPrefsPath()
  if (!existsSync(prefsPath)) return {}
  try { return JSON.parse(readFileSync(prefsPath, 'utf-8')) }
  catch { return {} }
}

function savePrefs(prefs: Record<string, unknown>): void {
  writeFileSync(getPrefsPath(), JSON.stringify(prefs, null, 2))
}

// ── Auth config ──

export interface AuthConfig {
  enabled: boolean
  touchIdAvailable: boolean
  touchIdEnabled: boolean
  idleTimeoutMinutes: number
  hasPassword: boolean
}

export function getAuthConfig(): AuthConfig {
  const prefs = loadPrefs()
  return {
    enabled: prefs.authEnabled === true,
    touchIdAvailable: checkTouchIdAvailableSync(),
    touchIdEnabled: prefs.authTouchIdEnabled !== false, // default true
    idleTimeoutMinutes: typeof prefs.authIdleTimeout === 'number' ? prefs.authIdleTimeout as number : 15,
    hasPassword: typeof prefs.authPasswordHash === 'string' && (prefs.authPasswordHash as string).length > 0
  }
}

export function setAuthEnabled(enabled: boolean): void {
  const prefs = loadPrefs()
  prefs.authEnabled = enabled
  if (!enabled) {
    lastActiveTime = Date.now()
  }
  savePrefs(prefs)
}

export function setIdleTimeout(minutes: number): void {
  const valid = [0, 5, 15, 30, 60]
  if (!valid.includes(minutes)) return
  const prefs = loadPrefs()
  prefs.authIdleTimeout = minutes
  savePrefs(prefs)
}

export function setTouchIdEnabled(enabled: boolean): void {
  const prefs = loadPrefs()
  prefs.authTouchIdEnabled = enabled
  savePrefs(prefs)
}

// ── Password hashing (PBKDF2-HMAC-SHA256 via Swift helper) ──

export async function setupPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('Password must be at least 8 characters')
  compileAuthHelper()
  const result = runAuthHelper(['hash', password])
  // result is "salthex:hashhex"
  const [salt, hash] = result.split(':')
  if (!salt || !hash) throw new Error('Hash failed')
  const prefs = loadPrefs()
  prefs.authPasswordHash = hash
  prefs.authPasswordSalt = salt
  prefs.authEnabled = true
  savePrefs(prefs)
}

export async function verifyPassword(password: string): Promise<boolean> {
  const prefs = loadPrefs()
  const hash = prefs.authPasswordHash as string | undefined
  const salt = prefs.authPasswordSalt as string | undefined
  if (!hash || !salt) return false
  compileAuthHelper()
  try {
    const result = runAuthHelper(['verify', password, salt, hash])
    return result === 'yes'
  } catch {
    return false
  }
}

// ── Touch ID ──

function checkTouchIdAvailableSync(): boolean {
  try {
    compileAuthHelper()
    const result = runAuthHelper(['can-touch-id'])
    return result === 'yes'
  } catch {
    return false
  }
}

export async function checkTouchIdAvailable(): Promise<boolean> {
  return checkTouchIdAvailableSync()
}

export async function authenticateWithTouchID(): Promise<'success' | 'fallback' | 'failed'> {
  compileAuthHelper()
  try {
    const result = runAuthHelper(['touch-id', 'Unlock Stash to access your messages'])
    if (result === 'success') return 'success'
    if (result === 'fallback') return 'fallback'
    return 'failed'
  } catch {
    return 'failed'
  }
}

// ── Idle tracking ──

let lastActiveTime = Date.now()

export function getLastActiveTime(): number {
  return lastActiveTime
}

export function updateLastActiveTime(): void {
  lastActiveTime = Date.now()
}

export function shouldLock(): boolean {
  const prefs = loadPrefs()
  if (prefs.authEnabled !== true) return false
  const timeout = typeof prefs.authIdleTimeout === 'number' ? prefs.authIdleTimeout as number : 15
  if (timeout === 0) return false // never auto-lock
  const elapsed = (Date.now() - lastActiveTime) / 60000
  return elapsed >= timeout
}
