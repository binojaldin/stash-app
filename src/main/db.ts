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

  // ── V2: messages table + FTS ──
  try { db.prepare('SELECT id FROM messages LIMIT 1').get() }
  catch {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, chat_name TEXT NOT NULL, sender_handle TEXT,
        is_from_me INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL,
        sent_at TEXT NOT NULL, apple_date INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_name);
      CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
      CREATE INDEX IF NOT EXISTS idx_messages_me ON messages(is_from_me);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        body, chat_name UNINDEXED, sender_handle UNINDEXED,
        is_from_me UNINDEXED, sent_at UNINDEXED,
        content='messages', content_rowid='id'
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, body, chat_name, sender_handle, is_from_me, sent_at)
        VALUES (new.id, new.body, new.chat_name, new.sender_handle, new.is_from_me, new.sent_at);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body, chat_name, sender_handle, is_from_me, sent_at)
        VALUES ('delete', old.id, old.body, old.chat_name, old.sender_handle, old.is_from_me, old.sent_at);
      END;
    `)
  }

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

export function getTodayInHistory(): {
  id: number; filename: string; original_path: string; thumbnail_path: string | null;
  created_at: string; chat_name: string | null; is_image: number; is_available: number
}[] {
  const d = initDb()
  try {
    return d.prepare(`
      SELECT id, filename, original_path, thumbnail_path, created_at, chat_name, is_image, is_available
      FROM attachments
      WHERE strftime('%m-%d', created_at) = strftime('%m-%d', 'now', 'localtime')
        AND strftime('%Y', created_at) < strftime('%Y', 'now', 'localtime')
        AND is_image = 1
        AND is_available = 1
        AND chat_name IS NOT NULL
        AND thumbnail_path IS NOT NULL
      ORDER BY RANDOM()
      LIMIT 5
    `).all() as { id: number; filename: string; original_path: string; thumbnail_path: string | null; created_at: string; chat_name: string | null; is_image: number; is_available: number }[]
  } catch { return [] }
}

export function getUsageStats(dateFrom?: string, dateTo?: string): {
  totalMessages: number; sentMessages: number; receivedMessages: number
  messagesPerYear: { year: number; count: number }[]
  busiestDay: { date: string; count: number } | null
  busiestYear: { year: number; count: number } | null
  activeConversations: number
} {
  const result = { totalMessages: 0, sentMessages: 0, receivedMessages: 0, messagesPerYear: [] as { year: number; count: number }[], busiestDay: null as { date: string; count: number } | null, busiestYear: null as { year: number; count: number } | null, activeConversations: 0 }
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const { existsSync } = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!existsSync(chatDbPath)) return result
    const chatDb = new Database(chatDbPath, { readonly: true })
    const APPLE_EPOCH = 978307200, NS = 1000000000
    const dateParts: string[] = []
    if (dateFrom) dateParts.push(`m.date >= ${(new Date(dateFrom).getTime() / 1000 - APPLE_EPOCH) * NS}`)
    if (dateTo) dateParts.push(`m.date <= ${(new Date(dateTo).getTime() / 1000 - APPLE_EPOCH) * NS}`)
    const dateCond = dateParts.length ? ' AND ' + dateParts.join(' AND ') : ''
    try {
      const totals = chatDb.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN is_from_me=1 THEN 1 ELSE 0 END) as sent, SUM(CASE WHEN is_from_me=0 THEN 1 ELSE 0 END) as received FROM message m WHERE (text IS NOT NULL OR cache_has_attachments=1) AND item_type=0${dateCond}`).get() as { total: number; sent: number; received: number }
      result.totalMessages = totals?.total || 0; result.sentMessages = totals?.sent || 0; result.receivedMessages = totals?.received || 0

      const byYear = chatDb.prepare(`SELECT CAST(strftime('%Y', datetime(date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year, COUNT(*) as count FROM message m WHERE (text IS NOT NULL OR cache_has_attachments=1) AND item_type=0${dateCond} GROUP BY year ORDER BY year ASC`).all() as { year: number; count: number }[]
      result.messagesPerYear = byYear.filter(r => r.year > 2005 && r.year <= new Date().getFullYear())
      if (result.messagesPerYear.length > 0) {
        const peak = result.messagesPerYear.reduce((a, b) => b.count > a.count ? b : a)
        result.busiestYear = { year: peak.year, count: peak.count }
      }

      const busiest = chatDb.prepare(`SELECT date(datetime(date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d, COUNT(*) as count FROM message m WHERE (text IS NOT NULL OR cache_has_attachments=1) AND item_type=0${dateCond} GROUP BY d ORDER BY count DESC LIMIT 1`).get() as { d: string; count: number } | undefined
      if (busiest) result.busiestDay = { date: busiest.d, count: busiest.count }

      const thirtyDaysAgo = (Date.now() / 1000 - APPLE_EPOCH - 30 * 86400) * NS
      const active = chatDb.prepare(`SELECT COUNT(DISTINCT cmj.chat_id) as c FROM message m JOIN chat_message_join cmj ON m.ROWID=cmj.message_id WHERE m.date>=${thirtyDaysAgo} AND (m.text IS NOT NULL OR m.cache_has_attachments=1)`).get() as { c: number }
      result.activeConversations = active?.c || 0
    } finally { chatDb.close() }
  } catch { /* zeros */ }
  return result
}

