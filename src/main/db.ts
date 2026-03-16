import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

let db: Database.Database | null = null

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
}

export function getStats(chatNameFilter?: string, dateFrom?: string, dateTo?: string): {
  total: number; images: number; videos: number; documents: number; audio: number; unavailable: number; chatNames: ChatNameEntry[]
} {
  const d = initDb()
  const where = chatNameFilter ? ' WHERE chat_name = ?' : ''
  const params = chatNameFilter ? [chatNameFilter] : []
  const total = (d.prepare(`SELECT COUNT(*) as c FROM attachments${where}`).get(...params) as { c: number }).c
  const images = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_image = 1${chatNameFilter ? ' AND chat_name = ?' : ''}`).get(...params) as { c: number }).c
  const videos = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_video = 1${chatNameFilter ? ' AND chat_name = ?' : ''}`).get(...params) as { c: number }).c
  const documents = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_document = 1${chatNameFilter ? ' AND chat_name = ?' : ''}`).get(...params) as { c: number }).c
  const audio = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE mime_type LIKE 'audio/%'${chatNameFilter ? ' AND chat_name = ?' : ''}`).get(...params) as { c: number }).c
  const unavailable = (d.prepare(`SELECT COUNT(*) as c FROM attachments WHERE is_available = 0${chatNameFilter ? ' AND chat_name = ?' : ''}`).get(...params) as { c: number }).c
  const hidden = new Set(getHiddenChats())
  let chatSql = 'SELECT chat_name, COUNT(*) as attachment_count, MAX(created_at) as last_message_date FROM attachments WHERE chat_name IS NOT NULL'
  const chatParams: string[] = []
  if (dateFrom) { chatSql += ' AND created_at >= ?'; chatParams.push(dateFrom) }
  if (dateTo) { chatSql += ' AND created_at <= ?'; chatParams.push(dateTo) }
  chatSql += ' GROUP BY chat_name ORDER BY chat_name'
  const chatDetails = (d.prepare(chatSql).all(...chatParams) as { chat_name: string; attachment_count: number; last_message_date: string }[])
    .filter((r) => !hidden.has(r.chat_name))

  // Enrich with message counts from chat.db
  let msgStats = new Map<string, { messageCount: number; sentCount: number; receivedCount: number; initiationCount: number; laughsGenerated: number; laughsReceived: number }>()
  let participantMap = new Map<string, number>()
  let displayToIdentifier = new Map<string, string>()
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const { existsSync } = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (existsSync(chatDbPath)) {
      const chatDb = new Database(chatDbPath, { readonly: true })
      const rows = chatDb.prepare(`
        SELECT
          c.chat_identifier as chat_name,
          COUNT(m.ROWID) as message_count,
          SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent_count,
          SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received_count
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.text IS NOT NULL OR m.cache_has_attachments = 1
        GROUP BY c.chat_identifier
      `).all() as { chat_name: string; message_count: number; sent_count: number; received_count: number }[]

      // Initiation count: days where user sent first message
      const initRows = chatDb.prepare(`
        SELECT
          c.chat_identifier as chat_name,
          COUNT(DISTINCT date(datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime'))) as init_days
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.is_from_me = 1
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
          SELECT c.chat_identifier as chat_name, COUNT(DISTINCT chj.handle_id) as participant_count
          FROM chat c LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id GROUP BY c.chat_identifier
        `).all() as { chat_name: string; participant_count: number }[]
        for (const r of partRows) participantMap.set(r.chat_name, r.participant_count)
      } catch { /* fallback to heuristic */ }

      // Laugh detection
      const laughMap = new Map<string, { generated: number; received: number }>()
      try {
        const LAUGH_RE = /\b(lol|lmao|lmfao|rofl|hehe|omg dead|im dead|i'm dead|i cant|i can't)\b|ha{2,}|he{2,}/i
        const LAUGH_EMOJI = /[\u{1F602}\u{1F923}\u{1F480}]/u
        const FIVE_MIN_NS = 300000000000

        const laughRows = chatDb.prepare(`
          SELECT
            c.chat_identifier as chat_name,
            m.is_from_me,
            m.text,
            m.date,
            LAG(m.date) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_date,
            LAG(m.is_from_me) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_is_from_me
          FROM message m
          JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          JOIN chat c ON cmj.chat_id = c.ROWID
          WHERE m.text IS NOT NULL
        `).all() as { chat_name: string; is_from_me: number; text: string; date: number; prev_date: number | null; prev_is_from_me: number | null }[]

        for (const row of laughRows) {
          if (row.prev_date === null || row.prev_is_from_me === null) continue
          if (row.is_from_me === row.prev_is_from_me) continue // same sender
          if (row.date - row.prev_date > FIVE_MIN_NS) continue // too long gap
          const isLaugh = LAUGH_RE.test(row.text) || LAUGH_EMOJI.test(row.text)
          if (!isLaugh) continue
          if (!laughMap.has(row.chat_name)) laughMap.set(row.chat_name, { generated: 0, received: 0 })
          const entry = laughMap.get(row.chat_name)!
          if (row.is_from_me === 0) entry.generated++ // they laughed at your message
          else entry.received++ // you laughed at their message
        }
      } catch { /* laugh detection failed, ignore */ }

      for (const r of rows) {
        const laughs = laughMap.get(r.chat_name)
        msgStats.set(r.chat_name, {
          messageCount: r.message_count,
          sentCount: r.sent_count,
          receivedCount: r.received_count,
          initiationCount: initMap.get(r.chat_name) || 0,
          laughsGenerated: laughs?.generated || 0,
          laughsReceived: laughs?.received || 0
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
      isGroup: (participantMap.get(r.chat_name) ?? participantMap.get(displayToIdentifier.get(r.chat_name) || '') ?? 0) > 1 || /^chat\d+/i.test(r.chat_name || '')
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

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
