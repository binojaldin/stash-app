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
const CACHE_VERSION = 2  // bumped to invalidate stale topic era cache
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
  topPeople: { name: string; count: number }[]
  topGroups: { name: string; count: number }[]
  sampleMessages: { text: string; hasLink: boolean; hasMedia: boolean }[]
  topAttachments: { type: string; count: number }[]
  repeatedPhrases: string[]
  summaryHint: string
  totalMessages: number
  relationshipScore: number
  groupScore: number
  mediaScore: number
  primarySignalType: 'relationship' | 'activity' | 'social' | 'mixed'
  primaryActors: string[]
  attachmentSummary: string
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

  // Build rich prompt from structured context (typed fields, no casts)
  const blocks = contexts.map(c => {
    const lines = [
      `## ${c.startYear}${c.endYear !== c.startYear ? '–' + c.endYear : ''}`,
      `Behavioral summary: ${c.summaryHint}`,
      `Primary signal: ${c.primarySignalType} (relationship=${c.relationshipScore.toFixed(2)}, group=${c.groupScore.toFixed(2)}, media=${c.mediaScore.toFixed(2)})`,
      c.primaryActors.length > 0 ? `Primary actors: ${c.primaryActors.join(', ')}` : null,
      `Total messages: ${c.totalMessages}`,
      c.topPeople.length > 0 ? `Top people: ${c.topPeople.map(p => `${p.name} (${p.count} msgs)`).join(', ')}` : null,
      c.topGroups.length > 0 ? `Top groups: ${c.topGroups.map(g => `${g.name} (${g.count} msgs)`).join(', ')}` : null,
      c.repeatedPhrases.length > 0 ? `Repeated phrases: ${c.repeatedPhrases.join('; ')}` : null,
      c.attachmentSummary ? `Media: ${c.attachmentSummary}` : (c.topAttachments.length > 0 ? `Media: ${c.topAttachments.map(a => `${a.type}: ${a.count}`).join(', ')}` : null),
      `Heuristic label: "${c.heuristicLabel}" (keywords are supporting evidence only, not primary source of truth)`,
      c.keywords.length > 0 ? `Supporting keywords: ${c.keywords.join(', ')}` : null,
      c.sampleMessages.length > 0 ? `Sample messages:\n${c.sampleMessages.map(m => {
        const flags = [m.hasLink ? '[link]' : '', m.hasMedia ? '[media]' : ''].filter(Boolean).join(' ')
        return `  - "${m.text}"${flags ? ' ' + flags : ''}`
      }).join('\n')}` : null,
    ]
    return lines.filter(Boolean).join('\n')
  })
  const userMessage = `Messaging behavior by time period:\n\n${blocks.join('\n\n---\n\n')}`

  const system = `You are analyzing someone's messaging history to identify what life phases they were going through.

CRITICAL: Keywords are SUPPORTING EVIDENCE only. They are NOT the primary source of truth. Look at the people, behavioral summary, repeated phrases, and sample messages first.

LABEL FORMAT — you MUST choose one of these styles:

1. RELATIONSHIP-DRIVEN (when one person clearly dominates the period)
   Format: "[Name] Era"
   Example: "Ash Era", "Philippe Era"
   Use when: primarySignalType is "relationship" or one person has >40% of messages

2. ACTIVITY-DRIVEN (when repeated phrases/messages suggest a hobby or project)
   Format: "[Activity]"
   Example: "Golf", "Cycling", "Music Production"
   Use when: strong activity signal in phrases and sample messages

3. LIFE-PHASE (when messages suggest a life transition)
   Format: "[Event]"
   Example: "New Job", "Moving", "Rootstrap"
   Use when: sample messages imply work/life change

4. SOCIAL (when group chat activity dominates)
   Format: "[Group Name]" or "Social Peak"
   Use when: primarySignalType is "social" and a group clearly dominates
   Only use a group name if it is truly dominant, not just present

Return a JSON array with one object per period:
{
  "originalLabel": the heuristic label provided,
  "enrichedLabel": your improved 1-3 word label (or null if original is good),
  "summary": one sentence describing what defined this period,
  "suppress": true if this period has no meaningful theme
}

RULES:
- DO NOT repeat the word "Era" in the label (the UI already appends "Era")
- DO NOT use system/artifact words in labels: image, render, video, screenshot, preview, http
- DO NOT use labels like "Wordle" or "Conversation Shift" unless evidence is overwhelming
- PREFER a person-name label if one person clearly dominates the time period
- PREFER a real activity if repeated phrases/messages clearly suggest a hobby
- If evidence is genuinely weak, use "Social Shift" as a last resort
- Labels must be 1-3 words maximum
- suppress=true ONLY for periods with truly no discernible theme
- Return ONLY the JSON array, no other text`

  const text = await callAnthropic(system, userMessage, 1200)
  if (!text) { console.warn('[AI] Topic Eras v2 API returned empty'); return null }
  console.log('[AI] Topic Eras v2 raw response:', text.slice(0, 300))

  try {
    let result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as TopicEraEnrichment[]
    console.log('[AI] Topic Eras v2 parsed:', result.length, 'enrichments')

    // ── Post-processing guardrails ──
    const LABEL_BLACKLIST = /\b(image|render|rendered|video|preview|http|https|www|screenshot|fullsize|renderedimage|renderedvideo|loved|wordle)\b/i
    result = result.map((e, i) => {
      if (!e.enrichedLabel) return e
      // 1. Collapse repeated "Era" patterns
      let label = e.enrichedLabel
        .replace(/\bEra\s+Era\b/gi, 'Era')
        .replace(/\s+Era\s*$/i, '')
        .trim()
      // 2. Reject labels with artifact/system words
      if (LABEL_BLACKLIST.test(label)) {
        const actors = contexts[i]?.primaryActors
        label = actors?.length > 0 ? actors[0] : 'Social Shift'
        console.log(`[AI] Label "${e.enrichedLabel}" rejected (artifact), fallback: "${label}"`)
      }
      // 3. Reject empty/short labels
      if (!label || label.length < 2) {
        const actors = contexts[i]?.primaryActors
        label = actors?.length > 0 ? actors[0] : 'Social Shift'
        console.log(`[AI] Label empty/short, fallback: "${label}"`)
      }
      // 4. Reject labels that are just generic filler
      if (/^(conversation|general|misc|other|unknown|untitled)\s*(shift|phase|period)?$/i.test(label)) {
        const actors = contexts[i]?.primaryActors
        if (actors?.length > 0) label = actors[0]
      }
      return { ...e, enrichedLabel: label }
    })

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
  type: 'phrase_count' | 'phrase_first' | 'phrase_timeline' | 'signal_rank' | 'behavior_query' | 'literal'
  phrase: string | null
  signal: string | null
  groupBy: 'person' | 'time' | 'month' | null
  sort: 'desc' | 'asc'
  limit: number
  explanation: string
}

