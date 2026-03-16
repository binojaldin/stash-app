import { execFileSync, execSync } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let contactsBinaryPath: string | null = null
const contactCache = new Map<string, string>()
const photoCache = new Map<string, string>()

function getContactsBinaryPath(): string {
  return join(app.getPath('appData'), 'Stash', 'contacts_helper')
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
  const sourcePath = getContactsSourcePath()

  if (!existsSync(sourcePath)) {
    console.error('[Contacts] Swift source not found at:', sourcePath)
    return false
  }

  // Always delete existing binary to force fresh compile
  if (existsSync(binaryPath)) {
    try {
      unlinkSync(binaryPath)
      console.log('[Contacts] Deleted old binary, recompiling...')
    } catch (err) {
      console.error('[Contacts] Could not delete old binary:', err)
    }
  }

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework Contacts`, { timeout: 120000 })
    contactsBinaryPath = binaryPath
    console.log('[Contacts] Compiled successfully')
    return true
  } catch (err) {
    console.error('[Contacts] Compile failed:', err)
    return false
  }
}

export function resolveContact(handle: string): string {
  if (!handle) return handle
  const cached = contactCache.get(handle)
  if (cached !== undefined) return cached
  resolveContactsBatch([handle])
  return contactCache.get(handle) ?? handle
}

export function getContactPhoto(handle: string): string | null {
  return photoCache.get(handle) || null
}

export function getAllContactPhotos(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of photoCache) if (v) result[k] = v
  return result
}

export function resolveContactsBatch(handles: string[]): void {
  if (!contactsBinaryPath || !existsSync(contactsBinaryPath)) return

  const uncached = handles.filter((h) => h && !contactCache.has(h))
  if (uncached.length === 0) return

  const chunkSize = 50
  for (let i = 0; i < uncached.length; i += chunkSize) {
    const chunk = uncached.slice(i, i + chunkSize)
    try {
      const result = execFileSync(contactsBinaryPath, chunk, { timeout: 15000 }).toString()
      const lines = result.split('\n')
      if (i === 0 && lines[0]) console.log('[Contacts] First line format:', lines[0].substring(0, 80), lines[0].includes('\t') ? '(has tab)' : '(no tab)')
      for (let j = 0; j < chunk.length; j++) {
        const line = lines[j] || ''
        const tabIdx = line.indexOf('\t')
        if (tabIdx >= 0) {
          const name = line.substring(0, tabIdx).trim()
          const photo = line.substring(tabIdx + 1).trim()
          contactCache.set(chunk[j], name || chunk[j])
          if (photo) photoCache.set(chunk[j], photo)
        } else {
          contactCache.set(chunk[j], line.trim() || chunk[j])
        }
      }
    } catch {
      for (const h of chunk) {
        if (!contactCache.has(h)) contactCache.set(h, h)
      }
    }
  }
}
