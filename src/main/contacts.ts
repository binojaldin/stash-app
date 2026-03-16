import { execFileSync, execSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let contactsBinaryPath: string | null = null
const contactCache = new Map<string, string>()
const photoCache = new Map<string, string>() // handle -> base64 photo

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

  if (existsSync(binaryPath)) {
    try {
      if (existsSync(sourcePath) && statSync(sourcePath).mtimeMs > statSync(binaryPath).mtimeMs) {
        // Recompile needed
      } else {
        contactsBinaryPath = binaryPath
        return true
      }
    } catch {
      contactsBinaryPath = binaryPath
      return true
    }
  }

  if (!existsSync(sourcePath)) return false

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework Contacts`, { timeout: 120000 })
    contactsBinaryPath = binaryPath
    console.log('Contacts helper compiled successfully')
    return true
  } catch (err) {
    console.error('Failed to compile contacts helper:', err)
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
