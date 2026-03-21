/**
 * Search V2 — multi-axis query planning and parallel retrieval.
 *
 * Architecture:
 * 1. parseSearchPlan (AI) → structured search plan
 * 2. executeSearchV2 → parallel retrieval across messages, attachments, conversations
 * 3. Result fusion → scored, sectioned results
 */

import { initDb } from './db'
import { callAnthropic } from './ai'

// ── Search Plan Schema ──

export interface SearchPlan {
  people: string[]
  groups: string[]
  peopleIdentifiers: string[]
  topic: string | null
  keywords: string[]
  semanticExpansions: string[]
  timeRange: {
    start: string | null
    end: string | null
    description: string
  } | null
  modalities: 'messages' | 'attachments' | 'both'
  attachmentTypes: string[]
  speaker: 'me' | 'them' | 'both'
  sort: 'relevance' | 'recent' | 'oldest'
  answerMode: 'results' | 'summary' | 'results+summary' | 'ranking' | 'temporal' | 'signal_ranking'
  confidence: number
  originalQuery: string
}

// ── Result Types ──

export interface MessageResult {
  body: string
  chat_name: string
  contact_name: string
  is_from_me: boolean
  sent_at: string
  matchReason: string
  relevanceScore: number
}

export interface AttachmentResult {
  id: number
  filename: string
  chat_name: string
  contact_name: string
  created_at: string
  thumbnail_path: string | null
  is_image: boolean
  matchReason: string
  ocrSnippet?: string
}

export interface ConversationResult {
  chat_name: string
  contact_name: string
  messageCount: number
  matchingMessages: number
  dateRange: string
  preview: string
}

export interface SearchResultV2 {
  plan: SearchPlan
  sections: {
    messages: MessageResult[]
    attachments: AttachmentResult[]
    conversations: ConversationResult[]
    summary: string | null
  }
  totalResults: number
  searchTimeMs: number
  redirect?: {
    message: string
    person: string
    chatIdentifier: string
    suggestedQuery: string
  }
}

// ── Relationship Search Types ──

export interface RelationshipSearchResult {
  answer: string
  episodes: {
    title: string
    messages: { body: string; is_from_me: boolean; sent_at: string }[]
    insight: string
  }[]
  evidence: { label: string; value: string }[]
  suggestedFollowUps: string[]
}

// ── Parallel Retrieval Engine ──

