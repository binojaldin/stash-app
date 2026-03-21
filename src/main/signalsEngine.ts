/**
 * Signals Engine — rolling averages + delta detection per relationship.
 * Computes 5 signals (volume, initiation, response_time, sentiment, heat)
 * across 3 periods (7d, 30d, 90d) for each contact.
 */

import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import { initDb } from './db'

const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db')
const APPLE_EPOCH = 978307200
const NS = 1000000000

export interface RelationshipSignal {
  chat_identifier: string; signal_type: string; period: string
  current_value: number; baseline_value: number; delta_pct: number
  is_significant: boolean; direction: 'up' | 'down' | 'stable'
}

export interface SignalAlert {
  chat_identifier: string; signal_type: string; message: string
  severity: 'info' | 'notable' | 'significant'; delta_pct: number
}

const THRESHOLDS: Record<string, { notable: number; significant: number }> = {
  volume: { notable: 20, significant: 40 },
  initiation: { notable: 15, significant: 30 },
  response_time: { notable: 25, significant: 50 },
  sentiment: { notable: 10, significant: 25 },
  heat: { notable: 20, significant: 40 },
}

const PERIODS = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
]

export async function computeSignals(): Promise<void> {
  const t0 = Date.now()
  const stashDb = initDb()

  // Skip if unchanged
  try {
    const currentCount = (stashDb.prepare('SELECT COUNT(*) as c FROM message_signals').get() as { c: number }).c
    const meta = stashDb.prepare("SELECT value FROM _meta WHERE key = 'signals_msg_count'").get() as { value: string } | undefined
    if (meta && parseInt(meta.value) === currentCount) { console.log('[Signals] Skipping — no new analyzed messages'); return }
  } catch {}

  // Get contacts with 100+ analyzed messages
  const contacts = stashDb.prepare(`SELECT chat_identifier, total_analyzed FROM conversation_signals WHERE total_analyzed >= 100`).all() as { chat_identifier: string; total_analyzed: number }[]
  if (contacts.length === 0) { console.log('[Signals] No contacts with 100+ analyzed messages'); return }

  console.log(`[Signals] Computing signals for ${contacts.length} contacts...`)
  const now = new Date()
  const insertStmt = stashDb.prepare(`INSERT OR REPLACE INTO relationship_signals (chat_identifier, signal_type, period, current_value, baseline_value, delta_pct, is_significant, direction, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  let sigCount = 0, notableCount = 0, significantCount = 0

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10)

  const tx = stashDb.transaction(() => {
    for (const contact of contacts) {
      const ci = contact.chat_identifier

      // Skip dead contacts — no messages in last 90 days
      try {
        const recent = (stashDb.prepare(`SELECT COUNT(*) as cnt FROM message_signals WHERE chat_identifier = ? AND sent_at >= ?`).get(ci, ninetyDaysAgo) as { cnt: number }).cnt
        if (recent === 0) continue
      } catch { continue }

      for (const period of PERIODS) {
        const cutoff = new Date(now.getTime() - period.days * 86400000).toISOString().slice(0, 10)
        const allTimeCutoff = new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10) // baseline = last year

        // 1. VOLUME: messages per day
        try {
          const current = (stashDb.prepare(`SELECT COUNT(*) as cnt FROM message_signals WHERE chat_identifier = ? AND sent_at >= ?`).get(ci, cutoff) as { cnt: number }).cnt / period.days
          const baselineRow = stashDb.prepare(`SELECT COUNT(*) as cnt FROM message_signals WHERE chat_identifier = ? AND sent_at < ? AND sent_at >= ?`).get(ci, cutoff, allTimeCutoff) as { cnt: number }
          const baselineDays = Math.max(1, (new Date(cutoff).getTime() - new Date(allTimeCutoff).getTime()) / 86400000)
          const baseline = baselineRow.cnt / baselineDays
          emitSignal(insertStmt, ci, 'volume', period.key, current, baseline, now)
        } catch {}

        // 4. SENTIMENT: positive message rate
        try {
          const cur = stashDb.prepare(`SELECT SUM(CASE WHEN sentiment > 0 THEN 1 ELSE 0 END) * 100.0 / MAX(COUNT(*), 1) as rate FROM message_signals WHERE chat_identifier = ? AND sent_at >= ?`).get(ci, cutoff) as { rate: number }
          const base = stashDb.prepare(`SELECT SUM(CASE WHEN sentiment > 0 THEN 1 ELSE 0 END) * 100.0 / MAX(COUNT(*), 1) as rate FROM message_signals WHERE chat_identifier = ? AND sent_at < ?`).get(ci, cutoff) as { rate: number }
          emitSignal(insertStmt, ci, 'sentiment', period.key, cur?.rate || 0, base?.rate || 0, now)
        } catch {}

        // 5. HEAT: average heat score
        try {
          const cur = (stashDb.prepare(`SELECT AVG(heat_score) as avg FROM message_signals WHERE chat_identifier = ? AND sent_at >= ?`).get(ci, cutoff) as { avg: number })?.avg || 0
          const base = (stashDb.prepare(`SELECT AVG(heat_score) as avg FROM message_signals WHERE chat_identifier = ? AND sent_at < ?`).get(ci, cutoff) as { avg: number })?.avg || 0
          emitSignal(insertStmt, ci, 'heat', period.key, cur, base, now)
        } catch {}

        sigCount += 3 // volume + sentiment + heat per period
      }
    }
  })
  tx()

  // Count results
  try {
    significantCount = (stashDb.prepare(`SELECT COUNT(*) as cnt FROM relationship_signals WHERE is_significant = 1`).get() as { cnt: number }).cnt
    notableCount = (stashDb.prepare(`SELECT COUNT(*) as cnt FROM relationship_signals WHERE is_significant = 0 AND direction != 'stable'`).get() as { cnt: number }).cnt
  } catch {}

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[Signals] Complete: ${significantCount} significant, ${notableCount} notable, rest stable (${elapsed}s)`)
  try { stashDb.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('signals_msg_count', ?)").run(String((stashDb.prepare('SELECT COUNT(*) as c FROM message_signals').get() as { c: number }).c)) } catch {}
}

function emitSignal(stmt: Database.Statement, ci: string, type: string, period: string, current: number, baseline: number, now: Date): void {
  if (baseline < 0.01 && current < 0.01) return // both near zero, not interesting
  let delta = baseline > 0.01 ? ((current - baseline) / baseline) * 100 : 0
  delta = Math.max(-200, Math.min(200, delta)) // cap at ±200%
  const thresh = THRESHOLDS[type] || { notable: 20, significant: 40 }
  const absDelta = Math.abs(delta)
  const isSignificant = absDelta >= thresh.significant ? 1 : 0
  const direction = absDelta >= thresh.notable ? (delta > 0 ? 'up' : 'down') : 'stable'
  stmt.run(ci, type, period, Math.round(current * 100) / 100, Math.round(baseline * 100) / 100, Math.round(delta * 10) / 10, isSignificant, direction, now.toISOString())
}

export function getSignals(chatIdentifier?: string): RelationshipSignal[] {
  const d = initDb()
  try {
    const filter = chatIdentifier ? ' WHERE chat_identifier = ?' : ''
    const params = chatIdentifier ? [chatIdentifier] : []
    return (d.prepare(`SELECT * FROM relationship_signals${filter} ORDER BY ABS(delta_pct) DESC`).all(...params) as (RelationshipSignal & { is_significant: number })[]).map(r => ({ ...r, is_significant: r.is_significant === 1 }))
  } catch { return [] }
}

export function getActiveAlerts(): SignalAlert[] {
  const d = initDb()
  try {
    const rows = d.prepare(`SELECT * FROM relationship_signals WHERE direction != 'stable' AND period = '30d' ORDER BY ABS(delta_pct) DESC LIMIT 20`).all() as { chat_identifier: string; signal_type: string; delta_pct: number; is_significant: number; direction: string }[]

    const alerts: SignalAlert[] = []
    for (const r of rows) {
      let name = r.chat_identifier
      try { const nr = d.prepare('SELECT resolved_name FROM resolved_names WHERE chat_identifier = ?').get(r.chat_identifier) as { resolved_name: string } | undefined; if (nr) name = nr.resolved_name } catch {}
      // Skip unresolvable contacts — showing raw IDs is worse than nothing
      if (name === r.chat_identifier || name.startsWith('+') || /^[a-f0-9]{8,}/i.test(name)) continue

      const d_abs = Math.abs(Math.round(r.delta_pct))
      const key = `${r.signal_type}_${r.direction}`
      const templates: Record<string, string> = {
        'volume_up': `You and ${name} are talking ${d_abs}% more than usual`,
        'volume_down': `${name} has gone quiet \u2014 ${d_abs}% less than your 30d average`,
        'initiation_up': `You've been starting ${d_abs}% more conversations with ${name}`,
        'initiation_down': `${name} has been reaching out ${d_abs}% less`,
        'response_time_up': `${name} is replying ${d_abs}% slower lately`,
        'response_time_down': `${name} is replying ${d_abs}% faster \u2014 you've got their attention`,
        'sentiment_down': `Conversations with ${name} have been ${d_abs}% less positive`,
        'sentiment_up': `Conversations with ${name} are ${d_abs}% more positive lately`,
        'heat_up': `Things with ${name} have been ${d_abs}% more intense`,
        'heat_down': `Things with ${name} have cooled ${d_abs}%`,
      }
      const message = templates[key] || `${name}: ${r.signal_type} ${r.direction} ${d_abs}%`
      const severity = r.is_significant ? 'significant' : 'notable'
      alerts.push({ chat_identifier: r.chat_identifier, signal_type: r.signal_type, message, severity, delta_pct: r.delta_pct })
    }
    const result = alerts.slice(0, 10)
    console.log(`[Signals] Returning ${result.length} alerts, all with resolved names`)
    return result
  } catch { return [] }
}