export async function interpretSearchQuery(query: string): Promise<SearchIntent | null> {
  if (!getAIStatus().configured) return null

  const cached = getCached<SearchIntent>('search-intent-v2', query)
  if (cached) return cached

  const system = `You interpret natural-language questions about someone's iMessage history into structured search intents.

Return a JSON object:
{
  "type": "phrase_count" | "phrase_first" | "signal_rank" | "behavior_query" | "literal",
  "phrase": key phrase to search for (or null),
  "signal": for signal_rank type, one of: "laugh", "heat", "sentiment", "emoji", "question", "word_count", "all_caps", "link" (or null),
  "groupBy": "person" | "time" | "month" | null,
  "sort": "desc" | "asc",
  "limit": number (default 10),
  "explanation": short sentence explaining the query
}

Types:
- phrase_count: count how often a phrase appears, grouped by person. Use for "who do I say X to", "how often do I say X"
- phrase_first: find the first/earliest occurrence of a phrase. Use for "when did I first mention X"
- signal_rank: rank conversations by a pre-computed signal (laugh, heat, emoji, etc). Use for "who makes me laugh", "most heated", "most emoji"
- behavior_query: time-based behavior patterns. Use for "what month do I text most", "busiest day"
- literal: simple keyword search for browsing messages. Use for "show me messages about X"

Available signals for signal_rank: laugh (laugh count), heat (conversation intensity 0-10), sentiment (positive rate), emoji (emoji usage rate), question (questions asked), word_count (avg message length), all_caps (shouting rate), link (links shared)

Examples:
- "who have I said I love you to the most" → { "type": "phrase_count", "phrase": "I love you", "signal": null, "groupBy": "person", "sort": "desc", "limit": 10, "explanation": "Finding who you've said 'I love you' to most" }
- "when did I first mention golf" → { "type": "phrase_first", "phrase": "golf", "signal": null, "groupBy": null, "sort": "asc", "limit": 5, "explanation": "Finding earliest mention of golf" }
- "who sends me the most emoji" → { "type": "signal_rank", "phrase": null, "signal": "emoji", "groupBy": "person", "sort": "desc", "limit": 10, "explanation": "Ranking conversations by emoji usage" }
- "most heated conversations" → { "type": "signal_rank", "phrase": null, "signal": "heat", "groupBy": "person", "sort": "desc", "limit": 10, "explanation": "Ranking by conversation intensity" }
- "who writes the longest messages" → { "type": "signal_rank", "phrase": null, "signal": "word_count", "groupBy": "person", "sort": "desc", "limit": 10, "explanation": "Ranking by average message length" }
- "who makes me laugh the most" → { "type": "signal_rank", "phrase": null, "signal": "laugh", "groupBy": "person", "sort": "desc", "limit": 10, "explanation": "Ranking by laugh count" }
- "show me messages about apartments" → { "type": "literal", "phrase": "apartments", "signal": null, "groupBy": null, "sort": "desc", "limit": 30, "explanation": "Searching for messages about apartments" }
- "how often do I say sorry" → { "type": "phrase_count", "phrase": "sorry", "signal": null, "groupBy": "person", "sort": "desc", "limit": 10, "explanation": "Counting how often you say sorry" }

Return ONLY the JSON object, no other text.`

  const text = await callAnthropic(system, `Query: "${query}"`, 400)
  if (!text) return null

  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as SearchIntent
    setCache('search-intent-v2', query, result)
    return result
  } catch {
    return null
  }
}

