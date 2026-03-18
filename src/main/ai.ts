/**
 * AI Service Layer — centralized provider abstraction, caching, and enrichment.
 *
 * Design:
 * - Single module owns API key loading, request formatting, caching
 * - Deterministic features remain the source of truth
 * - AI enriches labels, summaries, and interpretations when configured
 * - App works fully without an API key
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'

// ── Types ──

export interface AIStatus {
  configured: boolean
  provider: 'anthropic' | 'none'
}

interface CacheEntry {
  result: unknown
  model: string
  provider: string
  timestamp: number
  inputHash: string
}

interface CacheStore {
  version: number
  entries: Record<string, CacheEntry>
}

// ── Enrichment types ──

export interface TopicEraEnrichment {
  originalLabel: string
  enrichedLabel: string | null
  summary: string | null
  suppress: boolean
}

export interface MemoryMomentEnrichment {
  originalTitle: string
  enrichedTitle: string | null
  enrichedSubtitle: string | null
}

// ── Prompt input builders ──

export interface TopicEraSummaryInput {
  startYear: number
  endYear: number
  heuristicLabel: string
  keywords: string[]
  strengthScore: number
}

export interface MemoryMomentSummaryInput {
  type: string
  title: string
  subtitle: string
  dateLabel: string
  contactName: string | null
  metric: number | null
}

export interface LifeChapterSummaryInput {
  startYear: number
  endYear: number
  dominantContact: string
  supportingContacts: string[]
}

// ── Constants ──

const MODEL = 'claude-sonnet-4-20250514'
const API_HOST = 'api.anthropic.com'
const API_VERSION = '2023-06-01'
const CACHE_VERSION = 1
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ── Key management ──

function getKeyPath(): string {
  return join(app.getPath('userData'), 'anthropic-key.txt')
}

function getCachePath(): string {
  const dir = join(app.getPath('userData'), 'ai-cache')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'enrichment-cache.json')
}

function loadApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY || ''
  if (envKey) return envKey
  const keyPath = getKeyPath()
  if (existsSync(keyPath)) return readFileSync(keyPath, 'utf-8').trim()
  return ''
}

export function setApiKey(key: string): void {
  writeFileSync(getKeyPath(), key.trim())
}

export function getAIStatus(): AIStatus {
  const key = loadApiKey()
  return { configured: key.length > 0, provider: key.length > 0 ? 'anthropic' : 'none' }
}

// ── Cache ──

function loadCache(): CacheStore {
  try {
    const path = getCachePath()
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as CacheStore
      if (data.version === CACHE_VERSION) return data
    }
  } catch { /* corrupt cache, start fresh */ }
  return { version: CACHE_VERSION, entries: {} }
}

function saveCache(store: CacheStore): void {
  try { writeFileSync(getCachePath(), JSON.stringify(store)) } catch { /* ignore write errors */ }
}

function hashInput(feature: string, input: unknown): string {
  const raw = `${feature}:${JSON.stringify(input)}`
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

function getCached<T>(feature: string, input: unknown): T | null {
  const store = loadCache()
  const key = hashInput(feature, input)
  const entry = store.entries[key]
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null
  return entry.result as T
}

function setCache(feature: string, input: unknown, result: unknown): void {
  const store = loadCache()
  const key = hashInput(feature, input)
  store.entries[key] = { result, model: MODEL, provider: 'anthropic', timestamp: Date.now(), inputHash: key }
  // Evict old entries
  const keys = Object.keys(store.entries)
  if (keys.length > 200) {
    const sorted = keys.sort((a, b) => store.entries[a].timestamp - store.entries[b].timestamp)
    for (const k of sorted.slice(0, keys.length - 150)) delete store.entries[k]
  }
  saveCache(store)
}

// ── Raw API call ──

async function callAnthropic(system: string, userMessage: string, maxTokens = 1000): Promise<string | null> {
  const apiKey = loadApiKey()
  if (!apiKey) return null

  const https = require('https')
  const postData = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMessage }]
  })

  try {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = https.request({
        hostname: API_HOST,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res: { statusCode: number; on: (event: string, handler: (data?: string) => void) => void }) => {
        let body = ''
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      })
      req.on('error', reject)
      req.write(postData)
      req.end()
    })

    if (response.status !== 200) {
      console.error('[AI] API error:', response.status)
      return null
    }
    const data = JSON.parse(response.body)
    return data.content?.[0]?.text || null
  } catch (err) {
    console.error('[AI] Request failed:', err)
    return null
  }
}

// ── Structured input builders ──

export function buildTopicEraSummaryInput(eras: TopicEraSummaryInput[]): string {
  const lines = eras.map(e =>
    `- ${e.startYear}${e.endYear !== e.startYear ? '–' + e.endYear : ''}: label="${e.heuristicLabel}", keywords=[${e.keywords.join(', ')}], strength=${e.strengthScore}`
  )
  return `Topic eras detected from messaging history:\n${lines.join('\n')}`
}

