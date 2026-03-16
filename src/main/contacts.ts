import { execFileSync, execSync } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let contactsBinaryPath: string | null = null
let compiled = false
const contactCache = new Map<string, string>()

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
  if (compiled && contactsBinaryPath) return true

  const binaryPath = getContactsBinaryPath()
  const sourcePath = getContactsSourcePath()
  if (!existsSync(sourcePath)) return false

  // Only recompile if binary is missing or source is newer
  if (existsSync(binaryPath)) {
    try {
      const { statSync } = require('fs')
      const srcMtime = statSync(sourcePath).mtimeMs
      const binMtime = statSync(binaryPath).mtimeMs
      if (srcMtime <= binMtime) {
        contactsBinaryPath = binaryPath
        compiled = true
        return true
      }
      // Source is newer — delete and recompile
      unlinkSync(binaryPath)
      console.log('[Contacts] Source updated, recompiling...')
    } catch {
      contactsBinaryPath = binaryPath
      compiled = true
      return true
    }
  }

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework Contacts`, { timeout: 120000 })
    contactsBinaryPath = binaryPath
    compiled = true
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
        const line = lines[j]?.trim() || ''
        // Handle name\tphoto format from old binary — take only name
        const tabIdx = line.indexOf('\t')
        const name = tabIdx >= 0 ? line.slice(0, tabIdx).trim() : line
        contactCache.set(chunk[j], name || chunk[j])
      }
    } catch {
      for (const h of chunk) {
        if (!contactCache.has(h)) contactCache.set(h, h)
      }
    }
  }
}