// ── Conversation Summarization ──

export async function summarizeConversation(chatIdentifier: string, contactName: string, messages: { recent: { body: string; is_from_me: number; sent_at: string }[]; old: { body: string; is_from_me: number; sent_at: string }[] }): Promise<{ summary: string; topics: string[]; tone: string } | null> {
  if (!getAIStatus().configured) return null
  const cacheKey = `convo-summary:${chatIdentifier}:${messages.recent.length}`
  const cached = getCached<{ summary: string; topics: string[]; tone: string }>('convo-summary', cacheKey)
  if (cached) return cached

  const formatMsgs = (msgs: { body: string; is_from_me: number; sent_at: string }[]) =>
    msgs.map(m => `[${m.sent_at.slice(0, 10)}] ${m.is_from_me ? 'You' : 'Them'}: ${m.body}`).join('\n')

  const userMsg = `Contact: ${contactName}\n\nRecent messages (last 2 weeks):\n${formatMsgs(messages.recent)}\n\n${messages.old.length > 0 ? `Older messages (6+ months ago):\n${formatMsgs(messages.old)}` : ''}`

  const system = `You analyze iMessage conversations to generate a concise summary. Given message samples from a conversation between the user and a contact, return a JSON object:\n{\n  "summary": "2 sentences MAX. What this relationship is about at its core. Second person ('You and ${contactName}...'). Warm but concise.",\n  "topics": ["topic1", "topic2"],\n  "tone": "one word describing the overall tone (e.g., playful, supportive, professional, chaotic, deep, casual)"\n}\nRules:\n- Maximum 5 topics, each 1-3 words only. No long phrases.\n- Summary is exactly 2 sentences. Not 3.\n- Be warm and observational, not clinical.\nReturn ONLY the JSON object.`

  const text = await callAnthropic(system, userMsg, 400)
  if (!text) return null
  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as { summary: string; topics: string[]; tone: string }
    setCache('convo-summary', cacheKey, result)
    return result
  } catch { return null }
}

// ── Relationship Narrative ──

