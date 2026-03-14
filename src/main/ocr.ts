import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { execSync } from 'child_process'

let ocrBinaryPath: string | null = null

function getOcrBinaryPath(): string {
  const appDataDir = join(app.getPath('appData'), 'Stash')
  return join(appDataDir, 'ocr_helper')
}

function getOcrSourcePath(): string {
  // In dev, it's in the source tree; in production, it's in resources
  const devPath = join(__dirname, '../../src/main/ocr.swift')
  if (existsSync(devPath)) return devPath
  const prodPath = join(process.resourcesPath, 'ocr.swift')
  if (existsSync(prodPath)) return prodPath
  return devPath
}

export function compileOcrHelper(): boolean {
  const binaryPath = getOcrBinaryPath()
  if (existsSync(binaryPath)) {
    ocrBinaryPath = binaryPath
    return true
  }

  const sourcePath = getOcrSourcePath()
  if (!existsSync(sourcePath)) {
    console.error('OCR Swift source not found at:', sourcePath)
    return false
  }

  try {
    execSync(`swiftc -O "${sourcePath}" -o "${binaryPath}" -framework Vision -framework AppKit`, {
      timeout: 120000
    })
    ocrBinaryPath = binaryPath
    console.log('OCR helper compiled successfully')
    return true
  } catch (err) {
    console.error('Failed to compile OCR helper:', err)
    return false
  }
}

export function runOcr(imagePath: string): Promise<string> {
  return new Promise((resolve) => {
    if (!ocrBinaryPath || !existsSync(ocrBinaryPath)) {
      resolve('')
      return
    }

    execFile(ocrBinaryPath, [imagePath], { timeout: 30000 }, (error, stdout) => {
      if (error) {
        console.error('OCR error for', imagePath, error.message)
        resolve('')
        return
      }
      resolve(stdout.trim())
    })
  })
}
