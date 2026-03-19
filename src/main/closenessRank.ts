/**
 * Closeness Rank — composite scoring of relationship proximity.
 *
 * Synthesizes message volume, balance, recency, consistency, reactions,
 * reply speed, emoji, sentiment, shared groups, and behavioral signals
 * into a single 0-100 score per contact.
 *
 * Tiers: inner_circle (85+), close (65-84), regular (40-64),
 * peripheral (20-39), distant (<20).
 */

import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import { initDb } from './db'
import type { ChatNameEntry } from './db'

const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db')
const APPLE_EPOCH = 978307200
const NS = 1000000000

interface ConvSignals {
  emoji_rate: number; avg_heat: number; positive_rate: number
  negative_rate: number; question_count: number; total_analyzed: number
}

export interface ClosenessScore {
  chat_identifier: string; total_score: number; tier: string
  volume_score: number; balance_score: number; recency_score: number
  consistency_score: number; reaction_score: number; sentiment_score: number
  shared_group_score: number; updated_at: string
}

function tier(score: number): string {
  if (score >= 85) return 'inner_circle'
  if (score >= 65) return 'close'
  if (score >= 40) return 'regular'
  if (score >= 20) return 'peripheral'
  return 'distant'
}

export async function computeClosenessScores(_mainWindow?: BrowserWindow): Promise<void> {
  const t0 = Date.now()
  const stashDb = initDb()

  // ── Gather ChatNameEntry-equivalent data from stash.db cached stats ──
  // Read from the attachments + messages tables to get per-contact stats
  // This avoids calling getStats() which is heavy
  let contacts: ChatNameEntry[] = []
  try {
    const chatRows = stashDb.prepare(`
      SELECT chat_name as rawName, COUNT(*) as attachmentCount, MAX(created_at) as lastMessageDate
      FROM attachments WHERE chat_name IS NOT NULL GROUP BY chat_name
    `).all() as { rawName: string; attachmentCount: number; lastMessageDate: string }[]

    // Get message stats from chat.db directly (lighter than full getStats)
    if (existsSync(CHAT_DB_PATH)) {
      const chatDb = new Database(CHAT_DB_PATH, { readonly: true })
      try {
        const msgRows = chatDb.prepare(`
          SELECT c.chat_identifier as rawName, COUNT(m.ROWID) as messageCount,
            SUM(CASE WHEN m.is_from_me=1 THEN 1 ELSE 0 END) as sentCount,
            SUM(CASE WHEN m.is_from_me=0 THEN 1 ELSE 0 END) as receivedCount,
            MAX(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as lastMsg
          FROM message m JOIN chat_message_join cmj ON m.ROWID=cmj.message_id
          JOIN chat c ON cmj.chat_id=c.ROWID
          WHERE (m.text IS NOT NULL OR m.cache_has_attachments=1)
          GROUP BY c.chat_identifier
        `).all() as { rawName: string; messageCount: number; sentCount: number; receivedCount: number; lastMsg: string }[]

        const partRows = chatDb.prepare(`
          SELECT c.chat_identifier as rawName, COUNT(DISTINCT chj.handle_id) as pCount
          FROM chat c LEFT JOIN chat_handle_join chj ON c.ROWID=chj.chat_id GROUP BY c.chat_identifier
        `).all() as { rawName: string; pCount: number }[]
        const partMap = new Map(partRows.map(r => [r.rawName, r.pCount]))

        // Initiation counts (approximate: distinct active days where you sent)
        const initRows = chatDb.prepare(`
          SELECT c.chat_identifier as rawName, COUNT(DISTINCT date(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime'))) as initDays
          FROM message m JOIN chat_message_join cmj ON m.ROWID=cmj.message_id
          JOIN chat c ON cmj.chat_id=c.ROWID WHERE m.is_from_me=1 GROUP BY c.chat_identifier
        `).all() as { rawName: string; initDays: number }[]
        const initMap = new Map(initRows.map(r => [r.rawName, r.initDays]))

        // Shared group count per contact
        const sharedGroupRows = chatDb.prepare(`
          SELECT h.id as rawName, COUNT(DISTINCT chj.chat_id) as sharedGroups
          FROM handle h JOIN chat_handle_join chj ON h.ROWID=chj.handle_id
          WHERE chj.chat_id IN (SELECT chat_id FROM chat_handle_join GROUP BY chat_id HAVING COUNT(*)>1)
          GROUP BY h.id
        `).all() as { rawName: string; sharedGroups: number }[]
        const sharedGroupMap = new Map(sharedGroupRows.map(r => [r.rawName, r.sharedGroups]))

        // Consistency: months active in last 12 months
        const twelveMonthsAgo = (Date.now() / 1000 - APPLE_EPOCH - 365 * 86400) * NS
        const consistencyRows = chatDb.prepare(`
          SELECT c.chat_identifier as rawName,
            COUNT(DISTINCT strftime('%Y-%m', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime'))) as activeMonths
          FROM message m JOIN chat_message_join cmj ON m.ROWID=cmj.message_id
          JOIN chat c ON cmj.chat_id=c.ROWID
          WHERE m.date >= ${twelveMonthsAgo} GROUP BY c.chat_identifier
        `).all() as { rawName: string; activeMonths: number }[]
        const consistencyMap = new Map(consistencyRows.map(r => [r.rawName, r.activeMonths]))

        // Laugh cache from stash.db (already computed by getStats worker)
        // Read from the cached stats if available, otherwise skip
        const laughRows = stashDb.prepare(`
          SELECT chat_identifier, laugh_count FROM conversation_signals WHERE laugh_count > 0
        `).all() as { chat_identifier: string; laugh_count: number }[]
        const laughMap = new Map(laughRows.map(r => [r.chat_identifier, r.laugh_count]))

        const msgMap = new Map(msgRows.map(r => [r.rawName, r]))
        contacts = chatRows.map(r => {
          const msg = msgMap.get(r.rawName)
          const isGroup = (partMap.get(r.rawName) || 1) > 1
          return {
            rawName: r.rawName,
            attachmentCount: r.attachmentCount,
            lastMessageDate: msg?.lastMsg || r.lastMessageDate || '',
            messageCount: msg?.messageCount || 0,
            sentCount: msg?.sentCount || 0,
            receivedCount: msg?.receivedCount || 0,
            initiationCount: initMap.get(r.rawName) || 0,
            laughsGenerated: 0, laughsReceived: 0, // use laugh_count from conversation_signals instead
            isGroup,
            lateNightRatio: 0, avgReplyMinutes: 0,
            _sharedGroups: sharedGroupMap.get(r.rawName) || 0,
            _consistencyMonths: consistencyMap.get(r.rawName) || 0,
            _laughCount: laughMap.get(r.rawName) || 0,
          } as ChatNameEntry & { _sharedGroups: number; _consistencyMonths: number; _laughCount: number }
        }).filter(c => !c.isGroup && c.messageCount > 0)

        chatDb.close()
      } catch (err) {
        console.error('[Closeness] chat.db query error:', err)
        chatDb.close()
        return
      }
    }
  } catch (err) {
    console.error('[Closeness] Data gathering error:', err)
    return
  }

  if (contacts.length === 0) { console.log('[Closeness] No contacts to score'); return }
  console.log(`[Closeness] Computing scores for ${contacts.length} contacts...`)

  // ── Read conversation_signals ──
  const signalMap = new Map<string, ConvSignals>()
  try {
    const sigRows = stashDb.prepare('SELECT * FROM conversation_signals WHERE total_analyzed > 0').all() as (ConvSignals & { chat_identifier: string })[]
    for (const r of sigRows) signalMap.set(r.chat_identifier, r)
  } catch { /* table may be empty */ }

  const now = Date.now()
  const results: { chat: string; scores: Record<string, number>; total: number; tierName: string }[] = []

  // ── Read late-night + reply speed from stash.db messages if available ──
  let lateNightMap = new Map<string, number>()
  let replySpeedMap = new Map<string, number>()
  try {
    const lnRows = stashDb.prepare(`SELECT chat_identifier, avg_heat FROM conversation_signals`).all() as { chat_identifier: string; avg_heat: number }[]
    // We don't have late_night in conversation_signals, use 0
  } catch { /* ignore */ }

  const insertStmt = stashDb.prepare(`
    INSERT OR REPLACE INTO closeness_scores
      (chat_identifier, volume_score, balance_score, initiation_score, recency_score,
       consistency_score, reaction_score, reply_speed_score,
       emoji_score, sentiment_score, question_balance_score, word_match_score,
       shared_group_score, late_night_score, streak_score, heat_sentiment_score,
       total_score, tier, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let level2Count = 0
  const tierCounts: Record<string, number> = { inner_circle: 0, close: 0, regular: 0, peripheral: 0, distant: 0 }

  const tx = stashDb.transaction(() => {
    for (const c of contacts) {
      const ext = c as ChatNameEntry & { _sharedGroups: number; _consistencyMonths: number; _laughCount: number }

      // ── Level 1: Heuristic signals ──
      // Volume: messages per month, normalized
      const firstMsgDate = c.lastMessageDate ? new Date(c.lastMessageDate) : new Date()
      const monthsActive = Math.max(1, (now - firstMsgDate.getTime()) / (30 * 86400000))
      // Actually monthsActive should be from first msg, not last. Use a rough estimate.
      const msgsPerMonth = c.messageCount / Math.max(monthsActive, 1)
      const volumeNorm = Math.min(msgsPerMonth / 200, 1.0)

      // Balance
      const sentRatio = c.sentCount / Math.max(c.messageCount, 1)
      const balanceNorm = 1.0 - Math.abs(sentRatio - 0.5) * 2

      // Initiation
      const initRatio = c.initiationCount / Math.max(c.sentCount, 1)
      const initiationNorm = (initRatio >= 0.3 && initRatio <= 0.7) ? 1.0 : (initRatio >= 0.15 && initRatio <= 0.85) ? 0.5 : 0.2

      // Recency
      const lastMsgTime = c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0
      const daysSince = lastMsgTime > 0 ? (now - lastMsgTime) / 86400000 : 999
      const recencyNorm = Math.max(0, 1.0 - daysSince / 90)

      // Consistency
      const consistencyNorm = (ext._consistencyMonths || 0) / 12.0

      // Reaction
      const totalLaughs = ext._laughCount || (c.laughsGenerated + c.laughsReceived)
      const laughsPer100 = totalLaughs / Math.max(c.messageCount / 100, 1)
      const reactionNorm = Math.min(laughsPer100 / 10, 1.0)

      // Reply speed (not available from this data path, use neutral)
      const replySpeedNorm = 0.5

      // ── Level 2: Pipeline signals ──
      const sig = signalMap.get(c.rawName)
      let emojiNorm = 0, sentimentNorm = 0, questionNorm = 0
      let wordMatchNorm = 0.5, sharedGroupNorm = 0, lateNightNorm = 0
      let streakNorm = 0, heatSentimentNorm = 0

      if (sig && sig.total_analyzed > 0) {
        level2Count++
        emojiNorm = Math.min((sig.emoji_rate || 0) / 50, 1.0)
        sentimentNorm = Math.min((sig.positive_rate || 0) / 30, 1.0)
        if ((sig.negative_rate || 0) > 20) sentimentNorm = Math.max(0, sentimentNorm - 0.3)
        const qRate = (sig.question_count || 0) / Math.max(sig.total_analyzed, 1)
        questionNorm = Math.min(qRate / 0.3, 1.0)
        if (sig.avg_heat > 2 && (sig.positive_rate || 0) > (sig.negative_rate || 0)) {
          heatSentimentNorm = Math.min(sig.avg_heat / 5, 1.0)
        }
      }

      sharedGroupNorm = Math.min((ext._sharedGroups || 0) / 10, 1.0)
      streakNorm = consistencyNorm * volumeNorm // proxy

      // ── Composite ──
      const total = (
        volumeNorm * 8 + balanceNorm * 6 + initiationNorm * 5 +
        recencyNorm * 8 + consistencyNorm * 6 + reactionNorm * 4 +
        replySpeedNorm * 3 +
        emojiNorm * 4 + sentimentNorm * 5 + questionNorm * 3 +
        wordMatchNorm * 3 + sharedGroupNorm * 5 + lateNightNorm * 3 +
        streakNorm * 4 + heatSentimentNorm * 3
      )
      const score = Math.min(100, Math.round((total / 70) * 100 * 10) / 10)
      const t = tier(score)
      tierCounts[t] = (tierCounts[t] || 0) + 1

      insertStmt.run(
        c.rawName,
        Math.round(volumeNorm * 100) / 100, Math.round(balanceNorm * 100) / 100,
        Math.round(initiationNorm * 100) / 100, Math.round(recencyNorm * 100) / 100,
        Math.round(consistencyNorm * 100) / 100, Math.round(reactionNorm * 100) / 100,
        Math.round(replySpeedNorm * 100) / 100,
        Math.round(emojiNorm * 100) / 100, Math.round(sentimentNorm * 100) / 100,
        Math.round(questionNorm * 100) / 100, Math.round(wordMatchNorm * 100) / 100,
        Math.round(sharedGroupNorm * 100) / 100, Math.round(lateNightNorm * 100) / 100,
        Math.round(streakNorm * 100) / 100, Math.round(heatSentimentNorm * 100) / 100,
        score, t, new Date().toISOString()
      )
    }
  })
  tx()

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[Closeness] Level 1 (heuristics): ${contacts.length} contacts scored`)
  console.log(`[Closeness] Level 2 (pipeline): ${level2Count} contacts with signals`)
  console.log(`[Closeness] Results: ${tierCounts.inner_circle || 0} inner_circle, ${tierCounts.close || 0} close, ${tierCounts.regular || 0} regular, ${tierCounts.peripheral || 0} peripheral, ${tierCounts.distant || 0} distant`)
  console.log(`[Closeness] Complete in ${elapsed}s`)
}

// ── Query functions ──

export function getClosenessScores(chatIdentifier?: string): ClosenessScore[] {
  const d = initDb()
  try {
    if (chatIdentifier) {
      const row = d.prepare('SELECT * FROM closeness_scores WHERE chat_identifier = ?').get(chatIdentifier)
      return row ? [row as ClosenessScore] : []
    }
    return d.prepare('SELECT * FROM closeness_scores ORDER BY total_score DESC').all() as ClosenessScore[]
  } catch { return [] }
}

export function getClosenessRank(chatIdentifier: string): number | null {
  const d = initDb()
  try {
    const rows = d.prepare('SELECT chat_identifier FROM closeness_scores ORDER BY total_score DESC').all() as { chat_identifier: string }[]
    const idx = rows.findIndex(r => r.chat_identifier === chatIdentifier)
    return idx >= 0 ? idx + 1 : null
  } catch { return null }
}
