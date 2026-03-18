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

// Rich context input for v2 enrichment
export interface TopicEraContextInput {
  startYear: number
  endYear: number
  heuristicLabel: string
  keywords: string[]
  topPeople: string[]
  topGroups: string[]
  sampleMessages: string[]
  topAttachments: string[]
  repeatedPhrases: string[]
}

export async function enrichTopicEras(eras: TopicEraSummaryInput[]): Promise<TopicEraEnrichment[] | null> {
  console.log('[AI] enrichTopicEras (v1 keyword-based) called, input count:', eras.length)
  if (!getAIStatus().configured) { console.log('[AI] Not configured, skipping'); return null }
  if (eras.length === 0) return null

  const cached = getCached<TopicEraEnrichment[]>('topic-eras-v1', eras)
  if (cached) { console.log('[AI] Topic Eras v1 cache HIT'); return cached }

  const input = buildTopicEraSummaryInput(eras)
  const system = `You improve topic era labels for a messaging analytics app. Given heuristic-detected eras with keywords, return a JSON array where each element has: { "originalLabel": string, "enrichedLabel": string or null, "summary": string or null (one short sentence), "suppress": boolean }. Set suppress=true for garbage/meaningless eras. Set enrichedLabel to a cleaner human-readable topic name (2-3 words max) when the heuristic label is weak. Return ONLY the JSON array.`

  const text = await callAnthropic(system, input, 800)
  if (!text) return null
  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as TopicEraEnrichment[]
    setCache('topic-eras-v1', eras, result)
    return result
  } catch { return null }
}