export async function generateRelationshipNarrative(chatIdentifier: string, contactName: string, stats: {
  messageCount: number; sentCount: number; receivedCount: number
  firstMessageDate: string | null; lastMessageDate: string
  peakYear: number | null; peakYearCount: number | null
  longestStreak: number; closenessScore: number; closenessRank: number | null
  tier: string; laughCount: number; avgHeat: number; positiveRate: number
}): Promise<{ narrative: string; headline: string } | null> {
  if (!getAIStatus().configured) return null
  const inputHash = JSON.stringify(stats).slice(0, 50)
  const cached = getCached<{ narrative: string; headline: string }>('rel-narrative', `${chatIdentifier}:${inputHash}`)
  if (cached) return cached

  const userMsg = `Contact: ${contactName}
Messages: ${stats.messageCount.toLocaleString()} (sent: ${stats.sentCount}, received: ${stats.receivedCount})
First message: ${stats.firstMessageDate || 'unknown'}
Last message: ${stats.lastMessageDate}
Peak year: ${stats.peakYear || 'unknown'} (${stats.peakYearCount?.toLocaleString() || '?'} messages)
Longest streak: ${stats.longestStreak} days
Closeness: ${stats.closenessScore}/100 (${stats.tier}${stats.closenessRank ? `, #${stats.closenessRank}` : ''})
Laughs: ${stats.laughCount}
Heat: ${stats.avgHeat}/10
Positive sentiment: ${stats.positiveRate}%`

  const system = `You write warm, editorial-style relationship narratives for a messaging analytics app called Stash. Given stats about a user's relationship with a contact, write:\n{\n  "headline": "A punchy 3-6 word headline that captures the EMOTIONAL essence of this relationship. Think of it as a tagline, not a description. DO NOT reference message counts or stats in the headline. Examples of GOOD headlines: 'Your 3am person', 'The one who gets it', 'Partners in chaos', 'Your safe place', 'The comeback story', 'Ride or die since 2019', 'Your favorite distraction'. Examples of BAD headlines: '16,000 messages of history', 'A deep connection', 'Your close friend'. The headline should make someone FEEL something, not describe something.",\n  "narrative": "2-3 sentences MAX. Not 4, not 5. Exactly 2 or 3 short sentences. Second person. Warm and observational. Reference ONE specific stat naturally. Do not list stats. The narrative should read like the opening line of a magazine profile, not a report."\n}\n\nRules:\n- Never frame relationship decline as failure\n- Never be judgmental about communication patterns\n- Be genuine, not cheesy\n- If the data shows a fading relationship, be gentle and hopeful\n- Reference the closeness tier naturally if relevant\n\nReturn ONLY the JSON object.`

  const text = await callAnthropic(system, userMsg, 300)
  if (!text) return null
  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as { narrative: string; headline: string }
    setCache('rel-narrative', `${chatIdentifier}:${inputHash}`, result)
    return result
  } catch { return null }
}

// ── Attachment Context Caption ──

export async function generateAttachmentCaption(chatIdentifier: string, contactName: string, attachmentInfo: { filename: string; created_at: string; is_image: boolean }, surroundingMessages: { body: string; is_from_me: number; sent_at: string }[]): Promise<{ caption: string } | null> {
  if (!getAIStatus().configured) return null
  const cacheKey = `${chatIdentifier}:${attachmentInfo.filename}:${attachmentInfo.created_at}`
  const cached = getCached<{ caption: string }>('att-caption', cacheKey)
  if (cached) return cached

  const msgContext = surroundingMessages.map(m => `[${m.sent_at.slice(0, 10)}] ${m.is_from_me ? 'You' : 'Them'}: ${m.body}`).join('\n')
  const userMsg = `Contact: ${contactName}\nFile: ${attachmentInfo.filename}\nDate: ${attachmentInfo.created_at}\nType: ${attachmentInfo.is_image ? 'Photo/Image' : 'Attachment'}\n\nSurrounding messages:\n${msgContext || '(no context available)'}`

  const system = `You write concise, warm captions for photos and attachments shared in iMessage conversations. Given the attachment metadata and surrounding messages, write:\n{\n  "caption": "A one-sentence caption that gives this moment context. Reference who sent it, when, and what the conversation was about. Be warm and specific."\n}\n\nExamples:\n- "A sunset photo Tyler sent you during your road trip to Joshua Tree, June 2024."\n- "The screenshot that started a 45-minute debate about restaurant picks."\n- "A selfie from Ash, right after you made plans to meet up."\n\nReturn ONLY the JSON object.`

  const text = await callAnthropic(system, userMsg, 150)
  if (!text) return null
  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as { caption: string }
    setCache('att-caption', cacheKey, result)
    return result
  } catch { return null }
}