export function getMessagingNetwork(): {
  nodes: { rawName: string; messageCount: number }[]
  edges: { a: string; b: string; sharedGroups: number }[]
} {
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const { existsSync } = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!existsSync(chatDbPath)) return { nodes: [], edges: [] }

    const chatDb = new Database(chatDbPath, { readonly: true })
    try {
      const rows = chatDb.prepare(`
        SELECT c.chat_identifier as chat_id, h.id as handle_id
        FROM chat c
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        JOIN handle h ON chj.handle_id = h.ROWID
        WHERE (SELECT COUNT(DISTINCT chj2.handle_id) FROM chat_handle_join chj2 WHERE chj2.chat_id = c.ROWID) > 1
      `).all() as { chat_id: string; handle_id: string }[]

      const handleMsgRows = chatDb.prepare(`
        SELECT h.id as handle_id, COUNT(m.ROWID) as cnt
        FROM message m JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.is_from_me = 0
        GROUP BY h.id
      `).all() as { handle_id: string; cnt: number }[]

      const handleMsgMap = new Map(handleMsgRows.map(r => [r.handle_id, r.cnt]))

      const chatToHandles = new Map<string, Set<string>>()
      for (const row of rows) {
        if (!chatToHandles.has(row.chat_id)) chatToHandles.set(row.chat_id, new Set())
        chatToHandles.get(row.chat_id)!.add(row.handle_id)
      }

      const edgeMap = new Map<string, number>()
      for (const handles of chatToHandles.values()) {
        const arr = Array.from(handles).sort()
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const key = `${arr[i]}|||${arr[j]}`
            edgeMap.set(key, (edgeMap.get(key) || 0) + 1)
          }
        }
      }

      const allHandles = new Set<string>()
      for (const handles of chatToHandles.values()) for (const h of handles) allHandles.add(h)

      const nodes = Array.from(allHandles)
        .map(h => ({ rawName: h, messageCount: handleMsgMap.get(h) || 0 }))
        .sort((a, b) => b.messageCount - a.messageCount || a.rawName.localeCompare(b.rawName))
        .slice(0, 40)

      const nodeSet = new Set(nodes.map(n => n.rawName))
      const edges: { a: string; b: string; sharedGroups: number }[] = []
      for (const [key, count] of edgeMap) {
        const sep = key.indexOf('|||')
        const a = key.slice(0, sep), b = key.slice(sep + 3)
        if (nodeSet.has(a) && nodeSet.has(b)) edges.push({ a, b, sharedGroups: count })
      }

      return { nodes, edges }
    } finally {
      try { chatDb.close() } catch { /* ignore double close */ }
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

export function getFastStats(chatNameFilter?: string, dateFrom?: string, dateTo?: string): {
  total: number; images: number; videos: number; documents: number; audio: number; unavailable: number; chatNames: ChatNameEntry[]; globalPeakHour: number | null; globalPeakWeekday: number | null
} {
  const d = initDb()
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
    .filter(r => !hidden.has(r.chat_name))

  const chatNames: ChatNameEntry[] = chatDetails.map(r => ({
    rawName: r.chat_name,
    attachmentCount: r.attachment_count,
    lastMessageDate: r.last_message_date || '',
    messageCount: 0, sentCount: 0, receivedCount: 0, initiationCount: 0,
    laughsGenerated: 0, laughsReceived: 0, isGroup: false,
    lateNightRatio: 0, avgReplyMinutes: 0
  }))

  return { total, images, videos, documents, audio, unavailable, chatNames, globalPeakHour: null, globalPeakWeekday: null }
}

export function getStats(chatNameFilter?: string, dateFrom?: string, dateTo?: string): {
  total: number; images: number; videos: number; documents: number; audio: number; unavailable: number; chatNames: ChatNameEntry[]; globalPeakHour: number | null; globalPeakWeekday: number | null
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
  let globalPeakHour: number | null = null
  let globalPeakWeekday: number | null = null
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
        type PartRow = {
          chat_id: number
          chat_name: string
          participant_count: number
        }

        const partRows = chatDb.prepare(`
          SELECT
            c.ROWID as chat_id,
            c.chat_identifier as chat_name,
            COUNT(DISTINCT chj.handle_id) as participant_count
          FROM chat c
          LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
          GROUP BY c.ROWID, c.chat_identifier
        `).all() as PartRow[]

        const grouped = new Map<string, PartRow[]>()
        for (const row of partRows) {
          if (!grouped.has(row.chat_name)) grouped.set(row.chat_name, [])
          grouped.get(row.chat_name)!.push(row)
        }

        participantMap.clear()
        for (const [chatName, rows] of grouped) {
          const maxParticipants = Math.max(...rows.map(r => r.participant_count || 0))
          const isGroup = maxParticipants > 1
          participantMap.set(chatName, isGroup ? 2 : 1)
        }
      } catch (err) {
        console.error('[GroupDetection] failed', err)
      }

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
            JOIN chat c ON cmj.chat_id = c.ROWID
            WHERE m.text IS NOT NULL
              AND (
                m.text LIKE '%lol%' OR m.text LIKE '%lmao%' OR m.text LIKE '%haha%'
                OR m.text LIKE '%hehe%' OR m.text LIKE '%rofl%' OR m.text LIKE '%lmfao%'
                OR m.text LIKE '%im dead%' OR m.text LIKE '%i cant%'
                OR m.text LIKE '%😂%' OR m.text LIKE '%🤣%' OR m.text LIKE '%💀%'
              )
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

      // Reply latency — cached per session (single SQL query with window functions)
      if (!replyLatencyCacheValid) {
        try {
          const latencyRows = chatDb.prepare(`
            WITH ordered AS (
              SELECT
                c.chat_identifier as chat_name,
                m.date,
                m.is_from_me,
                LAG(m.date) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_date,
                LAG(m.is_from_me) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_from_me
              FROM message m
              JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
              JOIN chat c ON cmj.chat_id = c.ROWID
              WHERE m.is_from_me IN (0, 1) AND m.date > 0
            )
            SELECT
              chat_name,
              AVG(CAST(date - prev_date AS REAL) / 1000000000.0 / 60.0) as avg_minutes
            FROM ordered
            WHERE is_from_me = 1
              AND prev_from_me = 0
              AND (date - prev_date) > 0
              AND (date - prev_date) < 86400000000000
            GROUP BY chat_name
            HAVING COUNT(*) >= 3
          `).all() as { chat_name: string; avg_minutes: number }[]

          replyLatencyCache.clear()
          for (const row of latencyRows) {
            replyLatencyCache.set(row.chat_name, Math.round(row.avg_minutes))
          }
          if (replyLatencyCache.size > 0) {
            replyLatencyCacheValid = true
            console.log(`[ReplyLatency] Cached ${replyLatencyCache.size} chats`)
          }
        } catch (err) { console.error('[ReplyLatency] Error:', err) }
      }

      // Global peak hour and weekday
      try {
        const peakHourRow = chatDb.prepare(`
          SELECT CAST(strftime('%H', datetime(m.date / ${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as hr, COUNT(*) as c
          FROM message m WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1) AND m.is_from_me = 1${dateCond}
          GROUP BY hr ORDER BY c DESC LIMIT 1
        `).get() as { hr: number; c: number } | undefined
        globalPeakHour = peakHourRow?.hr ?? null

        const peakDayRow = chatDb.prepare(`
          SELECT CAST(strftime('%w', datetime(m.date / ${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as dow, COUNT(*) as c
          FROM message m WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1) AND m.is_from_me = 1${dateCond}
          GROUP BY dow ORDER BY c DESC LIMIT 1
        `).get() as { dow: number; c: number } | undefined
        globalPeakWeekday = peakDayRow?.dow ?? null
      } catch { /* ignore */ }

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

  return { total, images, videos, documents, audio, unavailable, chatNames, globalPeakHour, globalPeakWeekday }
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
  peakYear: { year: number; count: number } | null
  peakYearShareOfTotal: number | null
}

