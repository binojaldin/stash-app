import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

function getPrefsPath(): string {
  return join(app.getPath('appData'), 'Stash', 'prefs.json')
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

export function getAiEnabled(): boolean {
  const prefs = loadPrefs()
  return prefs.aiEnabled === true
}

export function setAiEnabled(val: boolean): void {
  const prefs = loadPrefs()
  prefs.aiEnabled = val
  savePrefs(prefs)
}