// ── Conversational AI Search ──

export interface ConversationalSearchResult {
  answer: string; sources: string[]; followUp: string | null
}

export async function conversationalSearch(query: string, dataContext: {
  topContacts: { name: string; messages: number; tier: string }[]
  recentSearchResults: { contact: string; snippet: string; date: string }[]
  signalSummary: { contact: string; laughs: number; heat: number; emoji: number; sentiment: number }[]
  globalStats: { totalMessages: number; totalContacts: number; oldestMessage: string }
}): Promise<ConversationalSearchResult | null> {
  if (!getAIStatus().configured) return null
  const cached = getCached<ConversationalSearchResult>('convo-search', `${query}:${dataContext.topContacts.length}`)
  if (cached) return cached

  const contactLines = dataContext.topContacts.map(c => `${c.name} — ${c.messages > 0 ? c.messages + ' msgs, ' : ''}${c.tier}`).join('\n')
  const searchLines = dataContext.recentSearchResults.map(r => `${r.contact}: "${r.snippet}" (${r.date})`).join('\n')
  const signalLines = dataContext.signalSummary.map(s => `${s.contact} — laughs:${s.laughs}, heat:${s.heat}, emoji:${s.emoji}%, positive:${s.sentiment}%`).join('\n')

  const userMsg = `Question: "${query}"\n\nDATA CONTEXT:\nTop contacts (by closeness):\n${contactLines || '(none)'}\n\n${searchLines ? `Recent message matches:\n${searchLines}\n\n` : ''}${signalLines ? `Signal summary:\n${signalLines}\n\n` : ''}Global: ${dataContext.globalStats.totalMessages > 0 ? dataContext.globalStats.totalMessages + ' total messages, ' : ''}${dataContext.globalStats.totalContacts} contacts${dataContext.globalStats.oldestMessage ? ', oldest message ' + dataContext.globalStats.oldestMessage : ''}`

  const system = `You are a search assistant for Stash, an iMessage analytics app. The user is asking a question about their messaging history. You have access to a data summary about their conversations.\n\nAnswer their question using ONLY the data provided. If the data doesn't contain enough information, say so honestly and suggest what they could search for instead.\n\nReturn a JSON object:\n{\n  "answer": "A direct, conversational answer in 1-3 sentences. Second person ('You...'). Be specific with names and numbers when the data supports it.",\n  "sources": ["contact1", "contact2"],\n  "followUp": "A suggested follow-up question, or null"\n}\n\nRules:\n- Be direct. Answer first, then context.\n- Use actual names and numbers from the data.\n- If data can't answer the question, be honest.\n- Never fabricate data.\n- Keep answers warm and conversational.\n\nReturn ONLY the JSON object.`

  const text = await callAnthropic(system, userMsg, 400)
  if (!text) return null
  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as ConversationalSearchResult
    setCache('convo-search', `${query}:${dataContext.topContacts.length}`, result)
    return result
  } catch { return null }
}

// ── Relationship Dynamics AI Analysis ──

export interface AIRelationshipDynamics {
  conflictPattern: string | null; supportPattern: string | null
  insideJokes: string[] | null; relationshipPhase: string | null
  communicationStyleMatch: number | null
  topicEvolution: { then: string; now: string } | null
  vulnerabilityBalance: string | null
}

