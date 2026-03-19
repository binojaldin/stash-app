/**
 * Message Analysis Pipeline — background heuristic classifiers.
 *
 * Processes messages from chat.db in batches, computes per-message signals
 * (laugh, question, link, emoji, heat, sentiment), stores in stash.db.
 * Runs incrementally from last_processed_rowid. Never blocks the UI.
 *
 * Phase 1: local heuristic classifiers only.
 * Phase 2 (future): Claude API classifiers plug into the same pipeline.
 */

import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import { initDb } from './db'

const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db')
const BATCH_SIZE = 500
const AGGREGATE_INTERVAL = 5000 // recompute aggregates every N messages
const ANALYSIS_VERSION = 1

// ── Heuristic classifiers ──

interface MessageSignals {
  has_laugh: number
  has_question: number
  has_link: number
  has_emoji: number
  exclamation_count: number
  is_all_caps: number
  word_count: number
  char_count: number
  heat_score: number
  sentiment: number
}

const LAUGH_RE = /\b(lol|lmao|lmfao|rofl|hehe|omg dead|im dead|i'm dead|dying|i'm dying|im dying)\b|ha{2,}|he{2,}/i
const LAUGH_EMOJI = /[\u{1F602}\u{1F923}\u{1F480}\u{2620}]/u
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/u
const POS_RE = /\b(love|great|amazing|awesome|perfect|beautiful|wonderful|fantastic|excellent|happy|glad|excited|thank|thanks|thx|appreciate|congrats|proud|best|incredible|brilliant)\b|[❤️💕😍🥰😊🎉✨👏💪🙌]/u
const NEG_RE = /\b(hate|awful|terrible|horrible|worst|angry|furious|upset|disappointed|annoyed|frustrated|disgusted|miserable|pathetic|stupid|dumb|wtf|pissed|sick of|tired of)\b|[😡😤😢😭💔😠]/u

function analyzeMessage(text: string): MessageSignals {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0)
  const wordCount = words.length
  const charCount = text.length

  const hasLaugh = LAUGH_RE.test(text) || LAUGH_EMOJI.test(text) ? 1 : 0
  const hasQuestion = text.includes('?') ? 1 : 0
  const hasLink = /https?:\/\//.test(text) ? 1 : 0
  const hasEmoji = EMOJI_RE.test(text) ? 1 : 0
  const exclamationCount = (text.match(/!/g) || []).length
  const alphaOnly = text.replace(/[^a-zA-Z]/g, '')
  const isAllCaps = alphaOnly.length >= 4 && alphaOnly === alphaOnly.toUpperCase() ? 1 : 0

  // Heat score (0-10)
  let heat = 0
  if (isAllCaps) heat += 3
  if (exclamationCount >= 3) heat += 2
  else if (exclamationCount >= 1) heat += 1
  if (hasLaugh) heat += 1
  if (hasEmoji) heat += 1
  if (wordCount <= 3 && (exclamationCount > 0 || isAllCaps)) heat += 2
  heat = Math.min(heat, 10)

  // Sentiment (-1, 0, 1)
  let sentiment = 0
  if (POS_RE.test(text)) sentiment += 1
  if (NEG_RE.test(text)) sentiment -= 1
  sentiment = Math.max(-1, Math.min(1, sentiment))

  return { has_laugh: hasLaugh, has_question: hasQuestion, has_link: hasLink, has_emoji: hasEmoji, exclamation_count: exclamationCount, is_all_caps: isAllCaps, word_count: wordCount, char_count: charCount, heat_score: heat, sentiment }
}

// ── Pipeline state ──

let isRunning = false

function yieldEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

// ── Main entry point ──

