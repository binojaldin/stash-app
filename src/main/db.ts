import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

let db: Database.Database | null = null
let laughCacheValid = false
const laughCache = new Map<string, { generated: number; received: number }>()
let lateNightCacheValid = false
const lateNightCache = new Map<string, number>()
let replyLatencyCacheValid = false
const replyLatencyCache = new Map<string, number>()

export interface StashAttachment {
  id?: number
  filename: string
  original_path: string
  stash_path: string | null
  file_size: number
  mime_type: string | null
  created_at: string
  chat_name: string | null
  sender_handle: string | null
  thumbnail_path: string | null
  file_extension: string | null
  is_image: number
  is_video: number
  is_document: number
  ocr_text: string | null
  metadata_only?: number
  is_available?: number
  source?: string
}

export function getDbPath(): string {
  const dir = join(app.getPath('appData'), 'Stash')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'stash.db')
}

export function getThumbnailDir(): string {
  const dir = join(app.getPath('appData'), 'Stash', 'thumbnails')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function initDb(): Database.Database {
  if (db) return db
  db = new Database(getDbPath())

  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_path TEXT NOT NULL UNIQUE,
      stash_path TEXT,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT,
      created_at TEXT,
      chat_name TEXT,
      sender_handle TEXT,
      thumbnail_path TEXT,
      file_extension TEXT,
      is_image INTEGER DEFAULT 0,
      is_video INTEGER DEFAULT 0,
      is_document INTEGER DEFAULT 0,
      ocr_text TEXT,
      metadata_only INTEGER DEFAULT 0,
      is_available INTEGER DEFAULT 1,
      source TEXT DEFAULT 'messages'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS attachments_fts USING fts5(
      filename,
      chat_name,
      sender_handle,
      ocr_text,
      content='attachments',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS attachments_ai AFTER INSERT ON attachments BEGIN
      INSERT INTO attachments_fts(rowid, filename, chat_name, sender_handle, ocr_text)
      VALUES (new.id, new.filename, new.chat_name, new.sender_handle, new.ocr_text);
    END;

    CREATE TRIGGER IF NOT EXISTS attachments_ad AFTER DELETE ON attachments BEGIN
      INSERT INTO attachments_fts(attachments_fts, rowid, filename, chat_name, sender_handle, ocr_text)
      VALUES ('delete', old.id, old.filename, old.chat_name, old.sender_handle, old.ocr_text);
    END;

    CREATE TRIGGER IF NOT EXISTS attachments_au AFTER UPDATE ON attachments BEGIN
      INSERT INTO attachments_fts(attachments_fts, rowid, filename, chat_name, sender_handle, ocr_text)
      VALUES ('delete', old.id, old.filename, old.chat_name, old.sender_handle, old.ocr_text);
      INSERT INTO attachments_fts(rowid, filename, chat_name, sender_handle, ocr_text)
      VALUES (new.id, new.filename, new.chat_name, new.sender_handle, new.ocr_text);
    END;
  `)

  db.exec(`CREATE TABLE IF NOT EXISTS hidden_chats (chat_identifier TEXT PRIMARY KEY)`)

  // Migrations for existing DBs
  const addColumnIfMissing = (col: string, def: string): void => {
    try { db!.prepare(`SELECT ${col} FROM attachments LIMIT 1`).get() }
    catch { db!.exec(`ALTER TABLE attachments ADD COLUMN ${col} ${def}`) }
  }
  addColumnIfMissing('metadata_only', 'INTEGER DEFAULT 0')
  addColumnIfMissing('is_available', 'INTEGER DEFAULT 1')
  addColumnIfMissing('source', "TEXT DEFAULT 'messages'")
  addColumnIfMissing('reaction_count', 'INTEGER DEFAULT 0')

  // Backfill null chat_name from Messages chat.db
  try {
    const nullCount = (db.prepare("SELECT COUNT(*) as c FROM attachments WHERE chat_name IS NULL OR chat_name = ''").get() as { c: number }).c
    if (nullCount > 0) {
      console.log(`[DB] Backfilling chat_name for ${nullCount} records...`)
      const { homedir } = require('os')
      const { join } = require('path')
      const { existsSync } = require('fs')
      const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
      if (existsSync(chatDbPath)) {
        const chatDb = new Database(chatDbPath, { readonly: true })
        try {
          // Build a map: original_path (with ~) -> chat_name
          const rows = chatDb.prepare(`
            SELECT
              a.filename as original_path,
              COALESCE(NULLIF(c.display_name, ''), c.chat_identifier, h.id, 'Unknown') as chat_name
            FROM attachment a
            JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
            JOIN message m ON maj.message_id = m.ROWID
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            LEFT JOIN chat c ON cmj.chat_id = c.ROWID
            WHERE a.filename IS NOT NULL
          `).all() as { original_path: string; chat_name: string }[]

          const pathMap = new Map<string, string>()
          for (const row of rows) {
            if (row.original_path && row.chat_name) {
              const expanded = row.original_path.replace('~', homedir())
              pathMap.set(expanded, row.chat_name)
            }
          }

          const nullRows = db.prepare("SELECT id, original_path FROM attachments WHERE chat_name IS NULL OR chat_name = ''").all() as { id: number; original_path: string }[]
          const updateStmt = db.prepare('UPDATE attachments SET chat_name = ? WHERE id = ?')
          let fixed = 0
          for (const nr of nullRows) {
            const chatName = pathMap.get(nr.original_path)
            if (chatName) { updateStmt.run(chatName, nr.id); fixed++ }
          }
          console.log(`[DB] Backfilled ${fixed} of ${nullCount} records`)
          chatDb.close()
        } catch (err) {
          console.error('[DB] Backfill error:', err)
          chatDb.close()
        }
      }
    }
  } catch { /* ignore backfill errors */ }

  return db
}

export function insertAttachment(att: StashAttachment): number | null {
  const d = initDb()
  try {
    const stmt = d.prepare(`
      INSERT OR IGNORE INTO attachments
      (filename, original_path, stash_path, file_size, mime_type, created_at, chat_name, sender_handle, thumbnail_path, file_extension, is_image, is_video, is_document, ocr_text, metadata_only, is_available, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      att.filename,
      att.original_path,
      att.stash_path,
      att.file_size,
      att.mime_type,
      att.created_at,
      att.chat_name,
      att.sender_handle,
      att.thumbnail_path,
      att.file_extension,
      att.is_image,
      att.is_video,
      att.is_document,
      att.ocr_text,
      att.metadata_only ?? 0,
      att.is_available ?? 1,
      att.source ?? 'messages'
    )
    return result.changes > 0 ? Number(result.lastInsertRowid) : null
  } catch (err) {
    console.error('Insert error:', err)
    return null
  }
}

export function updateOcrText(id: number, ocrText: string): void {
  const d = initDb()
  d.prepare('UPDATE attachments SET ocr_text = ? WHERE id = ?').run(ocrText, id)
}

export function updateThumbnail(id: number, thumbnailPath: string): void {
  const d = initDb()
  d.prepare('UPDATE attachments SET thumbnail_path = ? WHERE id = ?').run(thumbnailPath, id)
}

export function markFullyIndexed(id: number): void {
  const d = initDb()
  d.prepare('UPDATE attachments SET metadata_only = 0 WHERE id = ?').run(id)
}

export function updateAvailability(id: number, isAvailable: number): void {
  const d = initDb()
  d.prepare('UPDATE attachments SET is_available = ? WHERE id = ?').run(isAvailable, id)
}

export function getMetadataOnlyByPath(originalPath: string): { id: number } | undefined {
  const d = initDb()
  return d.prepare('SELECT id FROM attachments WHERE original_path = ? AND metadata_only = 1').get(originalPath) as { id: number } | undefined
}

export function getIdByPath(originalPath: string): number | null {
  const d = initDb()
  const row = d.prepare('SELECT id FROM attachments WHERE original_path = ?').get(originalPath) as { id: number } | undefined
  return row ? row.id : null
}

export function searchAttachments(
  query: string,
  filters: { type?: string; chatName?: string; dateRange?: string; dateFrom?: string; dateTo?: string },
  page = 0,
  limit = 50,
  sortOrder?: string
): StashAttachment[] {
  const d = initDb()
  const conditions: string[] = []
  const params: (string | number)[] = []

  let sql: string
  if (query && query.trim()) {
    sql = `
      SELECT DISTINCT a.* FROM attachments a
      JOIN attachments_fts fts ON a.id = fts.rowid
      WHERE attachments_fts MATCH ?
    `
    params.push(query.trim().split(/\s+/).map((w) => `"${w}"*`).join(' '))
  } else {
    sql = 'SELECT DISTINCT * FROM attachments WHERE 1=1'
  }

  // Use table-qualified column names to work with both plain and FTS queries
  const col = query && query.trim() ? 'a.' : ''

  if (filters.type && filters.type !== 'all') {
    switch (filters.type) {
      case 'images': conditions.push(`${col}is_image = 1`); break
      case 'videos': conditions.push(`${col}is_video = 1`); break
      case 'documents': conditions.push(`${col}is_document = 1`); break
      case 'audio': conditions.push(`${col}mime_type LIKE 'audio/%'`); break
    }
  }

  if (filters.chatName) {
    conditions.push(`${col}chat_name = ?`)
    params.push(filters.chatName)
  }

  if (filters.dateRange) {
    const now = new Date()
    let dateStr = ''
    switch (filters.dateRange) {
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); dateStr = d.toISOString(); break }
      case 'month': { const d = new Date(now); d.setMonth(d.getMonth() - 1); dateStr = d.toISOString(); break }
      case 'year': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); dateStr = d.toISOString(); break }
    }
    if (dateStr) { conditions.push(`${col}created_at >= ?`); params.push(dateStr) }
    if (filters.dateRange === 'older') {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1)
      conditions.push(`${col}created_at < ?`); params.push(d.toISOString())
    }
  }

  if (filters.dateFrom) {
    conditions.push(`${col}created_at >= ?`)
    params.push(new Date(filters.dateFrom).toISOString())
  }
  if (filters.dateTo) {
    conditions.push(`${col}created_at <= ?`)
    params.push(new Date(filters.dateTo + 'T23:59:59').toISOString())
  }

  if (conditions.length > 0) sql += ' AND ' + conditions.join(' AND ')

  let orderClause = `ORDER BY ${col}created_at DESC`
  switch (sortOrder) {
    case 'oldest': orderClause = `ORDER BY ${col}created_at ASC`; break
    case 'largest': orderClause = `ORDER BY ${col}file_size DESC`; break
    case 'sender': orderClause = `ORDER BY ${col}sender_handle ASC, ${col}created_at DESC`; break
  }
  sql += ` ${orderClause} LIMIT ? OFFSET ?`
  params.push(limit, page * limit)

  try { return d.prepare(sql).all(...params) as StashAttachment[] }
  catch (err) { console.error('Search error:', err); return [] }
}

