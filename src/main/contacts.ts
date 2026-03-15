import { execFileSync, execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let contactsBinaryPath: string | null = null
const contactCache = new Map<string, string>()

function getContactsBinaryPath(): string {
  const appDataDir = join(app.getPath('appData'), 'Stash')
  return join(appDataDir, 'contacts_helper')
}

function getContactsSourcePath(): string {
  const devPath = join(__dirname, '../../src/main/contacts.swift')
  if (existsSync(devPath)) return devPath
  const prodPath = join(process.resourcesPath, 'contacts.swift')
  if (existsSync(prodPath)) return prodPath
  return devPath
}

export function compileContactsHelper(): boolean {
  const binaryPath = getContactsBinaryPath()
  // Always recompile if source is newer (dev) or binary missing
  const sourcePath = getContactsSourcePath()
  if (existsSync(binaryPath) && !needsRecompile(sourcePath, binaryPath)) {
    contactsBinaryPath = binaryPath
    return true
  }

  if (!existsSync(sourcePath)) {
    console.error('Contacts Swift source not found at:', sourcePath)
    return false
  }

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework Contacts`, {
      timeout: 120000
    })
    contactsBinaryPath = binaryPath
    console.log('Contacts helper compiled successfully')
    return true
  } catch (err) {
    console.error('Failed to compile contacts helper:', err)
    return false
  }
}

function needsRecompile(sourcePath: string, binaryPath: string): boolean {
  try {
    const { statSync } = require('fs')
    const srcStat = statSync(sourcePath)
    const binStat = statSync(binaryPath)
    return srcStat.mtimeMs > binStat.mtimeMs
  } catch {
    return true
  }
}

export function resolveContact(handle: string): string {
  if (!handle) return handle
  const cached = contactCache.get(handle)
  if (cached !== undefined) return cached

  // Single resolve falls through to batch
  resolveContactsBatch([handle])
  return contactCache.get(handle) ?? handle
}

export function resolveContactsBatch(handles: string[]): void {
  if (!contactsBinaryPath || !existsSync(contactsBinaryPath)) return

  // Filter to only uncached handles
  const uncached = handles.filter((h) => h && !contactCache.has(h))
  if (uncached.length === 0) return

  // Process in chunks of 50 to avoid arg length limits
  const chunkSize = 50
  for (let i = 0; i < uncached.length; i += chunkSize) {
    const chunk = uncached.slice(i, i + chunkSize)
    try {
      const result = execFileSync(contactsBinaryPath, chunk, { timeout: 15000 }).toString()
      const lines = result.split('\n')
      for (let j = 0; j < chunk.length; j++) {
        const resolved = lines[j]?.trim() || chunk[j]
        contactCache.set(chunk[j], resolved)
      }
    } catch {
      // Cache failures as-is so we don't retry
      for (const h of chunk) {
        if (!contactCache.has(h)) contactCache.set(h, h)
      }
    }
  }
}