export async function runMessageAnalysis(mainWindow?: BrowserWindow): Promise<void> {
  if (isRunning) { console.log('[MessageAnalysis] Already running, skipping'); return }
  if (!existsSync(CHAT_DB_PATH)) { console.log('[MessageAnalysis] No chat.db found'); return }

  isRunning = true
  const t0 = Date.now()

  try {
    const stashDb = initDb()
    const chatDb = new Database(CHAT_DB_PATH, { readonly: true })
    const APPLE_EPOCH = 978307200
    const NS = 1000000000

    // Get total message count for progress
    const totalRow = chatDb.prepare(`SELECT COUNT(*) as c FROM message WHERE text IS NOT NULL AND associated_message_type = 0`).get() as { c: number }
    const totalMessages = totalRow.c

    // Get resume point
    const progressRow = stashDb.prepare(`SELECT value FROM message_analysis_progress WHERE key = 'last_processed_rowid'`).get() as { value: string } | undefined
    let lastRowid = progressRow ? parseInt(progressRow.value) : 0

    // Check version — if changed, reprocess everything
    const versionRow = stashDb.prepare(`SELECT value FROM message_analysis_progress WHERE key = 'analysis_version'`).get() as { value: string } | undefined
    if (versionRow && parseInt(versionRow.value) !== ANALYSIS_VERSION) {
      console.log(`[MessageAnalysis] Version changed (${versionRow.value} → ${ANALYSIS_VERSION}), reprocessing all`)
      stashDb.exec('DELETE FROM message_signals')
      stashDb.exec('DELETE FROM conversation_signals')
      lastRowid = 0
    }

    const analyzedBefore = (stashDb.prepare('SELECT COUNT(*) as c FROM message_signals').get() as { c: number }).c
    console.log(`[MessageAnalysis] Starting analysis... (last ROWID: ${lastRowid}, ${analyzedBefore} already analyzed, ${totalMessages} total)`)

    if (analyzedBefore >= totalMessages && lastRowid > 0) {
      console.log('[MessageAnalysis] All messages already analyzed')
      isRunning = false
      return
    }

    // Prepare statements
    const fetchStmt = chatDb.prepare(`
      SELECT m.ROWID as message_id, c.chat_identifier, m.is_from_me, m.text,
             datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime') as sent_at
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.ROWID > ? AND m.text IS NOT NULL AND m.associated_message_type = 0
      ORDER BY m.ROWID ASC LIMIT ${BATCH_SIZE}
    `)

    const insertStmt = stashDb.prepare(`
      INSERT OR IGNORE INTO message_signals
        (message_id, chat_identifier, is_from_me, sent_at,
         has_laugh, has_question, has_link, has_emoji,
         exclamation_count, is_all_caps, word_count, char_count,
         heat_score, sentiment, analyzed_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const updateProgressStmt = stashDb.prepare(`INSERT OR REPLACE INTO message_analysis_progress (key, value) VALUES (?, ?)`)

    let processed = 0
    let batchNum = 0

    while (true) {
      const rows = fetchStmt.all(lastRowid) as { message_id: number; chat_identifier: string; is_from_me: number; text: string; sent_at: string }[]
      if (rows.length === 0) break

      batchNum++
      // Batch insert in a transaction
      const insertBatch = stashDb.transaction(() => {
        for (const row of rows) {
          const sig = analyzeMessage(row.text)
          insertStmt.run(
            row.message_id, row.chat_identifier, row.is_from_me, row.sent_at,
            sig.has_laugh, sig.has_question, sig.has_link, sig.has_emoji,
            sig.exclamation_count, sig.is_all_caps, sig.word_count, sig.char_count,
            sig.heat_score, sig.sentiment, ANALYSIS_VERSION
          )
        }
      })
      insertBatch()

      lastRowid = rows[rows.length - 1].message_id
      processed += rows.length

      // Update progress
      updateProgressStmt.run('last_processed_rowid', String(lastRowid))
      updateProgressStmt.run('analysis_version', String(ANALYSIS_VERSION))
      updateProgressStmt.run('last_run_at', new Date().toISOString())

      if (batchNum % 10 === 0) {
        console.log(`[MessageAnalysis] Batch ${batchNum}: processed ${processed} messages (${analyzedBefore + processed}/${totalMessages})`)
      }

      // Send progress to renderer
      try {
        mainWindow?.webContents.send('analysis-progress', { analyzed: analyzedBefore + processed, total: totalMessages })
      } catch { /* window may be closed */ }

      // Yield event loop between batches
      await yieldEventLoop()

      // Recompute aggregates periodically
      if (processed % AGGREGATE_INTERVAL === 0) {
        computeConversationAggregates(stashDb)
      }
    }

    // Final aggregate computation
    if (processed > 0) {
      computeConversationAggregates(stashDb)
    }

    chatDb.close()

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`[MessageAnalysis] Complete: ${processed} new messages analyzed in ${elapsed}s (${analyzedBefore + processed} total)`)

    // Send final progress
    try {
      mainWindow?.webContents.send('analysis-progress', { analyzed: analyzedBefore + processed, total: totalMessages })
    } catch { /* ignore */ }

  } catch (err) {
    console.error('[MessageAnalysis] Error:', err)
  } finally {
    isRunning = false
  }
}

function computeConversationAggregates(stashDb: Database.Database): void {
  const t0 = Date.now()
  stashDb.exec(`
    INSERT OR REPLACE INTO conversation_signals
      (chat_identifier, total_analyzed, laugh_count, question_count,
       link_count, emoji_rate, avg_word_count, avg_heat,
       positive_rate, negative_rate, all_caps_rate, updated_at)
    SELECT
      chat_identifier,
      COUNT(*) as total_analyzed,
      SUM(has_laugh) as laugh_count,
      SUM(has_question) as question_count,
      SUM(has_link) as link_count,
      ROUND(AVG(has_emoji) * 100, 1) as emoji_rate,
      ROUND(AVG(word_count), 1) as avg_word_count,
      ROUND(AVG(heat_score), 2) as avg_heat,
      ROUND(AVG(CASE WHEN sentiment = 1 THEN 1.0 ELSE 0.0 END) * 100, 1) as positive_rate,
      ROUND(AVG(CASE WHEN sentiment = -1 THEN 1.0 ELSE 0.0 END) * 100, 1) as negative_rate,
      ROUND(AVG(is_all_caps) * 100, 1) as all_caps_rate,
      datetime('now')
    FROM message_signals
    GROUP BY chat_identifier
  `)
  const count = (stashDb.prepare('SELECT COUNT(*) as c FROM conversation_signals').get() as { c: number }).c
  console.log(`[MessageAnalysis] Conversation aggregates updated: ${count} conversations (${Date.now() - t0}ms)`)
}

// ── Query functions ──

export function getConversationSignals(chatIdentifier?: string): {
  chat_identifier: string; total_analyzed: number; laugh_count: number
  question_count: number; link_count: number; emoji_rate: number
  avg_word_count: number; avg_heat: number; positive_rate: number
  negative_rate: number; all_caps_rate: number; updated_at: string
}[] {
  const d = initDb()
  if (chatIdentifier) {
    const row = d.prepare('SELECT * FROM conversation_signals WHERE chat_identifier = ?').get(chatIdentifier) as unknown
    return row ? [row as ReturnType<typeof getConversationSignals>[0]] : []
  }
  return d.prepare('SELECT * FROM conversation_signals ORDER BY total_analyzed DESC').all() as ReturnType<typeof getConversationSignals>
}

export function getAnalysisProgress(): {
  totalMessages: number; analyzedMessages: number; lastRunAt: string | null; isRunning: boolean
} {
  const d = initDb()
  const analyzed = (d.prepare('SELECT COUNT(*) as c FROM message_signals').get() as { c: number }).c
  const lastRunRow = d.prepare("SELECT value FROM message_analysis_progress WHERE key = 'last_run_at'").get() as { value: string } | undefined

  let totalMessages = 0
  try {
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (existsSync(chatDbPath)) {
      const chatDb = new Database(chatDbPath, { readonly: true })
      totalMessages = (chatDb.prepare('SELECT COUNT(*) as c FROM message WHERE text IS NOT NULL AND associated_message_type = 0').get() as { c: number }).c
      chatDb.close()
    }
  } catch { /* ignore */ }

  return {
    totalMessages,
    analyzedMessages: analyzed,
    lastRunAt: lastRunRow?.value || null,
    isRunning
  }
}