const MONTH_NAMES_DB = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES_DB = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function getConversationStats(chatIdentifier: string, isGroup: boolean): ConversationStats {
  const result: ConversationStats = {
    firstMessageDate: null, longestStreakDays: 0, mostActiveMonth: null, mostActiveDayOfWeek: null,
    avgMessagesPerDay: 0, peakHour: null, avgResponseTimeMinutes: null, sharedGroupCount: 0,
    relationshipArc: null, primaryContributor: null, quietestMember: null, yourContributionPercent: null, memberCount: 0,
    peakYear: null, peakYearShareOfTotal: null
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

    // Peak year together
    try {
      const yearRows = chatDb.prepare(`
        SELECT CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year, COUNT(*) as c
        FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id IN (${idList}) GROUP BY year ORDER BY c DESC LIMIT 1
      `).get() as { year: number; c: number } | undefined
      if (yearRows) {
        result.peakYear = { year: yearRows.year, count: yearRows.c }
        // Compute share of total archive in that year
        try {
          const totalInYear = chatDb.prepare(`
            SELECT COUNT(*) as c FROM message m
            WHERE CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) = ?
              AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          `).get(yearRows.year) as { c: number }
          if (totalInYear && totalInYear.c > 0) {
            result.peakYearShareOfTotal = Math.round((yearRows.c / totalInYear.c) * 100)
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    chatDb.close()
  } catch { /* fallback to defaults */ }

  return result
}

export interface TimelineEvent {
  timestamp: string
  type: string
  description: string
  metric?: number
}

export function getRelationshipTimeline(chatIdentifier: string): { events: TimelineEvent[] } {
  const events: TimelineEvent[] = []
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const fs = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!fs.existsSync(chatDbPath)) return { events }

    const chatDb = new Database(chatDbPath, { readonly: true })
    const APPLE_EPOCH = 978307200
    const NS = 1000000000

    const chatIds = chatDb.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').all(chatIdentifier) as { ROWID: number }[]
    if (chatIds.length === 0) { chatDb.close(); return { events } }
    const idList = chatIds.map(r => r.ROWID).join(',')

    // First message
    const first = chatDb.prepare(`SELECT MIN(datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList})`).get() as { d: string | null } | undefined
    if (first?.d) events.push({ timestamp: first.d.slice(0, 10), type: 'first_message', description: 'First message.' })

    // Busiest month (year-month)
    const busiestMonth = chatDb.prepare(`SELECT strftime('%Y-%m', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) as ym, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) GROUP BY ym ORDER BY c DESC LIMIT 1`).get() as { ym: string; c: number } | undefined
    if (busiestMonth) {
      const [y, mo] = busiestMonth.ym.split('-').map(Number)
      events.push({ timestamp: `${y}-${String(mo).padStart(2, '0')}-15`, type: 'busiest_month', description: `Your busiest month together. ${busiestMonth.c.toLocaleString()} messages.`, metric: busiestMonth.c })
    }

    // Busiest day
    const busiestDay = chatDb.prepare(`SELECT date(datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) GROUP BY d ORDER BY c DESC LIMIT 1`).get() as { d: string; c: number } | undefined
    if (busiestDay) events.push({ timestamp: busiestDay.d, type: 'busiest_day', description: `${busiestDay.c} messages exchanged in one day.`, metric: busiestDay.c })

    // Longest streak (with start date)
    const dates = chatDb.prepare(`SELECT DISTINCT date(datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) ORDER BY d`).all() as { d: string }[]
    if (dates.length > 1) {
      let maxStreak = 1, cur = 1, maxStart = 0, curStart = 0
      for (let i = 1; i < dates.length; i++) {
        const diff = (new Date(dates[i].d).getTime() - new Date(dates[i - 1].d).getTime()) / 86400000
        if (diff === 1) { cur++; if (cur > maxStreak) { maxStreak = cur; maxStart = curStart } } else { cur = 1; curStart = i }
      }
      if (maxStreak >= 3) {
        events.push({ timestamp: dates[maxStart].d, type: 'longest_streak', description: `Longest streak: ${maxStreak} days straight.`, metric: maxStreak })
      }
    }

    // Peak year
    const peakYear = chatDb.prepare(`SELECT CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year, COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) GROUP BY year ORDER BY c DESC LIMIT 1`).get() as { year: number; c: number } | undefined
    if (peakYear) events.push({ timestamp: `${peakYear.year}-06-15`, type: 'peak_year', description: `Peak year. ${peakYear.c.toLocaleString()} messages.`, metric: peakYear.c })

    // Total messages (recent activity)
    const total = (chatDb.prepare(`SELECT COUNT(*) as c FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList})`).get() as { c: number }).c
    if (total > 0) events.push({ timestamp: new Date().toISOString().slice(0, 10), type: 'recent_activity', description: `${total.toLocaleString()} messages exchanged.`, metric: total })

    chatDb.close()
  } catch { /* fallback */ }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return { events }
}

export interface SocialGravityYear {
  year: number
  dominant: { name: string; count: number; pct: number }
  top5: { name: string; count: number; pct: number }[]
  clusterContacts: string[]
  clusterLabel: string | null
}

export function getSocialGravity(): { individualYears: SocialGravityYear[]; groupYears: SocialGravityYear[] } {
  const individualYears: SocialGravityYear[] = []
  const groupYears: SocialGravityYear[] = []
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const fs = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!fs.existsSync(chatDbPath)) return { individualYears, groupYears }

    const chatDb = new Database(chatDbPath, { readonly: true })
    const APPLE_EPOCH = 978307200
    const NS = 1000000000
    const currentYear = new Date().getFullYear()

    try {
      // Identify group chats (multi-participant)
      const groupChatIds = new Set(
        (chatDb.prepare(`SELECT c.chat_identifier FROM chat c WHERE (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) > 1`).all() as { chat_identifier: string }[]).map(r => r.chat_identifier)
      )

      // ── Individual messages: received per handle per year ──
      const indivRecv = chatDb.prepare(`
        SELECT CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year,
               h.id as handle, COUNT(*) as cnt
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.is_from_me = 0 AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) = 1
        GROUP BY year, h.id HAVING year > 2005 AND year <= ${currentYear}
      `).all() as { year: number; handle: string; cnt: number }[]

      // Individual messages: sent per chat_identifier per year (1:1 only)
      const indivSent = chatDb.prepare(`
        SELECT CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year,
               c.chat_identifier as handle, COUNT(*) as cnt
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.is_from_me = 1 AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) = 1
        GROUP BY year, c.chat_identifier HAVING year > 2005 AND year <= ${currentYear}
      `).all() as { year: number; handle: string; cnt: number }[]

      // ── Group messages: per group chat per year ──
      const grpRecv = chatDb.prepare(`
        SELECT CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year,
               c.chat_identifier as chat_id, COUNT(*) as cnt
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.is_from_me = 0 AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) > 1
        GROUP BY year, c.chat_identifier HAVING year > 2005 AND year <= ${currentYear}
      `).all() as { year: number; chat_id: string; cnt: number }[]

      const grpSent = chatDb.prepare(`
        SELECT CAST(strftime('%Y', datetime(m.date/${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year,
               c.chat_identifier as chat_id, COUNT(*) as cnt
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.is_from_me = 1 AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) > 1
        GROUP BY year, c.chat_identifier HAVING year > 2005 AND year <= ${currentYear}
      `).all() as { year: number; chat_id: string; cnt: number }[]

      // ── Shared group data for individual cluster detection ──
      const groupMembership = chatDb.prepare(`
        SELECT c.chat_identifier as chat_id, h.id as handle_id
        FROM chat c JOIN chat_handle_join chj ON c.ROWID = chj.chat_id JOIN handle h ON chj.handle_id = h.ROWID
        WHERE (SELECT COUNT(DISTINCT chj2.handle_id) FROM chat_handle_join chj2 WHERE chj2.chat_id = c.ROWID) > 1
      `).all() as { chat_id: string; handle_id: string }[]

      const chatToHandles = new Map<string, Set<string>>()
      for (const r of groupMembership) {
        if (!chatToHandles.has(r.chat_id)) chatToHandles.set(r.chat_id, new Set())
        chatToHandles.get(r.chat_id)!.add(r.handle_id)
      }

      const coGroupMap = new Map<string, Map<string, number>>()
      for (const handles of chatToHandles.values()) {
        const arr = Array.from(handles)
        for (const a of arr) {
          if (!coGroupMap.has(a)) coGroupMap.set(a, new Map())
          for (const b of arr) { if (a !== b) coGroupMap.get(a)!.set(b, (coGroupMap.get(a)!.get(b) || 0) + 1) }
        }
      }

      const chatDisplayNames = chatDb.prepare(`SELECT chat_identifier, display_name FROM chat WHERE display_name IS NOT NULL AND display_name != ''`).all() as { chat_identifier: string; display_name: string }[]
      const chatNameDb = new Map(chatDisplayNames.map(r => [r.chat_identifier, r.display_name]))

      // ── Build individual years ──
      const indivMap = new Map<string, number>()
      for (const r of indivRecv) indivMap.set(`${r.year}|||${r.handle}`, (indivMap.get(`${r.year}|||${r.handle}`) || 0) + r.cnt)
      for (const r of indivSent) indivMap.set(`${r.year}|||${r.handle}`, (indivMap.get(`${r.year}|||${r.handle}`) || 0) + r.cnt)

      const indivByYear = new Map<number, { handle: string; cnt: number }[]>()
      for (const [key, cnt] of indivMap) {
        const sep = key.indexOf('|||'); const year = parseInt(key.slice(0, sep)); const handle = key.slice(sep + 3)
        if (!indivByYear.has(year)) indivByYear.set(year, [])
        indivByYear.get(year)!.push({ handle, cnt })
      }

      for (const [year, contacts] of [...indivByYear.entries()].sort((a, b) => a[0] - b[0])) {
        contacts.sort((a, b) => b.cnt - a.cnt)
        const total = contacts.reduce((s, c) => s + c.cnt, 0)
        if (total < 10) continue
        const top5 = contacts.slice(0, 5).map(c => ({ name: c.handle, count: c.cnt, pct: Math.round((c.cnt / total) * 100) }))
        const dominant = top5[0]
        // Cluster detection for individuals
        const topHandles = new Set(contacts.slice(0, 10).map(c => c.handle))
        const coGroup = coGroupMap.get(dominant.name)
        const clusterContacts: string[] = []
        if (coGroup) {
          for (const [h] of [...coGroup.entries()].filter(([h]) => topHandles.has(h)).sort((a, b) => b[1] - a[1]).slice(0, 4)) clusterContacts.push(h)
        }
        let clusterLabel: string | null = null
        if (clusterContacts.length >= 1) {
          const clusterSet = new Set([dominant.name, ...clusterContacts])
          for (const [chatId, handles] of chatToHandles) {
            const overlap = [...handles].filter(h => clusterSet.has(h)).length
            if (overlap >= Math.min(clusterSet.size, 3) && chatNameDb.has(chatId)) {
              const name = chatNameDb.get(chatId)!
              if (name.length > 1 && name.length < 40 && !name.startsWith('+')) { clusterLabel = name; break }
            }
          }
        }
        individualYears.push({ year, dominant, top5, clusterContacts, clusterLabel })
      }

      // ── Build group years ──
      const grpMap = new Map<string, number>()
      for (const r of grpRecv) grpMap.set(`${r.year}|||${r.chat_id}`, (grpMap.get(`${r.year}|||${r.chat_id}`) || 0) + r.cnt)
      for (const r of grpSent) grpMap.set(`${r.year}|||${r.chat_id}`, (grpMap.get(`${r.year}|||${r.chat_id}`) || 0) + r.cnt)

      const grpByYear = new Map<number, { handle: string; cnt: number }[]>()
      for (const [key, cnt] of grpMap) {
        const sep = key.indexOf('|||'); const year = parseInt(key.slice(0, sep)); const handle = key.slice(sep + 3)
        if (!grpByYear.has(year)) grpByYear.set(year, [])
        grpByYear.get(year)!.push({ handle, cnt })
      }

      for (const [year, chats] of [...grpByYear.entries()].sort((a, b) => a[0] - b[0])) {
        chats.sort((a, b) => b.cnt - a.cnt)
        const total = chats.reduce((s, c) => s + c.cnt, 0)
        if (total < 10) continue
        const top5 = chats.slice(0, 5).map(c => ({ name: c.handle, count: c.cnt, pct: Math.round((c.cnt / total) * 100) }))
        const dominant = top5[0]
        // For groups, cluster = members of the dominant group chat
        const members = chatToHandles.get(dominant.name)
        const clusterContacts = members ? [...members].slice(0, 5) : []
        const clusterLabel = chatNameDb.get(dominant.name) || null
        groupYears.push({ year, dominant, top5, clusterContacts, clusterLabel })
      }
    } finally {
      try { chatDb.close() } catch { /* ignore */ }
    }
  } catch { /* fallback */ }
  return { individualYears, groupYears }
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

// ── V2: Message search ──

export function searchMessages(query: string, chatName?: string, limit = 50): {
  id: number; body: string; chat_name: string; sender_handle: string | null; is_from_me: number; sent_at: string; snippet: string
}[] {
  const d = initDb()
  if (!query.trim()) return []
  try {
    const terms = query.trim().split(/\s+/).map(w => `"${w.replace(/"/g, '""')}"*`).join(' ')
    const chatFilter = chatName ? ' AND m.chat_name = ?' : ''
    const params: (string | number)[] = [terms]
    if (chatName) params.push(chatName)
    params.push(limit)
    return d.prepare(`
      SELECT m.id, m.body, m.chat_name, m.sender_handle, m.is_from_me, m.sent_at,
        snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) as snippet
      FROM messages_fts JOIN messages m ON messages_fts.rowid = m.id
      WHERE messages_fts MATCH ?${chatFilter} ORDER BY rank LIMIT ?
    `).all(...params) as { id: number; body: string; chat_name: string; sender_handle: string | null; is_from_me: number; sent_at: string; snippet: string }[]
  } catch { return [] }
}

export function getMessageIndexStatus(): { total: number; indexed: number } {
  const d = initDb()
  try {
    const indexed = (d.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
    const { homedir } = require('os'); const { join } = require('path'); const { existsSync } = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!existsSync(chatDbPath)) return { total: 0, indexed }
    const chatDb = new Database(chatDbPath, { readonly: true })
    const total = (chatDb.prepare('SELECT COUNT(*) as c FROM message WHERE text IS NOT NULL AND item_type = 0').get() as { c: number }).c
    chatDb.close()
    return { total, indexed }
  } catch { return { total: 0, indexed: 0 } }
}

export function getVocabStats(chatName?: string): {
  uniqueWords: number; totalWords: number; avgWordsPerMessage: number; theirAvgWordsPerMessage: number; topWords: { word: string; count: number }[]
} {
  const d = initDb()
  try {
    const myFilter = chatName ? 'WHERE chat_name = ? AND is_from_me = 1' : 'WHERE is_from_me = 1'
    const theirFilter = chatName ? 'WHERE chat_name = ? AND is_from_me = 0' : 'WHERE is_from_me = 0'
    const params: string[] = chatName ? [chatName] : []
    const myRows = d.prepare(`SELECT body FROM messages ${myFilter} LIMIT 100000`).all(...params) as { body: string }[]
    const theirRows = chatName ? d.prepare(`SELECT body FROM messages ${theirFilter} LIMIT 100000`).all(chatName) as { body: string }[] : []
    const STOP = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','it','i','you','he','she','we','they','this','that','was','are','be','been','have','has','had','do','did','will','would','could','should','may','might','not','no','so','if','as','up','out','about','what','when','where','how','all','my','your','his','her','our','their','me','him','us','them','its','from','by','just','like','get','got','can','go','know','think','say','said','want','see','make','good','one','more','also','then','than','really','yeah','ok','okay','yes','im','dont','thats','youre','were','ive','ill','id','ur','u','r','lol','haha','lmao'])
    const counts = new Map<string, number>()
    let totalWords = 0
    for (const { body } of myRows) {
      const words = body.toLowerCase().match(/\b[a-z]{3,}\b/g) || []
      totalWords += words.length
      for (const w of words) if (!STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1)
    }
    let theirTotal = 0
    for (const { body } of theirRows) { theirTotal += (body.toLowerCase().match(/\b[a-z]{3,}\b/g) || []).length }
    const topWords = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count }))
    return { uniqueWords: counts.size, totalWords, avgWordsPerMessage: myRows.length > 0 ? Math.round(totalWords / myRows.length) : 0, theirAvgWordsPerMessage: theirRows.length > 0 ? Math.round(theirTotal / theirRows.length) : 0, topWords }
  } catch { return { uniqueWords: 0, totalWords: 0, avgWordsPerMessage: 0, theirAvgWordsPerMessage: 0, topWords: [] } }
}