export function buildMemoryMomentSummaryInput(moments: MemoryMomentSummaryInput[]): string {
  const lines = moments.map(m =>
    `- type=${m.type}, title="${m.title}", date="${m.dateLabel}"${m.contactName ? ', contact="' + m.contactName + '"' : ''}${m.metric ? ', metric=' + m.metric : ''}`
  )
  return `Memory moments from messaging history:\n${lines.join('\n')}`
}

export function buildLifeChapterSummaryInput(chapters: LifeChapterSummaryInput[]): string {
  const lines = chapters.map(c =>
    `- ${c.startYear}–${c.endYear}: dominant="${c.dominantContact}", supporting=[${c.supportingContacts.join(', ')}]`
  )
  return `Life chapters based on messaging relationships:\n${lines.join('\n')}`
}

// ── Enrichment functions ──

export async function enrichTopicEras(eras: TopicEraSummaryInput[]): Promise<TopicEraEnrichment[] | null> {
  console.log('[AI] enrichTopicEras called, input count:', eras.length)
  if (!getAIStatus().configured) { console.log('[AI] Not configured, skipping'); return null }
  if (eras.length === 0) { console.log('[AI] No eras to enrich'); return null }

  const cached = getCached<TopicEraEnrichment[]>('topic-eras', eras)
  if (cached) { console.log('[AI] Topic Eras cache HIT, returning', cached.length, 'items'); return cached }

  console.log('[AI] Topic Eras cache MISS, calling API...')
  const input = buildTopicEraSummaryInput(eras)
  const system = `You improve topic era labels for a messaging analytics app. Given heuristic-detected eras with keywords, return a JSON array where each element has: { "originalLabel": string, "enrichedLabel": string or null, "summary": string or null (one short sentence), "suppress": boolean }. Set suppress=true for garbage/meaningless eras. Set enrichedLabel to a cleaner human-readable topic name (2-3 words max) when the heuristic label is weak. Return null for enrichedLabel if the original is already good. Keep labels short and obvious: "Golf", "Music Production", "Job Hunt", etc. Return ONLY the JSON array.`

  const text = await callAnthropic(system, input, 800)
  if (!text) { console.warn('[AI] Topic Eras API returned empty'); return null }
  console.log('[AI] Topic Eras raw response:', text.slice(0, 200))

  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as TopicEraEnrichment[]
    console.log('[AI] Topic Eras parsed:', result.length, 'enrichments:', JSON.stringify(result))
    setCache('topic-eras', eras, result)
    return result
  } catch (err) {
    console.error('[AI] Failed to parse topic era enrichment:', err)
    return null
  }
}

export async function enrichMemoryMoments(moments: MemoryMomentSummaryInput[]): Promise<MemoryMomentEnrichment[] | null> {
  if (!getAIStatus().configured || moments.length === 0) return null

  const cached = getCached<MemoryMomentEnrichment[]>('memory-moments', moments)
  if (cached) return cached

  const input = buildMemoryMomentSummaryInput(moments)
  const system = `You improve memory moment descriptions for a messaging analytics app. Given deterministic memory items, return a JSON array where each element has: { "originalTitle": string, "enrichedTitle": string or null, "enrichedSubtitle": string or null }. Keep titles warm and reflective. Keep subtitles to one short sentence. Only change titles/subtitles that would genuinely benefit from better wording. Return null for fields that are already good. Return ONLY the JSON array.`

  const text = await callAnthropic(system, input, 800)
  if (!text) return null

  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as MemoryMomentEnrichment[]
    setCache('memory-moments', moments, result)
    return result
  } catch {
    console.error('[AI] Failed to parse memory moment enrichment')
    return null
  }
}

// ── Conversation search (migrated from index.ts) ──

export async function searchConversationsAI(
  description: string,
  conversations: { display: string; identifier: string }[]
): Promise<{ error: string | null; results: string[] | null }> {
  const apiKey = loadApiKey()
  if (!apiKey) return { error: 'NO_KEY', results: null }

  try {
    const chatList = conversations.map(c => `- "${c.display}" (identifier: ${c.identifier})`).join('\n')
    const system = 'You are helping a user find a specific iMessage conversation. You will be given a list of conversations and the user\'s description. Return ONLY a JSON array of identifier strings for the conversations that best match the description, ranked by confidence, max 5 results. No explanation, just the JSON array.'

    const text = await callAnthropic(system, `Conversations:\n${chatList}\n\nFind: ${description}`, 500)
    if (!text) return { error: 'API call failed', results: null }

    const matches = JSON.parse(text) as string[]
    console.log('[AI] Search found', matches.length, 'matches')
    return { error: null, results: matches }
  } catch (err) {
    console.error('[AI] Search error:', err)
    return { error: String(err), results: null }
  }
}