export async function enrichTopicErasV2(contexts: TopicEraContextInput[]): Promise<TopicEraEnrichment[] | null> {
  console.log('[AI] enrichTopicErasV2 (context-based) called, input count:', contexts.length)
  if (!getAIStatus().configured) { console.log('[AI] Not configured, skipping'); return null }
  if (contexts.length === 0) return null

  const cached = getCached<TopicEraEnrichment[]>('topic-eras-v2', contexts)
  if (cached) { console.log('[AI] Topic Eras v2 cache HIT'); return cached }

  console.log('[AI] Topic Eras v2 cache MISS, calling API...')

  // Build rich prompt from structured context
  const blocks = contexts.map(c => {
    const lines = [
      `## ${c.startYear}${c.endYear !== c.startYear ? '–' + c.endYear : ''}`,
      `Behavioral summary: ${(c as any).summaryHint || 'No summary available'}`,
      `Heuristic label: "${c.heuristicLabel}"`,
      `Keywords: ${c.keywords.join(', ')}`,
      c.topPeople.length > 0 ? `Top people (by message count): ${(typeof c.topPeople[0] === 'string' ? c.topPeople : (c.topPeople as { name: string; count: number }[]).map(p => `${p.name} (${p.count})`)).join(', ')}` : null,
      c.topGroups.length > 0 ? `Top groups: ${(typeof c.topGroups[0] === 'string' ? c.topGroups : (c.topGroups as { name: string; count: number }[]).map(g => `${g.name} (${g.count})`)).join(', ')}` : null,
      c.repeatedPhrases.length > 0 ? `Repeated phrases: ${c.repeatedPhrases.join('; ')}` : null,
      c.topAttachments.length > 0 ? `Media shared: ${(typeof c.topAttachments[0] === 'string' ? c.topAttachments : (c.topAttachments as { type: string; count: number }[]).map(a => `${a.type}: ${a.count}`)).join(', ')}` : null,
      c.sampleMessages.length > 0 ? `Sample messages:\n${(c.sampleMessages as { text: string; hasLink: boolean; hasMedia: boolean }[]).map(m => {
        const flags = [m.hasLink ? '[link]' : '', m.hasMedia ? '[media]' : ''].filter(Boolean).join(' ')
        return `  - "${(m as any).text || m}"${flags ? ' ' + flags : ''}`
      }).join('\n')}` : null,
    ]
    return lines.filter(Boolean).join('\n')
  })
  const userMessage = `Messaging behavior by time period:\n\n${blocks.join('\n\n---\n\n')}`

  const system = `You are analyzing someone's messaging history to identify what life phases they were going through.

PRIORITY ORDER for inference:
1. PEOPLE and RELATIONSHIPS — who they talked to most, relationship dynamics
2. ACTIVITIES and LIFESTYLE — hobbies, sports, creative pursuits mentioned in messages
3. LIFE EVENTS — job changes, moves, milestones implied by conversation patterns
4. SOCIAL CIRCLES — group chat activity, recurring friend groups

For each period, identify the DOMINANT THEME. Examples:
- A hobby: "Golf Season", "Music Production", "Cycling"
- A life event: "Wedding Planning", "New Job", "Moving to NYC"
- A social circle: "College Friends Era", "Work Team"
- A relationship: "The Ash Era", "Long Distance Phase"
- A project: "Startup Mode", "Fitness Journey"

Return a JSON array with one object per period:
{
  "originalLabel": the heuristic label provided,
  "enrichedLabel": your improved 1-3 word label (or null if original is good),
  "summary": one sentence describing what defined this period,
  "suppress": true if this period has no meaningful theme
}

Rules:
- Prioritize people, relationships, and activities over generic keywords
- Use sample messages to infer what they were ACTUALLY doing, not just word frequency
- Include people's names in labels when a relationship defines the era (e.g. "The Ash Era")
- Labels must be short (1-3 words) and instantly recognizable
- suppress=true ONLY for periods with truly no discernible theme
- Return ONLY the JSON array, no other text`

  const text = await callAnthropic(system, userMessage, 1200)
  if (!text) { console.warn('[AI] Topic Eras v2 API returned empty'); return null }
  console.log('[AI] Topic Eras v2 raw response:', text.slice(0, 300))

  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as TopicEraEnrichment[]
    console.log('[AI] Topic Eras v2 parsed:', result.length, 'enrichments')
    setCache('topic-eras-v2', contexts, result)
    return result
  } catch (err) {
    console.error('[AI] Failed to parse topic era v2 enrichment:', err)
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

// ── Semantic search intent interpretation ──

export interface SearchIntent {
  type: 'phrase_aggregation' | 'topic_search' | 'person_search' | 'literal'
  phrase: string | null
  groupBy: 'person' | 'time' | null
  sort: 'desc' | 'asc'
  explanation: string
}

export async function interpretSearchQuery(query: string): Promise<SearchIntent | null> {
  if (!getAIStatus().configured) return null

  const cached = getCached<SearchIntent>('search-intent', query)
  if (cached) return cached

  const system = `You interpret natural-language questions about someone's iMessage history into structured search intents.

Return a JSON object:
{
  "type": "phrase_aggregation" | "topic_search" | "person_search" | "literal",
  "phrase": the key phrase/words to search for (or null if not a phrase search),
  "groupBy": "person" | "time" | null,
  "sort": "desc" | "asc",
  "explanation": a short sentence explaining what the user is asking
}

Examples:
- "who have I said I love you to the most" → { "type": "phrase_aggregation", "phrase": "I love you", "groupBy": "person", "sort": "desc", "explanation": "Finding who you've said 'I love you' to most frequently" }
- "when did I first mention golf" → { "type": "phrase_aggregation", "phrase": "golf", "groupBy": "time", "sort": "asc", "explanation": "Finding the earliest mention of golf" }
- "who do I talk about work with" → { "type": "phrase_aggregation", "phrase": "work", "groupBy": "person", "sort": "desc", "explanation": "Finding who you discuss work with most" }
- "show me messages about moving" → { "type": "literal", "phrase": "moving", "groupBy": null, "sort": "desc", "explanation": "Searching for messages about moving" }

Return ONLY the JSON object, no other text.`

  const text = await callAnthropic(system, `Query: "${query}"`, 300)
  if (!text) return null

  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as SearchIntent
    setCache('search-intent', query, result)
    return result
  } catch {
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