export interface ChatNameEntry {
  rawName: string
  attachmentCount: number
  lastMessageDate: string
  messageCount: number
  sentCount: number
  receivedCount: number
  initiationCount: number
  laughsGenerated: number
  laughsReceived: number
  isGroup: boolean
  lateNightRatio: number
  avgReplyMinutes: number
}

export function getStats(chatNameFilter?: string, dateFrom?: string, dateTo?: string): {
  total: number; images: number; videos: number; documents: number; audio: number; unavailable: number; chatNames: ChatNameEntry[]
} {
  const d = initDb()
  // Build date condition for stash.db queries
  const dateParts: string[] = []
  if (dateFrom) dateParts.push(`created_at >= '${dateFrom}'`)
  if (dateTo) dateParts.push(`created_at <= '${dateTo} 23:59:59'`)
  const dateWhere = dateParts.length ? ' AND ' + dateParts.join(' AND ') : ''

  const chatCond = chatNameFilter ? ' AND chat_name = ?' : ''
  const params = chatNameFilter ? [chatNameFilter] : []
  const total = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE 1=1${chatCond}${dateWhere}`).get(...params) as { c: number }).c
  const images = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_image = 1${chatCond}${dateWhere}`).get(...params) as { c: number }).c
  const videos = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_video = 1${chatCond}${dateWhere}`).get(...params) as { c: number }).c
  const documents = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_document = 1${chatCond}${dateWhere}`).get(...params) as { c: number }).c
  const audio = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE mime_type LIKE 'audio/%'${chatCond}${dateWhere}`).get(...params) as { c: number }).c
  const unavailable = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_available = 0${chatCond}${dateWhere}`).get(...params) as { c: number }).c
  const hidden = new Set(getHiddenChats())
  let chatSql = 'SELECT chat_name, COUNT(*) as attachment_count, MAX(created_at) as last_message_date FROM attachments WHERE chat_name IS NOT NULL'
  const chatParams: string[] = []
  if (dateFrom) { chatSql += ' AND created_at >= ?'; chatParams.push(dateFrom) }
  if (dateTo) { chatSql += ' AND created_at <= ?'; chatParams.push(dateTo) }
  chatSql += ' GROUP BY chat_name ORDER BY last_message_date DESC'
  const chatDetails = (d.prepare(chatSql).all(...chatParams) as { chat_name: string; attachment_count: number; last_message_date: string }[])
    .filter((r) => !hidden.has(r.chat_name))

  // Enrich with message counts from chat.db
  let msgStats = new Map<string, { messageCount: number; sentCount: number; receivedCount: number; initiationCount: number; laughsGenerated: number; laughsReceived: number; lateNightRatio: number; avgReplyMinutes: number }>()
  let participantMap = new Map<string, number>()
  let displayToIdentifier = new Map<string, string>()
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const { existsSync } = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (existsSync(chatDbPath)) {
      const chatDb = new Database(chatDbPath, { readonly: true })
      // Convert dateFrom/dateTo to Apple nanosecond timestamps
      const APPLE_EPOCH = 978307200
      const NS = 1000000000
      const appleFrom = dateFrom ? (new Date(dateFrom).getTime() / 1000 - APPLE_EPOCH) * NS : null
      const appleTo = dateTo ? (new Date(dateTo).getTime() / 1000 - APPLE_EPOCH) * NS : null
      const dateCond = (appleFrom ? ' AND m.date >= ' + appleFrom : '') + (appleTo ? ' AND m.date <= ' + appleTo : '')

      const rows = chatDb.prepare(`
        SELECT
          c.chat_identifier as chat_name,
          COUNT(m.ROWID) as message_count,
          SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent_count,
          SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received_count
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1)${dateCond}
        GROUP BY c.chat_identifier
      `).all() as { chat_name: string; message_count: number; sent_count: number; received_count: number }[]

      const initRows = chatDb.prepare(`
        SELECT
          c.chat_identifier as chat_name,
          COUNT(DISTINCT date(datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime'))) as init_days
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.is_from_me = 1${dateCond}
        GROUP BY c.chat_identifier
      `).all() as { chat_name: string; init_days: number }[]

      const initMap = new Map(initRows.map((r) => [r.chat_name, r.init_days]))

      // Build display_name → chat_identifier map for bridging named groups
      try {
        const dnRows = chatDb.prepare(`
          SELECT NULLIF(display_name, '') as dn, chat_identifier as ci FROM chat WHERE display_name IS NOT NULL AND display_name != ''
        `).all() as { dn: string; ci: string }[]
        for (const r of dnRows) if (r.dn) displayToIdentifier.set(r.dn, r.ci)
      } catch { /* ignore */ }

      // Participant counts to identify group chats
      try {
        const partRows = chatDb.prepare(`
          SELECT c.chat_identifier as chat_name, COUNT(DISTINCT chj.handle_id) as participant_count, c.style as chat_style
          FROM chat c LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id GROUP BY c.chat_identifier
        `).all() as { chat_name: string; participant_count: number; chat_style: number }[]
        for (const r of partRows) {
          const isGroup = r.chat_style === 45 || (r.chat_style !== 43 && r.participant_count > 1)
          participantMap.set(r.chat_name, isGroup ? 2 : 1)
        }
      } catch { /* fallback to heuristic */ }

      // Laugh detection — cached per session (expensive full-table scan)
      if (!laughCacheValid) {
        try {
          const LAUGH_RE = /\b(lol|lmao|lmfao|rofl|hehe|omg dead|im dead|i'm dead|i cant|i can't)\b|ha{2,}|he{2,}/i
          const LAUGH_EMOJI = /[\u{1F602}\u{1F923}\u{1F480}]/u
          const FIVE_MIN_NS = 300000000000

          const laughRows = chatDb.prepare(`
            SELECT c.chat_identifier as chat_name, m.is_from_me, m.text, m.date,
              LAG(m.date) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_date,
              LAG(m.is_from_me) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_is_from_me
            FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            JOIN chat c ON cmj.chat_id = c.ROWID WHERE m.text IS NOT NULL
          `).all() as { chat_name: string; is_from_me: number; text: string; date: number; prev_date: number | null; prev_is_from_me: number | null }[]

          laughCache.clear()
          for (const row of laughRows) {
            if (row.prev_date === null || row.prev_is_from_me === null) continue
            if (row.is_from_me === row.prev_is_from_me) continue
            if (row.date - row.prev_date > FIVE_MIN_NS) continue
            const isLaugh = LAUGH_RE.test(row.text) || LAUGH_EMOJI.test(row.text)
            if (!isLaugh) continue
            if (!laughCache.has(row.chat_name)) laughCache.set(row.chat_name, { generated: 0, received: 0 })
            const entry = laughCache.get(row.chat_name)!
            if (row.is_from_me === 0) entry.generated++
            else entry.received++
          }
          laughCacheValid = true
          console.log(`[Laugh] Cached ${laughCache.size} conversations`)
        } catch { /* laugh detection failed, ignore */ }
      }

      // Late-night ratio — cached per session
      if (!lateNightCacheValid) {
        try {
          const lateNightRows = chatDb.prepare(`
            SELECT
              c.chat_identifier as chat_name,
              COUNT(*) as total,
              SUM(CASE
                WHEN CAST(strftime('%H', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) >= 23 THEN 1
                WHEN CAST(strftime('%H', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) < 4 THEN 1
                ELSE 0
              END) as late_night_count
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            JOIN chat c ON cmj.chat_id = c.ROWID
            WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1)${dateCond}
            GROUP BY c.chat_identifier
          `).all() as { chat_name: string; total: number; late_night_count: number }[]

          lateNightCache.clear()
          for (const r of lateNightRows) {
            if (r.total > 0 && r.late_night_count > 0) {
              lateNightCache.set(r.chat_name, Math.round((r.late_night_count / r.total) * 100))
            }
          }
          if (lateNightRows.length > 0) {
            lateNightCacheValid = true
            console.log(`[LateNight] Cached ${lateNightCache.size} chats`)
          }
        } catch (err) { console.error('[LateNight] Error:', err) }
      }

      // Reply latency — cached per session
      if (!replyLatencyCacheValid) {
        try {
          const chatIds = chatDb.prepare(`SELECT ROWID as chat_id, chat_identifier as chat_name FROM chat`).all() as { chat_id: number; chat_name: string }[]

          replyLatencyCache.clear()
          for (const chat of chatIds.slice(0, 50)) {
            const msgs = chatDb.prepare(`
              SELECT m.date, m.is_from_me
              FROM message m
              JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
              WHERE cmj.chat_id = ?
                AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)${dateCond}
              ORDER BY m.date DESC
              LIMIT 200
            `).all(chat.chat_id) as { date: number; is_from_me: number }[]

            const responseTimes: number[] = []
            for (let i = msgs.length - 1; i > 0; i--) {
              if (msgs[i].is_from_me === 0 && msgs[i - 1].is_from_me === 1) {
                const diffMinutes = (msgs[i - 1].date - msgs[i].date) / 1000000000 / 60
                if (diffMinutes > 0 && diffMinutes < 1440) responseTimes.push(diffMinutes)
              }
            }
            if (responseTimes.length > 0) {
              replyLatencyCache.set(chat.chat_name, Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length))
            }
          }
          if (replyLatencyCache.size > 0) {
            replyLatencyCacheValid = true
            console.log(`[ReplyLatency] Cached ${replyLatencyCache.size} chats`)
          }
        } catch (err) { console.error('[ReplyLatency] Error:', err) }
      }

      for (const r of rows) {
        const laughs = laughCache.get(r.chat_name)
        msgStats.set(r.chat_name, {
          messageCount: r.message_count,
          sentCount: r.sent_count,
          receivedCount: r.received_count,
          initiationCount: initMap.get(r.chat_name) || 0,
          laughsGenerated: laughs?.generated || 0,
          laughsReceived: laughs?.received || 0,
          lateNightRatio: lateNightCache.get(r.chat_name) || 0,
          avgReplyMinutes: replyLatencyCache.get(r.chat_name) || 0
        })
      }
      chatDb.close()
    }
  } catch { /* fallback: all zeros */ }

  const chatNames = chatDetails.map((r) => {
    let ms = msgStats.get(r.chat_name)
    // Fallback: try display_name → chat_identifier bridge (named groups)
    if (!ms) {
      const bridged = displayToIdentifier.get(r.chat_name)
      if (bridged) ms = msgStats.get(bridged)
    }
    return {
      rawName: r.chat_name,
      attachmentCount: r.attachment_count,
      lastMessageDate: r.last_message_date || '',
      messageCount: ms?.messageCount || 0,
      sentCount: ms?.sentCount || 0,
      receivedCount: ms?.receivedCount || 0,
      initiationCount: ms?.initiationCount || 0,
      laughsGenerated: ms?.laughsGenerated || 0,
      laughsReceived: ms?.laughsReceived || 0,
      isGroup: (participantMap.get(r.chat_name) ?? participantMap.get(displayToIdentifier.get(r.chat_name) || '') ?? 0) > 1,
      lateNightRatio: ms?.lateNightRatio || 0,
      avgReplyMinutes: ms?.avgReplyMinutes || 0
    }
  })

  return { total, images, videos, documents, audio, unavailable, chatNames }
}

