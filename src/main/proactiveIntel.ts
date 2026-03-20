/**
 * Proactive Intelligence — detect commitments, plans, events, follow-ups
 * from message text using Claude API. Stores actionable items for the user.
 */

import { initDb } from './db'
import { detectProactiveItems } from './ai'

export interface ProactiveItem {
  id: number; chat_identifier: string; item_type: string; description: string
  source_message: string; due_date: string | null; status: string; priority: number
  contact_name: string
}

export async function scanForProactiveItems(): Promise<void> {
  const t0 = Date.now()
  const d = initDb()

  const contacts = d.prepare(`
    SELECT chat_identifier, COUNT(*) as cnt FROM message_signals
    WHERE sent_at >= date('now', '-14 days') GROUP BY chat_identifier
    HAVING cnt >= 5 ORDER BY cnt DESC LIMIT 20
  `).all() as { chat_identifier: string; cnt: number }[]

  const nameMap = new Map<string, string>()
  try { for (const r of d.prepare('SELECT chat_identifier, resolved_name FROM resolved_names').all() as { chat_identifier: string; resolved_name: string }[]) nameMap.set(r.chat_identifier, r.resolved_name) } catch {}

  const insertStmt = d.prepare(`INSERT INTO proactive_items (chat_identifier, item_type, description, source_message, detected_at, due_date, status, priority) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)

  let detected = 0
  for (const contact of contacts) {
    const name = nameMap.get(contact.chat_identifier) || contact.chat_identifier
    if (name.startsWith('+') || /^[a-f0-9]{8,}/i.test(name) || /^chat\d+/.test(name)) continue

    const messages = d.prepare(`SELECT body, is_from_me, sent_at FROM messages WHERE chat_name = ? AND body IS NOT NULL AND length(body) > 5 ORDER BY apple_date DESC LIMIT 30`).all(contact.chat_identifier) as { body: string; is_from_me: number; sent_at: string }[]
    if (messages.length < 5) continue

    try {
      const result = await detectProactiveItems(contact.chat_identifier, name, messages)
      if (result && result.items.length > 0) {
        for (const item of result.items) {
          const existing = d.prepare(`SELECT id FROM proactive_items WHERE chat_identifier = ? AND description = ? AND status = 'active'`).get(contact.chat_identifier, item.description)
          if (existing) continue
          let priority = 0
          if (item.dueDate) {
            const daysUntil = (new Date(item.dueDate).getTime() - Date.now()) / 86400000
            if (daysUntil < 0) priority = 1
            if (daysUntil <= 1 && daysUntil >= 0) priority = 2
          }
          insertStmt.run(contact.chat_identifier, item.type, item.description, item.sourceMessage || '', new Date().toISOString(), item.dueDate || null, priority)
          detected++
        }
      }
    } catch (err) { console.error(`[Proactive] Error scanning ${name}:`, err) }
  }
  console.log(`[Proactive] Scan complete: ${detected} new items from ${contacts.length} contacts (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
}

export function getProactiveItems(): { items: ProactiveItem[] } {
  const d = initDb()
  try {
    const rows = d.prepare(`SELECT p.id, p.chat_identifier, p.item_type, p.description, p.source_message, p.due_date, p.status, p.priority, COALESCE(r.resolved_name, p.chat_identifier) as contact_name FROM proactive_items p LEFT JOIN resolved_names r ON p.chat_identifier = r.chat_identifier WHERE p.status = 'active' ORDER BY p.priority DESC, p.detected_at DESC LIMIT 15`).all() as ProactiveItem[]
    return { items: rows }
  } catch { return { items: [] } }
}

export function dismissProactiveItem(id: number): void {
  initDb().prepare("UPDATE proactive_items SET status = 'dismissed' WHERE id = ?").run(id)
}

export function completeProactiveItem(id: number): void {
  initDb().prepare("UPDATE proactive_items SET status = 'done' WHERE id = ?").run(id)
}