export function getWordOrigins(chatName?: string, limit = 5): { word: string; firstUsed: string; chatName: string; totalUses: number; firstMessage: string | null }[] {
  const d = initDb()
  try {
    const chatFilter = chatName ? 'AND chat_name = ?' : ''
    const params: string[] = chatName ? [chatName] : []
    const rows = d.prepare(`SELECT body, chat_name, sent_at FROM messages WHERE is_from_me = 1 ${chatFilter} ORDER BY apple_date ASC LIMIT 200000`).all(...params) as { body: string; chat_name: string; sent_at: string }[]
    const STOP = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','it','i','you','he','she','we','they','this','that','was','are','be','been','have','has','had','do','did','will','would','could','should','may','might','not','no','so','if','as','up','out','about','what','when','where','how','all','my','your','his','her','our','their','me','him','us','them','its','from','by','just','like','get','got','can','go','know','think','say','said','want','see','make','good','one','more','also','then','than','really','yeah','ok','okay','yes','im','dont','thats','youre','were','ive','ill','id','ur','u','r','lol','haha','lmao','gonna','wanna','gotta','kinda','sorta','tbh','ngl','imo','btw','omg','wtf','brb','ttyl'])
    const firstSeen = new Map<string, { sent_at: string; chat_name: string }>()
    const counts = new Map<string, number>()
    for (const { body, chat_name: cn, sent_at } of rows) {
      const words = body.toLowerCase().match(/\b[a-z]{4,}\b/g) || []
      for (const w of words) { if (STOP.has(w)) continue; counts.set(w, (counts.get(w) || 0) + 1); if (!firstSeen.has(w)) firstSeen.set(w, { sent_at, chat_name: cn }) }
    }
    const cutoff = new Date('2018-01-01').toISOString()
    const candidates = Array.from(firstSeen.entries())
      .filter(([w, { sent_at }]) => { const uses = counts.get(w) || 0; return uses >= 5 && sent_at > cutoff && uses < 500 })
      .sort((a, b) => { const ay = new Date(a[1].sent_at).getFullYear(), by = new Date(b[1].sent_at).getFullYear(); if (ay !== by) return by - ay; return (counts.get(b[0]) || 0) - (counts.get(a[0]) || 0) })
      .slice(0, limit * 3)
    return candidates.slice(0, limit).map(([word, { sent_at, chat_name: cn }]) => {
      let firstMessage: string | null = null
      try { const row = d.prepare('SELECT body FROM messages WHERE is_from_me = 1 AND chat_name = ? AND sent_at = ? LIMIT 1').get(cn, sent_at) as { body: string } | undefined; if (row) firstMessage = row.body.length > 100 ? row.body.slice(0, 97) + '…' : row.body } catch {}
      return { word, firstUsed: sent_at, chatName: cn, totalUses: counts.get(word) || 0, firstMessage }
    })
  } catch { return [] }
}

export function closeDb(): void {
  if (db) { db.close(); db = null }
}