// Returns chat names with contact resolution applied
export function getIndexedChatNames(): string[] {
  const d = initDb()
  return (d.prepare('SELECT DISTINCT chat_name FROM attachments WHERE chat_name IS NOT NULL ORDER BY chat_name').all() as { chat_name: string }[]).map((r) => r.chat_name)
}

export function getAttachmentById(id: number): StashAttachment | null {
  const d = initDb()
  return (d.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as StashAttachment) || null
}

export function isAlreadyIndexed(originalPath: string): boolean {
  const d = initDb()
  const row = d.prepare('SELECT id FROM attachments WHERE original_path = ?').get(originalPath) as { id: number } | undefined
  return !!row
}

export function clearAllAttachments(): void {
  const d = initDb()
  d.exec('DELETE FROM attachments')
  d.exec("DELETE FROM attachments_fts WHERE attachments_fts MATCH '*'")
}

export function hideChat(chatIdentifier: string): void {
  const d = initDb()
  d.prepare('INSERT OR IGNORE INTO hidden_chats (chat_identifier) VALUES (?)').run(chatIdentifier)
}

export function getHiddenChats(): string[] {
  const d = initDb()
  return (d.prepare('SELECT chat_identifier FROM hidden_chats').all() as { chat_identifier: string }[]).map((r) => r.chat_identifier)
}

