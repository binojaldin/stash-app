import { execFileSync, execSync, execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { homedir } from 'os'

let icloudBinaryPath: string | null = null

function getIcloudBinaryPath(): string {
  return join(app.getPath('appData'), 'Stash', 'icloud_helper')
}

function getIcloudSourcePath(): string {
  const devPath = join(__dirname, '../../src/main/icloud.swift')
  if (existsSync(devPath)) return devPath
  const prodPath = join(process.resourcesPath, 'icloud.swift')
  if (existsSync(prodPath)) return prodPath
  return devPath
}

export function compileIcloudHelper(): boolean {
  const binaryPath = getIcloudBinaryPath()
  const sourcePath = getIcloudSourcePath()

  if (existsSync(binaryPath)) {
    try {
      if (existsSync(sourcePath) && statSync(sourcePath).mtimeMs > statSync(binaryPath).mtimeMs) {
        // Recompile
      } else {
        icloudBinaryPath = binaryPath
        return true
      }
    } catch {
      icloudBinaryPath = binaryPath
      return true
    }
  }

  if (!existsSync(sourcePath)) return false

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework Foundation`, { timeout: 120000 })
    icloudBinaryPath = binaryPath
    console.log('iCloud helper compiled successfully')
    return true
  } catch (err) {
    console.error('Failed to compile iCloud helper:', err)
    return false
  }
}

export function triggerIcloudDownload(paths: string[]): Map<string, boolean> {
  const results = new Map<string, boolean>()
  if (!icloudBinaryPath || !existsSync(icloudBinaryPath)) return results

  const chunkSize = 50
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize)
    try {
      const output = execFileSync(icloudBinaryPath, chunk, { timeout: 30000 }).toString()
      const lines = output.split('\n')
      for (let j = 0; j < chunk.length; j++) {
        results.set(chunk[j], lines[j]?.startsWith('OK') ?? false)
      }
    } catch {
      for (const p of chunk) results.set(p, false)
    }
  }
  return results
}

export async function triggerBrctlSync(): Promise<void> {
  const messagesDir = join(homedir(), 'Library/Messages')
  try {
    execSync(`brctl download "${messagesDir}"`, { timeout: 60000 })
    console.log('brctl sync triggered successfully')
  } catch (err) {
    console.log('brctl sync failed (non-blocking):', err)
  }
}

export async function recoverFile(filePath: string): Promise<boolean> {
  if (!icloudBinaryPath || !existsSync(icloudBinaryPath)) return false
  try {
    const output = execFileSync(icloudBinaryPath, [filePath], { timeout: 10000 }).toString().trim()
    return output.startsWith('OK')
  } catch {
    return false
  }
}