export async function executeSearchV2(
  plan: SearchPlan,
  chatNameMap: Record<string, string>
): Promise<SearchResultV2> {
  const t0 = Date.now()
  const d = initDb()
  const resolve = (raw: string): string => chatNameMap[raw] || raw

  // Post-process: strip modality words from topic (AI sometimes gets this wrong)
  const MODALITY_WORDS = new Set(['photos','photo','pictures','picture','pics','images','image','videos','video','clips','screenshots','screenshot','links','urls','files','documents','memes','selfies','recordings','media'])
  if (plan.topic && MODALITY_WORDS.has(plan.topic.toLowerCase())) {
    plan.topic = null
    plan.keywords = plan.keywords.filter(k => !MODALITY_WORDS.has(k.toLowerCase()))
  }

  const personParams = plan.peopleIdentifiers
  const dateStart = plan.timeRange?.start || null
  const dateEnd = plan.timeRange?.end || null

  // RETRIEVER 0: Ranking query (short-circuit — returns early)
  if (plan.answerMode === 'ranking') {
    try {
      const whereParts: string[] = []
      const params: string[] = []
      if (dateStart) { whereParts.push(`sent_at >= ?`); params.push(dateStart) }
      if (dateEnd) { whereParts.push(`sent_at <= ?`); params.push(dateEnd + ' 23:59:59') }
      if (plan.speaker === 'me') whereParts.push('is_from_me = 1')
      else if (plan.speaker === 'them') whereParts.push('is_from_me = 0')

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
      const rows = d.prepare(`
        SELECT chat_name, COUNT(*) as msg_count
        FROM messages ${whereClause}
        GROUP BY chat_name ORDER BY msg_count DESC LIMIT 15
      `).all(...params) as { chat_name: string; msg_count: number }[]

      const filtered = rows.filter(r => {
        const name = resolve(r.chat_name)
        if (name === r.chat_name && (r.chat_name.startsWith('+') || /^chat\d+/.test(r.chat_name) || /^[a-f0-9]{8,}/i.test(r.chat_name))) return false
        if (name === 'Unknown' || name === 'unknown') return false
        return true
      })

      console.log(`[SearchV2] Ranking: ${filtered.length} contacts (${rows.length} raw, ${Date.now() - t0}ms)`)
      return {
        plan,
        sections: {
          messages: [],
          attachments: [],
          conversations: filtered.map(r => ({
            chat_name: r.chat_name,
            contact_name: resolve(r.chat_name),
            messageCount: r.msg_count,
            matchingMessages: r.msg_count,
            dateRange: plan.timeRange?.description || 'all time',
            preview: `${r.msg_count.toLocaleString()} messages`
          })),
          summary: null
        },
        totalResults: filtered.length,
        searchTimeMs: Date.now() - t0
      }
    } catch (err) { console.error('[SearchV2] Ranking error:', err) }
  }

  // RETRIEVER 0b: Temporal query (short-circuit — "when did I first talk to...")
  if (plan.answerMode === 'temporal' && plan.peopleIdentifiers.length > 0) {
    try {
      const target = plan.peopleIdentifiers[0]
      const contactName = resolve(target)
      const first = d.prepare(`SELECT MIN(sent_at) as d FROM messages WHERE chat_name = ?`).get(target) as { d: string } | undefined
      const last = d.prepare(`SELECT MAX(sent_at) as d FROM messages WHERE chat_name = ?`).get(target) as { d: string } | undefined
      const total = (d.prepare(`SELECT COUNT(*) as c FROM messages WHERE chat_name = ?`).get(target) as { c: number }).c

      const firstDate = first?.d ? new Date(first.d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'unknown'
      const lastDate = last?.d ? new Date(last.d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'unknown'

      const firstMessages = d.prepare(`
        SELECT body, is_from_me, sent_at FROM messages
        WHERE chat_name = ? ORDER BY apple_date ASC LIMIT 5
      `).all(target) as { body: string; is_from_me: number; sent_at: string }[]

      console.log(`[SearchV2] Temporal: ${contactName} first=${firstDate} last=${lastDate} (${Date.now() - t0}ms)`)
      return {
        plan,
        sections: {
          messages: firstMessages.map(m => ({
            body: m.body.slice(0, 300),
            chat_name: target,
            contact_name: contactName,
            is_from_me: m.is_from_me === 1,
            sent_at: m.sent_at,
            matchReason: 'first messages',
            relevanceScore: 1.0
          })),
          attachments: [],
          conversations: [{
            chat_name: target,
            contact_name: contactName,
            messageCount: total,
            matchingMessages: total,
            dateRange: `${firstDate} — ${lastDate}`,
            preview: `First message: ${firstDate} · ${total.toLocaleString()} messages total`
          }],
          summary: `You first talked to ${contactName} on ${firstDate}. Your most recent message was ${lastDate}. You've exchanged ${total.toLocaleString()} messages total.`
        },
        totalResults: firstMessages.length + 1,
        searchTimeMs: Date.now() - t0
      }
    } catch (err) { console.error('[SearchV2] Temporal error:', err) }
  }

  // RETRIEVER 0c: Signal-based ranking ("who do I argue with most" → heat)
  if (plan.answerMode === 'signal_ranking') {
    try {
      const signalMap: Record<string, { column: string; label: string }> = {
        heat: { column: 'avg_heat', label: 'avg heat' },
        laugh: { column: 'CAST(laugh_count AS REAL) / NULLIF(total_analyzed, 0)', label: 'laugh rate' },
        positive: { column: 'positive_rate', label: '% positive' },
        negative: { column: 'negative_rate', label: '% negative' },
        emoji: { column: 'emoji_rate', label: '% emoji' },
        question: { column: 'CAST(question_count AS REAL) / NULLIF(total_analyzed, 0)', label: 'question rate' },
      }
      const sig = signalMap[plan.topic?.toLowerCase() || ''] || signalMap['heat']
      const rows = d.prepare(`
        SELECT chat_identifier, ${sig.column} as value, total_analyzed
        FROM conversation_signals WHERE total_analyzed >= 50
        ORDER BY ${sig.column} DESC LIMIT 15
      `).all() as { chat_identifier: string; value: number; total_analyzed: number }[]

      const filtered = rows.filter(r => {
        const name = resolve(r.chat_identifier)
        if (name === r.chat_identifier && (r.chat_identifier.startsWith('+') || /^chat\d+/.test(r.chat_identifier) || /^[a-f0-9]{8,}/i.test(r.chat_identifier))) return false
        if (name === 'Unknown' || name === 'unknown') return false
        return true
      })

      console.log(`[SearchV2] Signal ranking (${plan.topic}): ${filtered.length} contacts (${Date.now() - t0}ms)`)
      return {
        plan,
        sections: {
          messages: [],
          attachments: [],
          conversations: filtered.map(r => ({
            chat_name: r.chat_identifier,
            contact_name: resolve(r.chat_identifier),
            messageCount: r.total_analyzed,
            matchingMessages: Math.round(r.value * 100) / 100,
            dateRange: sig.label,
            preview: `${Math.round(r.value * 100) / 100} ${sig.label}`
          })),
          summary: null
        },
        totalResults: filtered.length,
        searchTimeMs: Date.now() - t0
      }
    } catch (err) { console.error('[SearchV2] Signal ranking error:', err) }
  }

  const [messageResults, attachmentResults, conversationResults] = await Promise.all([

    // RETRIEVER 1: Message search (FTS + filters)
    (async (): Promise<MessageResult[]> => {
      if (plan.modalities === 'attachments') return []
      const results: MessageResult[] = []

      const allKeywords = [...plan.keywords, ...(plan.topic ? [plan.topic] : [])]

      // A. Exact keyword FTS
      if (allKeywords.length > 0) {
        try {
          const ftsTerms = allKeywords.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ')
          let sql = `SELECT m.body, m.chat_name, m.is_from_me, m.sent_at
            FROM messages_fts fts JOIN messages m ON fts.rowid = m.id
            WHERE messages_fts MATCH ?`
          const params: (string | number)[] = [ftsTerms]

          if (personParams.length > 0) {
            sql += ` AND m.chat_name IN (${personParams.map(() => '?').join(',')})`
            params.push(...personParams)
          }
          if (dateStart) { sql += ` AND m.sent_at >= ?`; params.push(dateStart) }
          if (dateEnd) { sql += ` AND m.sent_at <= ?`; params.push(dateEnd + ' 23:59:59') }
          if (plan.speaker === 'me') sql += ` AND m.is_from_me = 1`
          else if (plan.speaker === 'them') sql += ` AND m.is_from_me = 0`

          sql += ` ORDER BY m.apple_date DESC LIMIT 50`
          const rows = d.prepare(sql).all(...params) as { body: string; chat_name: string; is_from_me: number; sent_at: string }[]

          for (const r of rows) {
            results.push({
              body: r.body.slice(0, 300),
              chat_name: r.chat_name,
              contact_name: resolve(r.chat_name),
              is_from_me: r.is_from_me === 1,
              sent_at: r.sent_at,
              matchReason: 'keyword match',
              relevanceScore: 1.0
            })
          }
        } catch (err) { console.log('[SearchV2] FTS error:', err) }
      }

      // B. Semantic expansion (lower priority, fill up to 30, capped at 3 terms)
      if (plan.semanticExpansions.length > 0 && results.length < 20) {
        try {
          const expTerms = plan.semanticExpansions.slice(0, 3).map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ')
          let sql = `SELECT m.body, m.chat_name, m.is_from_me, m.sent_at
            FROM messages_fts fts JOIN messages m ON fts.rowid = m.id
            WHERE messages_fts MATCH ?`
          const params: (string | number)[] = [expTerms]

          if (personParams.length > 0) {
            sql += ` AND m.chat_name IN (${personParams.map(() => '?').join(',')})`
            params.push(...personParams)
          }
          if (dateStart) { sql += ` AND m.sent_at >= ?`; params.push(dateStart) }
          if (dateEnd) { sql += ` AND m.sent_at <= ?`; params.push(dateEnd + ' 23:59:59') }

          sql += ` LIMIT 30`
          const rows = d.prepare(sql).all(...params) as { body: string; chat_name: string; is_from_me: number; sent_at: string }[]

          const existingKeys = new Set(results.map(r => `${r.sent_at}:${r.chat_name}`))
          for (const r of rows) {
            if (existingKeys.has(`${r.sent_at}:${r.chat_name}`)) continue
            results.push({
              body: r.body.slice(0, 300),
              chat_name: r.chat_name,
              contact_name: resolve(r.chat_name),
              is_from_me: r.is_from_me === 1,
              sent_at: r.sent_at,
              matchReason: 'topic match',
              relevanceScore: 0.6
            })
          }
        } catch {}
      }

      // C. If no keywords but person + date filters exist, show recent messages
      if (allKeywords.length === 0 && plan.semanticExpansions.length === 0 && (personParams.length > 0 || dateStart)) {
        try {
          let sql = `SELECT body, chat_name, is_from_me, sent_at FROM messages WHERE 1=1`
          const params: (string | number)[] = []
          if (personParams.length > 0) {
            sql += ` AND chat_name IN (${personParams.map(() => '?').join(',')})`
            params.push(...personParams)
          }
          if (dateStart) { sql += ` AND sent_at >= ?`; params.push(dateStart) }
          if (dateEnd) { sql += ` AND sent_at <= ?`; params.push(dateEnd + ' 23:59:59') }
          if (plan.speaker === 'me') sql += ` AND is_from_me = 1`
          else if (plan.speaker === 'them') sql += ` AND is_from_me = 0`
          sql += ` ORDER BY apple_date DESC LIMIT 30`

          const rows = d.prepare(sql).all(...params) as { body: string; chat_name: string; is_from_me: number; sent_at: string }[]
          for (const r of rows) {
            results.push({
              body: r.body.slice(0, 300),
              chat_name: r.chat_name,
              contact_name: resolve(r.chat_name),
              is_from_me: r.is_from_me === 1,
              sent_at: r.sent_at,
              matchReason: 'date match',
              relevanceScore: 0.5
            })
          }
        } catch {}
      }

      return results.slice(0, 30)
    })(),

    // RETRIEVER 2: Attachment search (metadata + OCR)
    (async (): Promise<AttachmentResult[]> => {
      if (plan.modalities === 'messages') return []
      const results: AttachmentResult[] = []

      try {
        const whereParts = ['1=1']
        const params: (string | number)[] = []

        if (personParams.length > 0) {
          whereParts.push(`chat_name IN (${personParams.map(() => '?').join(',')})`)
          params.push(...personParams)
        }
        if (dateStart) { whereParts.push(`created_at >= ?`); params.push(dateStart) }
        if (dateEnd) { whereParts.push(`created_at <= ?`); params.push(dateEnd + ' 23:59:59') }
        if (plan.attachmentTypes.length > 0) {
          const typeConds = plan.attachmentTypes.map(t => {
            if (t === 'image' || t === 'photo' || t === 'screenshot') return 'is_image = 1'
            if (t === 'video') return 'is_video = 1'
            if (t === 'pdf' || t === 'document') return 'is_document = 1'
            return null
          }).filter(Boolean)
          if (typeConds.length > 0) whereParts.push(`(${typeConds.join(' OR ')})`)
        }

        const allKeywords = [...plan.keywords, ...(plan.topic ? [plan.topic] : [])]
        let attachRows: { id: number; filename: string; chat_name: string; created_at: string; thumbnail_path: string | null; is_image: number; ocr_text: string | null }[]

        if (allKeywords.length > 0) {
          try {
            const ftsTerms = allKeywords.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ')
            attachRows = d.prepare(`
              SELECT a.id, a.filename, a.chat_name, a.created_at, a.thumbnail_path, a.is_image, a.ocr_text
              FROM attachments_fts afts JOIN attachments a ON afts.rowid = a.id
              WHERE attachments_fts MATCH ?
              ${whereParts.slice(1).map(w => 'AND a.' + w).join(' ')}
              ORDER BY a.created_at DESC LIMIT 50
            `).all(ftsTerms, ...params) as typeof attachRows
          } catch {
            // FTS failed, fall back to LIKE on filename
            attachRows = d.prepare(`
              SELECT id, filename, chat_name, created_at, thumbnail_path, is_image, ocr_text
              FROM attachments WHERE ${whereParts.join(' AND ')}
              AND (filename LIKE ? OR ocr_text LIKE ?)
              ORDER BY created_at DESC LIMIT 50
            `).all(...params, `%${allKeywords[0]}%`, `%${allKeywords[0]}%`) as typeof attachRows
          }
        } else {
          // No keywords — return all attachments matching person/date/type filters
          attachRows = d.prepare(`
            SELECT id, filename, chat_name, created_at, thumbnail_path, is_image, ocr_text
            FROM attachments WHERE ${whereParts.join(' AND ')}
            ORDER BY created_at DESC LIMIT 50
          `).all(...params) as typeof attachRows
        }

        for (const r of attachRows) {
          results.push({
            id: r.id,
            filename: r.filename || '',
            chat_name: r.chat_name,
            contact_name: resolve(r.chat_name),
            created_at: r.created_at,
            thumbnail_path: r.thumbnail_path,
            is_image: r.is_image === 1,
            matchReason: r.ocr_text && allKeywords.some(k => r.ocr_text!.toLowerCase().includes(k.toLowerCase())) ? 'OCR match' : 'metadata match',
            ocrSnippet: r.ocr_text?.slice(0, 100) || undefined
          })
        }
      } catch (err) { console.log('[SearchV2] Attachment search error:', err) }

      return results
    })(),

    // RETRIEVER 3: Conversation-level results
    (async (): Promise<ConversationResult[]> => {
      if (personParams.length === 0 && !plan.topic) return []
      const results: ConversationResult[] = []

      try {
        const targets = personParams.length > 0 ? personParams : []
        for (const ci of targets) {
          const allKeywords = [...plan.keywords, ...(plan.topic ? [plan.topic] : [])]
          let matchCount = 0

          if (allKeywords.length > 0) {
            try {
              const ftsTerms = allKeywords.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ')
              let sql = `SELECT COUNT(*) as cnt FROM messages_fts fts
                JOIN messages m ON fts.rowid = m.id
                WHERE messages_fts MATCH ? AND m.chat_name = ?`
              const params: (string | number)[] = [ftsTerms, ci]
              if (dateStart) { sql += ` AND m.sent_at >= ?`; params.push(dateStart) }
              if (dateEnd) { sql += ` AND m.sent_at <= ?`; params.push(dateEnd + ' 23:59:59') }
              const row = d.prepare(sql).get(...params) as { cnt: number }
              matchCount = row.cnt
            } catch {}
          }

          const totalRow = d.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE chat_name = ?`).get(ci) as { cnt: number }
          const dateRow = d.prepare(`SELECT MIN(sent_at) as first, MAX(sent_at) as last FROM messages WHERE chat_name = ?`).get(ci) as { first: string; last: string }

          results.push({
            chat_name: ci,
            contact_name: resolve(ci),
            messageCount: totalRow.cnt,
            matchingMessages: matchCount,
            dateRange: `${dateRow.first?.slice(0, 10) || '?'} — ${dateRow.last?.slice(0, 10) || '?'}`,
            preview: matchCount > 0 ? `${matchCount} messages match your search` : `${totalRow.cnt.toLocaleString()} total messages`
          })
        }
      } catch {}

      return results
    })()
  ])

  // Lightweight context: find attachments near matched message dates
  if (messageResults.length > 0 && plan.modalities !== 'messages' && attachmentResults.length < 10) {
    const existingIds = new Set(attachmentResults.map(a => a.id))
    const msgDates = [...new Set(messageResults.slice(0, 10).map(m => m.sent_at.slice(0, 10)))]
    for (const date of msgDates.slice(0, 5)) {
      try {
        const chatFilter = personParams.length > 0 ? ` AND chat_name IN (${personParams.map(() => '?').join(',')})` : ''
        const nearby = d.prepare(`
          SELECT id, filename, chat_name, created_at, thumbnail_path, is_image, ocr_text
          FROM attachments WHERE date(created_at) = ?${chatFilter}
          LIMIT 5
        `).all(date, ...(personParams.length > 0 ? personParams : [])) as { id: number; filename: string; chat_name: string; created_at: string; thumbnail_path: string | null; is_image: number; ocr_text: string | null }[]
        for (const r of nearby) {
          if (existingIds.has(r.id)) continue
          existingIds.add(r.id)
          attachmentResults.push({
            id: r.id, filename: r.filename || '', chat_name: r.chat_name,
            contact_name: resolve(r.chat_name), created_at: r.created_at,
            thumbnail_path: r.thumbnail_path, is_image: r.is_image === 1,
            matchReason: 'near matching messages', ocrSnippet: r.ocr_text?.slice(0, 100) || undefined
          })
        }
      } catch {}
    }
  }

  // AI summary (only if requested and we have message results)
  let summary: string | null = null
  if (plan.answerMode.includes('summary') && messageResults.length > 0) {
    try {
      const { conversationalSearch } = require('./ai')
      const topMessages = messageResults.slice(0, 10).map(m => ({
        contact: m.contact_name, snippet: m.body.slice(0, 80), date: m.sent_at.slice(0, 10)
      }))
      const aiResult = await conversationalSearch(plan.originalQuery, {
        topContacts: [], recentSearchResults: topMessages, signalSummary: [],
        globalStats: { totalMessages: 0, totalContacts: 0, oldestMessage: '' }
      })
      if (aiResult) summary = aiResult.answer
    } catch {}
  }

  console.log(`[SearchV2] ${messageResults.length} msgs, ${attachmentResults.length} attachments, ${conversationResults.length} convos (${Date.now() - t0}ms)`)

  // Detect relationship-deep queries and suggest redirect
  const DEEP_PATTERNS = /show me times|when was I|who.s more|show me when|times I forgot|our (funniest|longest|most)|how do we|our relationship|between us/i
  let redirect: SearchResultV2['redirect'] = undefined
  if (DEEP_PATTERNS.test(plan.originalQuery) && plan.people.length === 1 && plan.peopleIdentifiers.length === 1) {
    redirect = {
      message: `For deeper insights about ${plan.people[0]}, try asking in their relationship view where I can read your full conversation.`,
      person: plan.people[0],
      chatIdentifier: plan.peopleIdentifiers[0],
      suggestedQuery: plan.originalQuery
    }
  }

  return {
    plan,
    sections: { messages: messageResults, attachments: attachmentResults, conversations: conversationResults, summary },
    totalResults: messageResults.length + attachmentResults.length + conversationResults.length,
    searchTimeMs: Date.now() - t0,
    redirect
  }
}

// ── Relationship Search — AI-first engine ──

export async function executeRelationshipSearch(
  query: string,
  chatIdentifier: string,
  contactName: string
): Promise<RelationshipSearchResult | null> {
  const d = initDb()

  const totalMsgs = (d.prepare('SELECT COUNT(*) as c FROM messages WHERE chat_name = ?').get(chatIdentifier) as { c: number }).c
  if (totalMsgs < 5) return null

  // Step 1: Targeted sampling based on query intent
  const recent = d.prepare(`SELECT body, is_from_me, sent_at FROM messages WHERE chat_name = ? AND body IS NOT NULL AND length(body) > 5 ORDER BY apple_date DESC LIMIT 50`).all(chatIdentifier) as { body: string; is_from_me: number; sent_at: string }[]
  const oldest = d.prepare(`SELECT body, is_from_me, sent_at FROM messages WHERE chat_name = ? AND body IS NOT NULL AND length(body) > 5 ORDER BY apple_date ASC LIMIT 50`).all(chatIdentifier) as { body: string; is_from_me: number; sent_at: string }[]
  const middle = d.prepare(`SELECT body, is_from_me, sent_at FROM messages WHERE chat_name = ? AND body IS NOT NULL AND length(body) > 10 ORDER BY RANDOM() LIMIT 100`).all(chatIdentifier) as { body: string; is_from_me: number; sent_at: string }[]

  let targeted: typeof recent = []
  const ql = query.toLowerCase()
  try {
    if (/argu|fight|conflict|confront|heated|disagree|tension/.test(ql)) {
      targeted = d.prepare(`SELECT m.body, m.is_from_me, m.sent_at FROM messages m JOIN message_signals ms ON m.chat_name = ms.chat_identifier AND m.sent_at = ms.sent_at WHERE m.chat_name = ? AND ms.heat_score >= 5 ORDER BY ms.heat_score DESC LIMIT 50`).all(chatIdentifier) as typeof recent
    } else if (/sweet|kind|nice|loving|romantic|support|caring/.test(ql)) {
      targeted = d.prepare(`SELECT m.body, m.is_from_me, m.sent_at FROM messages m JOIN message_signals ms ON m.chat_name = ms.chat_identifier AND m.sent_at = ms.sent_at WHERE m.chat_name = ? AND ms.sentiment > 0 ORDER BY ms.sentiment DESC LIMIT 50`).all(chatIdentifier) as typeof recent
    } else if (/forgot|forget|remember|promise|said.*would/.test(ql)) {
      targeted = d.prepare(`SELECT body, is_from_me, sent_at FROM messages WHERE chat_name = ? AND is_from_me = 1 AND (body LIKE '%I will%' OR body LIKE '%I''ll%' OR body LIKE '%I promise%' OR body LIKE '%remind me%' OR body LIKE '%don''t forget%' OR body LIKE '%I need to%') ORDER BY apple_date DESC LIMIT 50`).all(chatIdentifier) as typeof recent
    } else if (/longest|verbose|biggest/.test(ql)) {
      targeted = d.prepare(`SELECT body, is_from_me, sent_at FROM messages WHERE chat_name = ? AND body IS NOT NULL ORDER BY length(body) DESC LIMIT 20`).all(chatIdentifier) as typeof recent
    }
  } catch {}

  // Deduplicate and sort chronologically
  const seen = new Set<string>()
  const allSamples: typeof recent = []
  for (const batch of [targeted, recent, oldest, middle]) {
    for (const m of batch) {
      if (!seen.has(m.sent_at)) { seen.add(m.sent_at); allSamples.push(m) }
    }
  }
  allSamples.sort((a, b) => a.sent_at.localeCompare(b.sent_at))
  const samples = allSamples.slice(0, 250)

  // Step 2: AI analysis
  const transcript = samples.map(m => {
    const sender = m.is_from_me ? 'You' : contactName
    const date = new Date(m.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `[${date}] ${sender}: ${m.body.slice(0, 200)}`
  }).join('\n')

  const system = `You are analyzing a specific iMessage conversation between the user and ${contactName}.
You have ${samples.length} message samples spanning their full conversation history (${totalMsgs} total messages).

The user is asking a specific question about this relationship. Your job is to:
1. ANSWER the question directly and specifically
2. FIND EVIDENCE — identify specific message episodes that answer the question
3. PROVIDE INSIGHT — what patterns do you see?

Return a JSON object:
{
  "answer": "A direct 2-3 sentence answer. Be specific. Reference dates and quotes.",
  "episodes": [
    {
      "title": "Short episode title — Month Year",
      "messages": [
        { "body": "exact message text from the samples", "is_from_me": true, "sent_at": "the date" }
      ],
      "insight": "One sentence about what this episode shows"
    }
  ],
  "evidence": [
    { "label": "Pattern name", "value": "description of a pattern you noticed" }
  ],
  "suggestedFollowUps": ["A follow-up question"]
}

Rules:
- episodes: 2-5 specific episodes with ACTUAL messages from the samples
- Each episode: 2-6 messages forming a coherent exchange
- Only quote messages that appear in the provided samples
- Be warm and observational, not clinical
- If evidence is insufficient, say so honestly
- suggestedFollowUps: 1-3 natural follow-up questions

Return ONLY the JSON object.`

  try {
    const text = await callAnthropic(system, `Question: "${query}"\n\nConversation with ${contactName} (${totalMsgs} total messages, ${samples.length} sampled):\n\n${transcript}`, 2000)
    if (!text) return null
    return JSON.parse(text.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '')) as RelationshipSearchResult
  } catch (err) {
    console.error('[RelationshipSearch] AI failed:', err)
    return null
  }
}