// ── Per-conversation rich stats ──
export interface ConversationStats {
  firstMessageDate: string | null
  longestStreakDays: number
  mostActiveMonth: string | null
  mostActiveDayOfWeek: string | null
  avgMessagesPerDay: number
  peakHour: number | null
  avgResponseTimeMinutes: number | null
  sharedGroupCount: number
  relationshipArc: 'new' | 'growing' | 'fading' | 'rekindled' | 'steady' | null
  primaryContributor: { displayName: string; messageCount: number; percent: number } | null
  quietestMember: { displayName: string; messageCount: number } | null
  yourContributionPercent: number | null
  memberCount: number
}

const MONTH_NAMES_DB = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES_DB = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function getConversationStats(chatIdentifier: string, isGroup: boolean): ConversationStats {
  const result: ConversationStats = {
    firstMessageDate: null, longestStreakDays: 0, mostActiveMonth: null, mostActiveDayOfWeek: null,
    avgMessagesPerDay: 0, peakHour: null, avgResponseTimeMinutes: null, sharedGroupCount: 0,
    relationshipArc: null, primaryContributor: null, quietestMember: null, yourContributionPercent: null, memberCount: 0
  }

  try {
    const { homedir } = require('os')
    const { join, existsSync: ex } = require('path')
    const fs = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!fs.existsSync(chatDbPath)) return result

    const chatDb = new Database(chatDbPath, { readonly: true })
    const APPLE_EPOCH = 978307200
    const NS = 1000000000

    // Find chat_ids for this identifier
    const chatIds = chatDb.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').all(chatIdentifier) as { ROWID: number }[]
    if (chatIds.length === 0) { chatDb.close(); return result }
    const idList = chatIds.map((r) => r.ROWID).join(',')

    // First message date
    const firstMsg = chatDb.prepare(`SELECT MIN(datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList})`).get() as { d: string } | undefined
    result.firstMessageDate = firstMsg?.d || null

    // Active days + total messages
    const activity = chatDb.prepare(`SELECT COUNT(*) as total, COUNT(DISTINCT date(datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime'))) as days FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList})`).get() as { total: number; days: number }
    result.avgMessagesPerDay = activity.days > 0 ? Math.round(activity.total / activity.days) : 0

    // Streak
    const dates = chatDb.prepare(`SELECT DISTINCT date(datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) ORDER BY d`).all() as { d: string }[]
    if (dates.length > 0) {
      let maxStreak = 1, cur = 1
      for (let i = 1; i < dates.length; i++) {
        const diff = (new Date(dates[i].d).getTime() - new Date(dates[i - 1].d).getTime()) / 86400000
        if (diff === 1) { cur++; if (cur > maxStreak) maxStreak = cur } else cur = 1
      }
      result.longestStreakDays = maxStreak
    }

    // Most active month
    const topMonth = chatDb.prepare(`SELECT CAST(strftime('%m', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as mo, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) GROUP BY mo ORDER BY c DESC LIMIT 1`).get() as { mo: number; c: number } | undefined
    result.mostActiveMonth = topMonth ? MONTH_NAMES_DB[topMonth.mo - 1] : null

    // Most active day of week
    const topDay = chatDb.prepare(`SELECT CAST(strftime('%w', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as dow, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) GROUP BY dow ORDER BY c DESC LIMIT 1`).get() as { dow: number; c: number } | undefined
    result.mostActiveDayOfWeek = topDay ? DAY_NAMES_DB[topDay.dow] : null

    // Peak hour
    const topHour = chatDb.prepare(`SELECT CAST(strftime('%H', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as hr, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) GROUP BY hr ORDER BY c DESC LIMIT 1`).get() as { hr: number; c: number } | undefined
    result.peakHour = topHour?.hr ?? null

    if (!isGroup) {
      // Avg response time (sample last 500 messages)
      const msgs = chatDb.prepare(`SELECT date, is_from_me FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) ORDER BY date DESC LIMIT 500`).all() as { date: number; is_from_me: number }[]
      const times: number[] = []
      for (let i = msgs.length - 2; i >= 0; i--) {
        if (msgs[i + 1].is_from_me === 0 && msgs[i].is_from_me === 1) {
          const diffMin = (msgs[i].date - msgs[i + 1].date) / NS / 60
          if (diffMin > 0 && diffMin < 1440) times.push(diffMin)
        }
      }
      result.avgResponseTimeMinutes = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null

      // Shared group count
      try {
        const shared = chatDb.prepare(`SELECT COUNT(DISTINCT chj.chat_id) as c FROM chat_handle_join chj JOIN handle h ON chj.handle_id = h.ROWID WHERE h.id = ? AND chj.chat_id IN (SELECT chat_id FROM chat_handle_join GROUP BY chat_id HAVING COUNT(*) > 1)`).get(chatIdentifier) as { c: number }
        result.sharedGroupCount = shared?.c || 0
      } catch { /* ignore */ }

      // Relationship arc (this year vs last year)
      const now = new Date()
      const thisYearStart = (new Date(now.getFullYear(), 0, 1).getTime() / 1000 - APPLE_EPOCH) * NS
      const lastYearStart = (new Date(now.getFullYear() - 1, 0, 1).getTime() / 1000 - APPLE_EPOCH) * NS
      const thisYear = (chatDb.prepare(`SELECT COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) AND m.date >= ${thisYearStart}`).get() as { c: number }).c
      const lastYear = (chatDb.prepare(`SELECT COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) AND m.date >= ${lastYearStart} AND m.date < ${thisYearStart}`).get() as { c: number }).c
      if (lastYear === 0 && thisYear > 0) result.relationshipArc = 'new'
      else if (lastYear > 0 && thisYear > lastYear * 1.5) result.relationshipArc = 'growing'
      else if (lastYear > 0 && thisYear < lastYear * 0.3) result.relationshipArc = 'fading'
      else if (lastYear < 10 && thisYear > 50) result.relationshipArc = 'rekindled'
      else result.relationshipArc = 'steady'
    } else {
      // Group: member stats
      try {
        const { compileContactsHelper, resolveContact } = require('./contacts')
        compileContactsHelper()
        const members = chatDb.prepare(`SELECT COALESCE(h.id, '__me__') as handle, m.is_from_me, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE cmj.chat_id IN (${idList}) GROUP BY CASE WHEN m.is_from_me = 1 THEN '__me__' ELSE h.id END`).all() as { handle: string; is_from_me: number; c: number }[]
        let myCount = 0, total = 0
        const memberCounts: { name: string; count: number }[] = []
        for (const m of members) {
          total += m.c
          if (m.is_from_me === 1) myCount += m.c
          else memberCounts.push({ name: resolveContact(m.handle), count: m.c })
        }
        memberCounts.sort((a, b) => b.count - a.count)
        if (myCount > (memberCounts[0]?.count || 0)) {
          result.primaryContributor = { displayName: 'You', messageCount: myCount, percent: Math.round((myCount / Math.max(total, 1)) * 100) }
        } else if (memberCounts[0]) {
          result.primaryContributor = { displayName: memberCounts[0].name, messageCount: memberCounts[0].count, percent: Math.round((memberCounts[0].count / Math.max(total, 1)) * 100) }
        }
        if (memberCounts.length > 0) result.quietestMember = { displayName: memberCounts[memberCounts.length - 1].name, messageCount: memberCounts[memberCounts.length - 1].count }
        result.yourContributionPercent = Math.round((myCount / Math.max(total, 1)) * 100)
        result.memberCount = (chatDb.prepare(`SELECT COUNT(DISTINCT handle_id) as c FROM chat_handle_join WHERE chat_id IN (${idList})`).get() as { c: number }).c + 1
      } catch { /* ignore */ }
    }

    chatDb.close()
  } catch { /* fallback to defaults */ }

  return result
}

