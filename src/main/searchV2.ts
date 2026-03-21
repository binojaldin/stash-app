/**
 * Search V2 — multi-axis query planning and parallel retrieval.
 *
 * Architecture:
 * 1. parseSearchPlan (AI) → structured search plan
 * 2. executeSearchV2 → parallel retrieval across messages, attachments, conversations
 * 3. Result fusion → scored, sectioned results
 */

import { initDb } from './db'

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
  answerMode: 'results' | 'summary' | 'results+summary' | 'ranking'
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
}

// ── Parallel Retrieval Engine ──

export async function executeSearchV2(
  plan: SearchPlan,
  chatNameMap: Record<string, string>
): Promise<SearchResultV2> {
  const t0 = Date.now()
  const d = initDb()
  const resolve = (raw: string): string => chatNameMap[raw] || raw

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

      console.log(`[SearchV2] Ranking: ${rows.length} contacts (${Date.now() - t0}ms)`)
      return {
        plan,
        sections: {
          messages: [],
          attachments: [],
          conversations: rows.map(r => ({
            chat_name: r.chat_name,
            contact_name: resolve(r.chat_name),
            messageCount: r.msg_count,
            matchingMessages: r.msg_count,
            dateRange: plan.timeRange?.description || 'all time',
            preview: `${r.msg_count.toLocaleString()} messages`
          })),
          summary: null
        },
        totalResults: rows.length,
        searchTimeMs: Date.now() - t0
      }
    } catch (err) { console.error('[SearchV2] Ranking error:', err) }
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

      // B. Semantic expansion (lower priority, fill up to 30)
      if (plan.semanticExpansions.length > 0 && results.length < 20) {
        try {
          const expTerms = plan.semanticExpansions.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ')
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
              ORDER BY a.created_at DESC LIMIT 20
            `).all(ftsTerms, ...params) as typeof attachRows
          } catch {
            // FTS failed, fall back to LIKE on filename
            attachRows = d.prepare(`
              SELECT id, filename, chat_name, created_at, thumbnail_path, is_image, ocr_text
              FROM attachments WHERE ${whereParts.join(' AND ')}
              AND (filename LIKE ? OR ocr_text LIKE ?)
              ORDER BY created_at DESC LIMIT 20
            `).all(...params, `%${allKeywords[0]}%`, `%${allKeywords[0]}%`) as typeof attachRows
          }
        } else {
          attachRows = d.prepare(`
            SELECT id, filename, chat_name, created_at, thumbnail_path, is_image, ocr_text
            FROM attachments WHERE ${whereParts.join(' AND ')}
            ORDER BY created_at DESC LIMIT 20
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

  return {
    plan,
    sections: { messages: messageResults, attachments: attachmentResults, conversations: conversationResults, summary },
    totalResults: messageResults.length + attachmentResults.length + conversationResults.length,
    searchTimeMs: Date.now() - t0
  }
}