export async function analyzeRelationshipDynamics(chatIdentifier: string, contactName: string, messageSamples: { body: string; is_from_me: number; sent_at: string }[], stats: { messageCount: number; myWords: number; theirWords: number; myQuestions: number; theirQuestions: number; myPositiveRate: number; theirPositiveRate: number }): Promise<AIRelationshipDynamics | null> {
  if (!getAIStatus().configured) return null
  const cacheKey = `${chatIdentifier}:${stats.messageCount}`
  const cached = getCached<AIRelationshipDynamics>('rel-dynamics', cacheKey)
  if (cached) return cached

  const formatMsgs = (msgs: { body: string; is_from_me: number; sent_at: string }[]) =>
    msgs.slice(0, 40).map(m => `[${m.sent_at.slice(0, 10)}] ${m.is_from_me ? 'You' : 'Them'}: ${m.body.slice(0, 100)}`).join('\n')

  const userMsg = `Contact: ${contactName}\nStats: ${stats.messageCount} messages, you wrote ${stats.myWords} words, they wrote ${stats.theirWords} words. You asked ${stats.myQuestions} questions, they asked ${stats.theirQuestions}. Your positive rate: ${stats.myPositiveRate}%, theirs: ${stats.theirPositiveRate}%.\n\nMessages:\n${formatMsgs(messageSamples)}`

  const system = `You analyze iMessage conversation dynamics. Given message samples and stats, return a JSON object. For any field where you don't have enough data, use null.\n\n{\n  "conflictPattern": "One sentence about any conflict/tension pattern. Null if none.",\n  "supportPattern": "One sentence about emotional support dynamics. Null if unclear.",\n  "insideJokes": ["phrase1", "phrase2"] or null. Max 3 repeated unique phrases/references.",\n  "relationshipPhase": "One sentence about the current phase. Null if unclear.",\n  "communicationStyleMatch": number 0-100 (style similarity) or null,\n  "topicEvolution": { "then": "1-3 words", "now": "1-3 words" } or null,\n  "vulnerabilityBalance": "One sentence about who opens up more. Null if unclear."\n}\n\nRules:\n- Observational, not judgmental\n- Never frame patterns as failures\n- Warm but honest\n- ONE sentence max per field\n- Use null freely\n- Return ONLY the JSON object.`

  const text = await callAnthropic(system, userMsg, 600)
  if (!text) return null
  try {
    const result = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as AIRelationshipDynamics
    setCache('rel-dynamics', cacheKey, result)
    return result
  } catch { return null }
}

// ── Search V2: AI Query Planner ──

import type { SearchPlan } from './searchV2'

const SEARCH_PLAN_CACHE_TTL = 60 * 60 * 1000 // 1 hour

export async function parseSearchPlan(
  query: string,
  availableContacts: { name: string; identifier: string }[],
  currentDate: string
): Promise<SearchPlan | null> {
  if (!getAIStatus().configured) return null

  const cached = getCached<SearchPlan>('search-plan', query)
  if (cached) return cached

  const contactList = availableContacts.slice(0, 100).map(c => `- "${c.name}" → ${c.identifier}`).join('\n')

  const system = `You parse natural language search queries about someone's iMessage history into a structured search plan. You are NOT answering the question — you are creating a search strategy.

Available contacts (name → identifier):
${contactList}

Today's date: ${currentDate}

Given a query, extract ALL dimensions:

{
  "people": ["exact contact names from the available list"],
  "groups": ["group chat names if mentioned"],
  "topic": "the semantic topic in 1-5 words, or null",
  "keywords": ["specific search terms to look for in message text"],
  "semanticExpansions": ["3-5 related words that might appear in relevant messages"],
  "timeRange": { "start": "YYYY-MM-DD or null", "end": "YYYY-MM-DD or null", "description": "human-readable" } or null,
  "modalities": "messages" | "attachments" | "both",
  "attachmentTypes": [],
  "speaker": "me" | "them" | "both",
  "sort": "relevance" | "recent" | "oldest",
  "answerMode": "results" | "summary" | "results+summary" | "ranking",
  "confidence": 0.0-1.0
}

Rules:
- Match people names FUZZY — "ash" matches "Ash", "Ashley" etc. Return the EXACT name from the available list.
- Resolve relative dates: "last summer" → June-August of last year. "this year" → Jan 1 to today. "recently" → last 30 days.
- If the query mentions photos/images/screenshots → set modalities to "attachments" or "both" and add attachment types.
- semanticExpansions: add 3-5 related words. "cabo trip" → ["vacation", "beach", "flight", "hotel", "mexico"]
- If the query is just a word/phrase with no other filters, set keywords to that phrase, everything else null/default.
- "who did I talk to most" / "most active" / "top conversations" / "rank by" → answerMode = "ranking", keywords = [], modalities = "messages"
- Any query asking to RANK or find the MOST/TOP/BIGGEST when asking about people → answerMode = "ranking"
- confidence: 0.9+ if person and topic are clear. 0.5-0.8 if ambiguous.

Return ONLY the JSON object.`

  const text = await callAnthropic(system, `Query: "${query}"`, 600)
  if (!text) return null

  try {
    const raw = JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, ''))
    const plan: SearchPlan = {
      people: raw.people || [],
      groups: raw.groups || [],
      peopleIdentifiers: [], // resolved post-parse
      topic: raw.topic || null,
      keywords: raw.keywords || [],
      semanticExpansions: raw.semanticExpansions || [],
      timeRange: raw.timeRange || null,
      modalities: raw.modalities || 'both',
      attachmentTypes: raw.attachmentTypes || [],
      speaker: raw.speaker || 'both',
      sort: raw.sort || 'relevance',
      answerMode: raw.answerMode || 'results',
      confidence: raw.confidence || 0.5,
      originalQuery: query
    }

    // Resolve people names to identifiers
    const nameMap = new Map<string, string>()
    for (const c of availableContacts) nameMap.set(c.name.toLowerCase(), c.identifier)
    plan.peopleIdentifiers = plan.people
      .map(p => nameMap.get(p.toLowerCase()))
      .filter(Boolean) as string[]

    setCache('search-plan', query, plan)
    return plan
  } catch { return null }
}