export function invalidateLaughCache(): void {
  laughCacheValid = false
  laughCache.clear()
  lateNightCacheValid = false
  lateNightCache.clear()
  replyLatencyCacheValid = false
  replyLatencyCache.clear()
}

export function invalidateLateNightCache(): void {
  lateNightCacheValid = false
  lateNightCache.clear()
}

export function invalidateReplyLatencyCache(): void {
  replyLatencyCacheValid = false
  replyLatencyCache.clear()
}

export function updateReactionCounts(): void {
  const d = initDb()
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const fs = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!fs.existsSync(chatDbPath)) return

    const chatDb = new Database(chatDbPath, { readonly: true })

    // Count reactions per message guid (tapbacks 2000-2005)
    const reactionRows = chatDb.prepare(`
      SELECT associated_message_guid as guid, COUNT(*) as cnt
      FROM message
      WHERE associated_message_type >= 2000 AND associated_message_type <= 2006
        AND associated_message_guid IS NOT NULL
      GROUP BY associated_message_guid
    `).all() as { guid: string; cnt: number }[]

    if (reactionRows.length === 0) { chatDb.close(); return }
    const reactionMap = new Map(reactionRows.map((r) => [r.guid, r.cnt]))

    // Map message guids to attachment filenames
    const attGuids = chatDb.prepare(`
      SELECT a.filename, m.guid FROM attachment a
      JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
      JOIN message m ON maj.message_id = m.ROWID
      WHERE m.guid IS NOT NULL AND a.filename IS NOT NULL
    `).all() as { filename: string; guid: string }[]

    chatDb.close()

    // Update stash.db — match by filename basename
    const { basename } = require('path')
    const updateStmt = d.prepare('UPDATE attachments SET reaction_count = ? WHERE filename = ? AND reaction_count != ?')
    let updated = 0

    const pathStmt = d.prepare('UPDATE attachments SET reaction_count = ? WHERE original_path LIKE ? AND reaction_count != ?')
    const tx = d.transaction(() => {
      for (const row of attGuids) {
        const count = reactionMap.get(row.guid) || 0
        if (count > 0) {
          const fname = basename(row.filename)
          // Try filename match first
          let result = updateStmt.run(count, fname, count)
          // Fallback: try original_path match
          if (result.changes === 0) {
            result = pathStmt.run(count, `%${fname}`, count)
          }
          updated += result.changes
        }
      }
    })
    tx()

    if (updated > 0) console.log(`[Reactions] Updated ${updated} attachments`)
  } catch (err) {
    console.error('[Reactions] Error:', err)
  }
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
