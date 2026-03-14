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
  if (existsSync(binaryPath)) {
    contactsBinaryPath = binaryPath
    return true
  }

  const sourcePath = getContactsSourcePath()
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

export function resolveContact(handle: string): string {
  if (!handle) return handle

  const cached = contactCache.get(handle)
  if (cached !== undefined) return cached

  if (!contactsBinaryPath || !existsSync(contactsBinaryPath)) {
    contactCache.set(handle, handle)
    return handle
  }

  try {
    const result = execFileSync(contactsBinaryPath, [handle], { timeout: 5000 }).toString().trim()
    const resolved = result || handle
    contactCache.set(handle, resolved)
    return resolved
  } catch {
    contactCache.set(handle, handle)
    return handle
  }
}

export function resolveContactBatch(handles: string[]): Map<string, string> {
  const results = new Map<string, string>()
  for (const handle of handles) {
    results.set(handle, resolveContact(handle))
  }
  return results
}
