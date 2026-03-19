/**
 * Persistent analytics cache — stores expensive deterministic results to disk.
 *
 * Eliminates multi-second freezes on repeated launches by skipping
 * recomputation when inputs haven't changed.
 *
 * Cache key: function name + logic version + input hash (message count / date range).
 * Storage: JSON files in userData/analytics-cache/
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'

const CACHE_DIR = (): string => {
  const dir = join(app.getPath('userData'), 'analytics-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

// Bump this when analytics logic changes to invalidate all caches
const LOGIC_VERSION = 4

interface CacheMeta {
  version: number
  inputHash: string
  timestamp: number
}

function cacheFile(name: string): string {
  return join(CACHE_DIR(), `${name}.json`)
}

function metaFile(name: string): string {
  return join(CACHE_DIR(), `${name}.meta.json`)
}

function hashInput(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}

export function getCachedAnalytics<T>(name: string, inputSignal: string): T | null {
  try {
    const mf = metaFile(name)
    const cf = cacheFile(name)
    if (!existsSync(mf) || !existsSync(cf)) return null
    const meta = JSON.parse(readFileSync(mf, 'utf-8')) as CacheMeta
    if (meta.version !== LOGIC_VERSION) { console.log(`[PERF][CACHE STALE] ${name}: version mismatch (${meta.version} vs ${LOGIC_VERSION})`); return null }
    const expectedHash = hashInput(inputSignal)
    if (meta.inputHash !== expectedHash) { console.log(`[PERF][CACHE MISS] ${name}: input changed`); return null }
    const data = JSON.parse(readFileSync(cf, 'utf-8')) as T
    console.log(`[PERF][CACHE HIT] ${name}`)
    return data
  } catch { return null }
}

export function setCachedAnalytics(name: string, inputSignal: string, data: unknown): void {
  try {
    const meta: CacheMeta = { version: LOGIC_VERSION, inputHash: hashInput(inputSignal), timestamp: Date.now() }
    writeFileSync(metaFile(name), JSON.stringify(meta))
    writeFileSync(cacheFile(name), JSON.stringify(data))
  } catch (err) { console.error(`[CACHE] Failed to write ${name}:`, err) }
}

/**
 * Get a cache-input signal for message-count-based analytics.
 * Cached per session to avoid 5+ redundant DB opens on launch.
 */
let _signalCache: string | null = null
export function getMessageCountSignal(): string {
  if (_signalCache) return _signalCache
  try {
    const Database = require('better-sqlite3')
    const dbPath = join(app.getPath('appData'), 'Stash', 'stash.db')
    if (!existsSync(dbPath)) return '0:0'
    const d = new Database(dbPath, { readonly: true })
    const msgCount = (d.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
    const attCount = (d.prepare('SELECT COUNT(*) as c FROM attachments').get() as { c: number }).c
    d.close()
    _signalCache = `${msgCount}:${attCount}`
    return _signalCache
  } catch { return 'unknown' }
}

export function invalidateSignalCache(): void { _signalCache = null }

/**
 * Yield to the event loop between heavy operations.
 * Allows IPC, window repaints, and user interaction to proceed.
 */
export function yieldEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}