// ── Proactive Intelligence: detect commitments, plans, events ──

export interface DetectedProactiveItem {
  type: 'commitment' | 'event' | 'follow_up' | 'birthday' | 'plan'
  description: string
  dueDate: string | null
  sourceMessage: string
}

// 24h cooldown per contact to avoid hammering the API
const proactiveCooldowns = new Map<string, number>()
const PROACTIVE_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function detectProactiveItems(
  chatIdentifier: string,
  contactName: string,
  messages: { body: string; is_from_me: number; sent_at: string }[]
): Promise<{ items: DetectedProactiveItem[] } | null> {
  if (!getAIStatus().configured) return null

  // Cooldown check
  const lastRun = proactiveCooldowns.get(chatIdentifier) || 0
  if (Date.now() - lastRun < PROACTIVE_COOLDOWN_MS) return null
  proactiveCooldowns.set(chatIdentifier, Date.now())

  const formatted = messages.map(m =>
    `[${m.sent_at.slice(0, 10)}] ${m.is_from_me ? 'You' : contactName}: ${m.body.slice(0, 200)}`
  ).join('\n')

  const system = `You scan iMessage conversations for actionable items the user should be reminded about.

Look for:
- COMMITMENTS: Things the user promised to do ("I'll send that over", "Let me check and get back to you")
- EVENTS: Upcoming plans mentioned ("dinner Friday", "meeting next week", "concert on the 15th")
- FOLLOW-UPS: Things the user should follow up on ("let me know how it goes", "keep me posted")
- BIRTHDAYS: Any mention of upcoming birthdays
- PLANS: Tentative plans that need confirmation ("we should grab coffee", "let's do that sometime")

Today is ${new Date().toISOString().slice(0, 10)}.

Return a JSON object:
{
  "items": [
    {
      "type": "commitment" | "event" | "follow_up" | "birthday" | "plan",
      "description": "Short, actionable description (1 sentence)",
      "dueDate": "YYYY-MM-DD" or null if no clear date,
      "sourceMessage": "The exact message that triggered this (truncated to 100 chars)"
    }
  ]
}

Rules:
- Only include items that are genuinely actionable
- Skip vague pleasantries ("we should hang out sometime" with no follow-through)
- Only include items from the last 14 days
- Max 3 items per conversation
- If no actionable items found, return {"items": []}
- Return ONLY the JSON object`

  const text = await callAnthropic(system, `Conversation with ${contactName}:\n\n${formatted}`, 600)
  if (!text) return null
  try {
    return JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as { items: DetectedProactiveItem[] }
  } catch { return null }
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
