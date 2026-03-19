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

  // ── V3: message analysis pipeline tables ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_signals (
      message_id INTEGER PRIMARY KEY,
      chat_identifier TEXT NOT NULL,
      is_from_me INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      has_laugh INTEGER DEFAULT 0,
      has_question INTEGER DEFAULT 0,
      has_link INTEGER DEFAULT 0,
      has_emoji INTEGER DEFAULT 0,
      exclamation_count INTEGER DEFAULT 0,
      is_all_caps INTEGER DEFAULT 0,
      word_count INTEGER DEFAULT 0,
      char_count INTEGER DEFAULT 0,
      heat_score INTEGER DEFAULT 0,
      sentiment INTEGER DEFAULT 0,
      analyzed_version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_msgsig_chat ON message_signals(chat_identifier);
    CREATE INDEX IF NOT EXISTS idx_msgsig_sent ON message_signals(sent_at);

    CREATE TABLE IF NOT EXISTS message_analysis_progress (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_signals (
      chat_identifier TEXT PRIMARY KEY,
      total_analyzed INTEGER DEFAULT 0,
      laugh_count INTEGER DEFAULT 0,
      question_count INTEGER DEFAULT 0,
      link_count INTEGER DEFAULT 0,
      emoji_rate REAL DEFAULT 0,
      avg_word_count REAL DEFAULT 0,
      avg_heat REAL DEFAULT 0,
      positive_rate REAL DEFAULT 0,
      negative_rate REAL DEFAULT 0,
      all_caps_rate REAL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `)

  // Backfill null chat_name from Messages chat.db
  // Skip if a previous attempt found 0 fixable records
  try {
    db.exec("CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)")
    const skipFlag = db.prepare("SELECT value FROM _meta WHERE key = 'backfill_done'").get() as { value: string } | undefined
    const nullCount = skipFlag ? 0 : (db.prepare("SELECT COUNT(*) as c FROM attachments WHERE chat_name IS NULL OR chat_name = ''").get() as { c: number }).c
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
          if (fixed === 0) {
            try { db.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('backfill_done', '1')").run() } catch { /* ignore */ }
          }
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

      // Laugh detection — cached per session
      // METHOD 1: Text-based (lol, haha, 😂, etc.) — no time window, no sequential requirement
      // METHOD 2: Tapback reactions (associated_message_type 2003 = "Laughed at")
      if (!laughCacheValid) {
        try {
          const LAUGH_RE = /\b(lol|lmao|lmfao|rofl|hehe|omg dead|im dead|i'm dead|i cant|i can't|dying|i'm dying|im dying)\b|ha{2,}|he{2,}/i
          const LAUGH_EMOJI = /[\u{1F602}\u{1F923}\u{1F480}\u{2620}]/u

          laughCache.clear()

          // Method 1: Text-based laughs (simplified — no window functions, no time filter)
          const laughRows = chatDb.prepare(`
            SELECT c.chat_identifier as chat_name, m.is_from_me, m.text
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            JOIN chat c ON cmj.chat_id = c.ROWID
            WHERE m.text IS NOT NULL
              AND (
                m.text LIKE '%lol%' OR m.text LIKE '%lmao%' OR m.text LIKE '%haha%'
                OR m.text LIKE '%hehe%' OR m.text LIKE '%rofl%' OR m.text LIKE '%lmfao%'
                OR m.text LIKE '%im dead%' OR m.text LIKE '%i cant%'
                OR m.text LIKE '%dying%'
                OR m.text LIKE '%😂%' OR m.text LIKE '%🤣%' OR m.text LIKE '%💀%' OR m.text LIKE '%☠️%'
              )
          `).all() as { chat_name: string; is_from_me: number; text: string }[]

          for (const row of laughRows) {
            const isLaugh = LAUGH_RE.test(row.text) || LAUGH_EMOJI.test(row.text)
            if (!isLaugh) continue
            if (!laughCache.has(row.chat_name)) laughCache.set(row.chat_name, { generated: 0, received: 0 })
            const entry = laughCache.get(row.chat_name)!
            // is_from_me=1 + laugh text = I laughed = I received humor from them
            // is_from_me=0 + laugh text = they laughed = I generated humor
            if (row.is_from_me === 1) entry.received++
            else entry.generated++
          }
          console.log(`[Laugh] Text-based: ${laughCache.size} conversations`)

          // Method 2: Tapback "Laughed at" reactions (associated_message_type 2003)
          try {
            const tapbackRows = chatDb.prepare(`
              SELECT c.chat_identifier as chat_name, m.is_from_me
              FROM message m
              JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
              JOIN chat c ON cmj.chat_id = c.ROWID
              WHERE m.associated_message_type = 2003
            `).all() as { chat_name: string; is_from_me: number }[]

            let tapbackCount = 0
            for (const row of tapbackRows) {
              if (!laughCache.has(row.chat_name)) laughCache.set(row.chat_name, { generated: 0, received: 0 })
              const entry = laughCache.get(row.chat_name)!
              // is_from_me=1 = I tapback-laughed at their message = I received humor
              // is_from_me=0 = they tapback-laughed at my message = I generated humor
              if (row.is_from_me === 1) entry.received++
              else entry.generated++
              tapbackCount++
            }
            console.log(`[Laugh] Tapback reactions: ${tapbackCount} across ${laughCache.size} conversations`)
          } catch { /* tapback query may fail on older chat.db schemas */ }

          laughCacheValid = true
          console.log(`[Laugh] Total cached: ${laughCache.size} conversations`)
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
      // Resolve group names: display_name > derived from top participants
      const grpMsgByHandle = chatDb.prepare(`
        SELECT c.chat_identifier as chat_id, h.id as handle_id, COUNT(*) as cnt
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) > 1
          AND m.is_from_me = 0 AND h.id IS NOT NULL
        GROUP BY c.chat_identifier, h.id
      `).all() as { chat_id: string; handle_id: string; cnt: number }[]

      const chatTopParticipants = new Map<string, string[]>()
      {
        const chatHandleCounts = new Map<string, { handle: string; cnt: number }[]>()
        for (const r of grpMsgByHandle) {
          if (!chatHandleCounts.has(r.chat_id)) chatHandleCounts.set(r.chat_id, [])
          chatHandleCounts.get(r.chat_id)!.push({ handle: r.handle_id, cnt: r.cnt })
        }
        for (const [chatId, handles] of chatHandleCounts) {
          handles.sort((a, b) => b.cnt - a.cnt)
          chatTopParticipants.set(chatId, handles.slice(0, 3).map(h => h.handle))
        }
      }

      const resolveGroupName = (chatId: string): string => {
        const display = chatNameDb.get(chatId)
        if (display && display.length > 1 && !display.startsWith('+')) return display
        const participants = chatTopParticipants.get(chatId)
        if (participants && participants.length > 0) {
          return participants.length <= 2
            ? participants.join(' + ')
            : participants.slice(0, 3).join(', ')
        }
        const members = chatToHandles.get(chatId)
        if (members && members.size > 0) {
          const arr = [...members].slice(0, 3)
          return arr.length <= 2 ? arr.join(' + ') : arr.join(', ')
        }
        return chatId
      }

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
        const top5 = chats.slice(0, 5).map(c => ({ name: resolveGroupName(c.handle), count: c.cnt, pct: Math.round((c.cnt / total) * 100) }))
        const dominant = top5[0]
        // For groups, cluster = participants of the dominant group chat
        const rawDomId = chats[0].handle
        const members = chatTopParticipants.get(rawDomId) || (chatToHandles.has(rawDomId) ? [...chatToHandles.get(rawDomId)!].slice(0, 5) : [])
        const clusterContacts = members.slice(0, 5)
        const clusterLabel = chatNameDb.get(rawDomId) || null
        groupYears.push({ year, dominant, top5, clusterContacts, clusterLabel })
      }
    } finally {
      try { chatDb.close() } catch { /* ignore */ }
    }
  } catch { /* fallback */ }
  return { individualYears, groupYears }
}

export interface TopicChapter {
  startYear: number
  endYear: number
  topicLabel: string
  keywords: string[]
  strengthScore: number
}

// ── Topic Eras: signal-based theme detection ──

const TOPIC_STOPS = new Set([
  // pronouns, articles, prepositions, conjunctions
  'i','me','my','myself','we','our','ours','ourselves','you','your','yours','yourself','yourselves',
  'he','him','his','himself','she','her','hers','herself','it','its','itself','they','them','their',
  'theirs','themselves','what','which','who','whom','this','that','these','those','am','is','are',
  'was','were','be','been','being','have','has','had','having','do','does','did','doing','a','an',
  'the','and','but','if','or','because','as','until','while','of','at','by','for','with','about',
  'against','between','through','during','before','after','above','below','to','from','up','down',
  'in','out','on','off','over','under','again','further','then','once','here','there','when',
  'where','why','how','all','both','each','few','more','most','other','some','such','no','nor',
  'not','only','own','same','so','than','too','very','can','will','just','don','should',
  'now','ain','aren','couldn','didn','doesn','hadn','hasn','haven','isn','mightn','mustn',
  'needn','shan','shouldn','wasn','weren','won','wouldn',
  // chat noise
  'yeah','yea','yes','ok','okay','like','lol','haha','hahaha','ha','oh','ah','um','uh','hmm',
  'gonna','gotta','wanna','idk','lmao','omg','brb','btw','tbh','imo','smh','nah','yep','nope',
  'hey','hi','hello','bye','thanks','thank','sorry','please','good','great','nice','cool',
  // ultra-common verbs / fillers
  'got','get','go','going','went','come','came','know','think','said','say','see','look',
  'want','need','let','make','made','take','took','thing','things','stuff','really','pretty',
  'much','well','back','still','even','also','way','today','tomorrow','yesterday',
  'one','two','three','right','would','could','might','actually','literally','basically',
  'something','anything','nothing','everything','someone','anyone','everyone','people',
  'guy','girl','day','week','month','year','tonight','morning','night','feel','lot','bit',
  'sure','maybe','probably','already','though','thought','kind','keep','first','last',
  'try','put','tell','told','give','gave','call','text','send','sent','message','chat',
  'phone','pic','photo','video','link','app','wait','done','start','stop','never','always',
  'every','enough','damn','shit','fuck','ass','hell','dude','bro','yo','sup','hehe','wow',
  'aww','left','find','found','point','part','end','head','hand','set','world','life',
  'play','run','move','live','bring','happen','write','sit','stand','lose','pay','meet',
  'change','lead','understand','watch','follow','turn','leave','close','open','show',
  'hear','seem','help','talk','read','ask','love','miss','hate','bad','best','worst',
  'hard','easy','fun','funny','weird','crazy','new','old','big','little','long','real',
  'whole','home','house','place','room','car','food','eat','dinner','lunch','drink',
  'water','coffee','man','time','work','gonna','think','know','just','like','really',
  'getting','looking','coming','doing','saying','making','taking','having','being',
  'hahah','hahahaha','lmfao','soo','soooo','tho','rn','thats','dont','cant','wont',
  'didnt','doesnt','isnt','wasnt','havent','wouldnt','couldnt','shouldnt','aint',
  'ima','imma','til','bout','gon','tryna','kinda','sorta','lemme','trynna'
])

// Concept clusters: related keywords → human-readable label
const CONCEPT_MAP: [string, string[]][] = [
  ['Golf', ['golf','tee','fairway','birdie','bogey','handicap','putter','wedge','driving range','par','clubhouse','nine holes','eighteen','back nine','front nine']],
  ['Cycling', ['bike','cycling','ride','biking','peloton','strava','miles','cadence','pedal','velodrome','century ride']],
  ['Running', ['running','marathon','half marathon','5k','10k','pace','splits','tempo run','trail run','treadmill','jogging']],
  ['Fitness', ['gym','workout','lifting','weights','bench','squat','deadlift','crossfit','hiit','sets','reps','gains','protein','creatine','muscle']],
  ['Surfing', ['surf','surfing','swell','waves','board','wetsuit','lineup','barrel','offshore']],
  ['Skiing', ['ski','skiing','snowboard','powder','slope','moguls','chairlift','apres','resort']],
  ['Hiking', ['hike','hiking','trail','summit','backpacking','elevation','campsite','switchback']],
  ['Climbing', ['climbing','bouldering','belay','crag','route','v-grade','send','crimp']],
  ['Tennis', ['tennis','racket','serve','volley','match point','deuce','forehand','backhand']],
  ['Basketball', ['basketball','hoops','court','dunk','three pointer','pickup game','layup']],
  ['Soccer', ['soccer','football','pitch','goal','match','league','premier league']],
  ['Baseball', ['baseball','batting','pitcher','home run','inning','diamond','dugout']],
  ['Fantasy Sports', ['fantasy','draft','waiver','roster','lineup','trade','sleeper','bust','matchup']],
  ['Fishing', ['fishing','bass','trout','casting','lure','tackle','reel','catch','fly fishing']],
  ['Travel', ['travel','flight','airport','hotel','airbnb','passport','trip','vacation','resort','itinerary','boarding pass']],
  ['Camping', ['camping','tent','campfire','campground','rv','glamping','firewood','s\'mores']],
  ['Music', ['guitar','bass','drums','band','rehearsal','gig','album','recording','studio','mixing','songwriting','setlist','amp','pedal','synth']],
  ['Music Listening', ['spotify','playlist','album','concert','festival','tickets','venue','setlist','opener','headliner']],
  ['Photography', ['photography','camera','lens','shoot','aperture','lightroom','editing','portrait','landscape']],
  ['Gaming', ['gaming','game','xbox','playstation','nintendo','steam','fortnite','warzone','valorant','minecraft','controller','multiplayer','ranked','gg']],
  ['Cooking', ['cooking','recipe','baking','kitchen','ingredient','meal prep','seasoning','grill','bbq','smoker','sous vide']],
  ['Coding', ['code','coding','programming','github','deploy','api','database','frontend','backend','javascript','python','react','bug','debug','pull request','merge']],
  ['Startup', ['startup','launch','funding','investor','pitch','mvp','product','users','growth','revenue','equity','valuation']],
  ['Career', ['interview','resume','offer','salary','promotion','manager','meeting','deadline','quarterly','performance review','onboarding']],
  ['Real Estate', ['house','apartment','mortgage','closing','realtor','listing','offer','inspection','escrow','rent','lease']],
  ['Wedding', ['wedding','engaged','engagement','venue','reception','ceremony','bridesmaid','groomsman','registry','rehearsal dinner']],
  ['Baby', ['baby','pregnant','pregnancy','nursery','stroller','diaper','ultrasound','due date','onesie','pediatrician']],
  ['Pets', ['dog','puppy','cat','kitten','vet','walk','treats','fetch','leash','adoption']],
  ['Crypto', ['crypto','bitcoin','ethereum','blockchain','wallet','nft','token','defi','mining','hodl']],
  ['Investing', ['investing','stocks','portfolio','dividend','market','etf','401k','ira','broker','shares']],
  ['School', ['class','professor','exam','midterm','final','homework','semester','campus','lecture','study','grade','gpa']],
  ['Grad School', ['thesis','dissertation','advisor','research','phd','masters','defend','publish','journal','conference']],
  ['Movies', ['movie','film','theater','cinema','director','trailer','screening','oscar','sequel','streaming']],
  ['TV Shows', ['episode','season','series','binge','finale','premiere','showrunner','netflix','hbo']],
  ['Reading', ['book','reading','novel','author','chapter','kindle','library','nonfiction','memoir','audiobook']],
  ['Yoga', ['yoga','meditation','mindfulness','pose','mat','vinyasa','breathwork','chakra','zen']],
  ['Martial Arts', ['martial arts','bjj','jiu jitsu','karate','boxing','sparring','belt','dojo','kickboxing','mma']],
  ['Boating', ['boat','sailing','marina','dock','anchor','charter','yacht','catamaran','kayak']],
  ['Cars', ['car','truck','engine','horsepower','turbo','exhaust','modification','track day','autocross','dyno']],
  ['Fashion', ['outfit','style','brand','sneakers','drop','collection','designer','thrift','vintage']],
  ['Art', ['painting','drawing','gallery','exhibition','canvas','sculpture','sketch','commission','mural']],
  ['Podcast', ['podcast','episode','host','guest','listener','recording','mic','audio']],
  ['Volunteer', ['volunteer','charity','donation','nonprofit','community service','fundraiser']],
  ['Moving', ['moving','packing','boxes','new place','lease','movers','unpacking','neighborhood']],
  ['Renovation', ['renovation','remodel','contractor','tile','flooring','paint','cabinet','plumbing','drywall']],
  ['Gardening', ['garden','plant','soil','seeds','compost','harvest','tomato','herb','landscaping']],
  ['Board Games', ['board game','catan','settlers','strategy','dice','tabletop','game night']],
  ['D&D', ['dnd','d&d','dungeon','campaign','character','roll','dm','session','quest']],
  ['Wine', ['wine','vineyard','tasting','cabernet','pinot','chardonnay','sommelier','bottle']],
  ['Beer', ['beer','brewery','ipa','craft','hops','lager','stout','taproom','homebrew']],
  ['Spirits', ['whiskey','bourbon','cocktail','bartender','neat','rocks','distillery','tequila','mezcal']],
]

// Domain → topic signal
const DOMAIN_TOPICS: Record<string, string[]> = {
  'spotify.com': ['music listening','spotify'],
  'youtube.com': ['video','youtube'],
  'youtu.be': ['video','youtube'],
  'strava.com': ['fitness','strava','cycling','running'],
  'zillow.com': ['real estate','house'],
  'redfin.com': ['real estate','house'],
  'airbnb.com': ['travel','airbnb'],
  'github.com': ['coding','github'],
  'stackoverflow.com': ['coding'],
  'netflix.com': ['tv shows','streaming'],
  'alltrails.com': ['hiking','trail'],
  'soundcloud.com': ['music','soundcloud'],
  'bandcamp.com': ['music','bandcamp'],
  'twitch.tv': ['gaming','streaming'],
  'espn.com': ['sports'],
  'fantasy.espn.com': ['fantasy sports'],
  'sleeper.com': ['fantasy sports'],
  'yahoo.com/fantasy': ['fantasy sports'],
}

export function getTopicEras(): { chapters: TopicChapter[] } {
  const chapters: TopicChapter[] = []
  try {
    const d = initDb()
    const hasMessages = (d.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
    if (hasMessages < 100) return { chapters }

    const currentYear = new Date().getFullYear()

    // ── Build comprehensive name set ──
    const nameTokens = new Set<string>()
    try {
      for (const table of ['messages', 'attachments']) {
        try {
          const rows = d.prepare(`SELECT DISTINCT chat_name FROM ${table} WHERE chat_name IS NOT NULL`).all() as { chat_name: string }[]
          for (const r of rows) for (const p of r.chat_name.replace(/[^a-zA-Z\s]/g, ' ').toLowerCase().split(/\s+/)) if (p.length >= 2) nameTokens.add(p)
        } catch { /* table may not exist */ }
      }
      const handles = d.prepare(`SELECT DISTINCT sender_handle FROM messages WHERE sender_handle IS NOT NULL`).all() as { sender_handle: string }[]
      for (const r of handles) for (const p of r.sender_handle.replace(/[^a-zA-Z\s]/g, ' ').toLowerCase().split(/\s+/)) if (p.length >= 2) nameTokens.add(p)
      // Resolve contact names via Swift helper if available
      try {
        const { compileContactsHelper, resolveContactsBatch } = require('./contacts')
        compileContactsHelper()
        const allHandleIds = [...new Set(handles.map(h => h.sender_handle))]
        const resolved = resolveContactsBatch(allHandleIds) as Record<string, string>
        for (const name of Object.values(resolved)) {
          for (const p of name.replace(/[^a-zA-Z\s]/g, ' ').toLowerCase().split(/\s+/)) if (p.length >= 2) nameTokens.add(p)
        }
      } catch { /* contacts helper may not be available */ }
    } catch { /* ignore */ }

    // ── Synonym map: normalize variants to canonical form ──
    const SYNONYMS: Record<string, string> = {}
    for (const [label, kws] of CONCEPT_MAP) {
      const canonical = kws[0]
      for (const kw of kws) if (kw !== canonical && !kw.includes(' ')) SYNONYMS[kw] = canonical
    }
    // Common plural/verb forms
    const simpleStem = (w: string): string => {
      if (w.endsWith('ing') && w.length > 5) { const base = w.slice(0, -3); if (SYNONYMS[base]) return SYNONYMS[base]; return base }
      if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
      if (w.endsWith('es') && w.length > 4 && !w.endsWith('ses')) return w.slice(0, -2)
      if (w.endsWith('s') && w.length > 4 && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
      return w
    }
    const normalize = (w: string): string => {
      if (SYNONYMS[w]) return SYNONYMS[w]
      const stemmed = simpleStem(w)
      if (SYNONYMS[stemmed]) return SYNONYMS[stemmed]
      return stemmed
    }

    // ── Token validation ──
    const SYSTEM_PATTERNS = [
      /^img[_-]?\d/i, /^dsc[_-]?\d/i, /^screenshot/i, /^fullsizerender/i,
      /^image\d/i, /^photo\d/i, /^video\d/i, /^file\d/i, /^attachment/i,
      /^[a-f0-9]{8,}$/i, /^[a-z]{1,2}\d{3,}/i, /^tmp/i, /^temp/i,
      /^screen\s?shot/i, /^img$/i, /^mov$/i, /^jpeg$/i, /^heic$/i, /^png$/i,
      /^\w*\d{4,}\w*$/, // tokens with 4+ consecutive digits
    ]
    const isGarbage = (w: string): boolean => {
      if (w.length < 3 || w.length > 22) return true
      if (/\d/.test(w)) return true // contains any digit
      if (!/[aeiou]/i.test(w) && w.length > 3) return true // no vowels
      if (/(.)\1{2,}/.test(w)) return true // repeated chars
      if (/[A-Z]/.test(w) && /[a-z]/.test(w) && w !== w.toLowerCase()) return true // camelCase before lowering
      for (const pat of SYSTEM_PATTERNS) if (pat.test(w)) return true
      return false
    }
    const isValid = (w: string): boolean => {
      if (w.length < 3) return false
      if (TOPIC_STOPS.has(w)) return false
      if (nameTokens.has(w)) return false
      return true
    }

    // ── Collect signals per year with cross-chat + month tracking ──
    type Signal = { count: number; chats: Set<string>; months: Set<string> }
    const yearSignals = new Map<number, Map<string, Signal>>()
    const addSig = (year: number, term: string, chat: string, month: string) => {
      if (!yearSignals.has(year)) yearSignals.set(year, new Map())
      const m = yearSignals.get(year)!
      if (!m.has(term)) m.set(term, { count: 0, chats: new Set(), months: new Set() })
      const s = m.get(term)!
      s.count++; s.chats.add(chat); s.months.add(month)
    }

    // ── Signal 1: Message text ──
    const msgRows = d.prepare(`
      SELECT CAST(strftime('%Y', sent_at) AS INTEGER) as year,
             strftime('%Y-%m', sent_at) as month, chat_name, body
      FROM messages WHERE body IS NOT NULL AND length(body) > 3
    `).all() as { year: number; month: string; chat_name: string; body: string }[]

    for (const r of msgRows) {
      if (r.year < 2006 || r.year > currentYear) continue
      const chat = r.chat_name || '__unknown'
      const raw = r.body.toLowerCase()
      const text = raw.replace(/[^a-z\s'-]/g, ' ')
      const words = text.split(/\s+/).filter(w => w.length >= 3 && w.length <= 22 && !/\d/.test(w))

      for (const w of words) {
        if (!isValid(w)) continue
        const norm = normalize(w)
        if (norm.length >= 3 && isValid(norm)) addSig(r.year, norm, chat, r.month)
      }
      // Bigrams
      for (let j = 0; j < words.length - 1; j++) {
        if (!isValid(words[j]) || !isValid(words[j + 1])) continue
        addSig(r.year, `${normalize(words[j])} ${normalize(words[j + 1])}`, chat, r.month)
      }
      // Link domains
      const urls = raw.match(/https?:\/\/[^\s]+/gi) || []
      for (const url of urls) {
        try {
          const domain = url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')
          for (const [dom, topics] of Object.entries(DOMAIN_TOPICS)) {
            if (domain.includes(dom.split('.')[0])) for (const t of topics) addSig(r.year, t, chat, r.month)
          }
        } catch { /* skip */ }
      }
    }

    // ── Signal 2: Attachment filenames ──
    try {
      const attRows = d.prepare(`
        SELECT CAST(strftime('%Y', created_at) AS INTEGER) as year,
               strftime('%Y-%m', created_at) as month, chat_name, filename
        FROM attachments WHERE filename IS NOT NULL
      `).all() as { year: number; month: string; chat_name: string | null; filename: string }[]
      for (const r of attRows) {
        if (r.year < 2006 || r.year > currentYear) continue
        const chat = r.chat_name || '__unknown'
        const base = r.filename.replace(/\.[^.]+$/, '').toLowerCase()
        if (isGarbage(base)) continue
        const fnWords = base.replace(/[^a-z]/g, ' ').split(/\s+/)
        for (const w of fnWords) {
          if (w.length >= 4 && isValid(w) && !isGarbage(w)) addSig(r.year, normalize(w), chat, r.month)
        }
      }
    } catch { /* ignore */ }

    // ── Filter: require multi-chat presence + minimum count ──
    for (const [, sigs] of yearSignals) {
      for (const [term, sig] of [...sigs.entries()]) {
        if (sig.count < 5 || sig.chats.size < 2 || sig.months.size < 2) sigs.delete(term)
      }
    }

    // ── Score per year ──
    const globalTermYears = new Map<string, number>()
    for (const sigs of yearSignals.values()) for (const term of sigs.keys()) globalTermYears.set(term, (globalTermYears.get(term) || 0) + 1)
    const totalYearCount = yearSignals.size

    const yearTopics = new Map<number, { term: string; score: number }[]>()
    for (const [year, sigs] of [...yearSignals.entries()].sort((a, b) => a[0] - b[0])) {
      const scored: { term: string; score: number }[] = []
      for (const [term, sig] of sigs) {
        const chatW = Math.min(sig.chats.size, 5)
        const monthW = Math.min(sig.months.size, 8) / 3
        const termYrs = globalTermYears.get(term) || 1
        const idf = Math.log((totalYearCount + 1) / termYrs)
        const phraseW = term.includes(' ') ? 2.5 : 1
        let conceptW = 1
        for (const [, kws] of CONCEPT_MAP) { if (kws.includes(term)) { conceptW = 3; break } }
        scored.push({ term, score: sig.count * chatW * monthW * idf * phraseW * conceptW })
      }
      scored.sort((a, b) => b.score - a.score)
      if (scored.length >= 3) yearTopics.set(year, scored.slice(0, 15))
    }

    // ── Label from keywords ──
    const labelFor = (keywords: string[]): string | null => {
      let bestLabel = '', bestScore = 0
      for (const [label, conceptKws] of CONCEPT_MAP) {
        let score = 0
        for (const kw of keywords) {
          if (conceptKws.includes(kw)) score += 3
          for (const ck of conceptKws) { if (kw.length >= 4 && ck.length >= 4 && (kw.includes(ck) || ck.includes(kw))) score += 1 }
        }
        if (score > bestScore) { bestScore = score; bestLabel = label }
      }
      if (bestScore >= 4) return bestLabel
      // Strict fallback: only if top keyword is clean and long enough
      const top = keywords[0]
      if (top && top.length >= 5 && !top.includes(' ') && !TOPIC_STOPS.has(top) && !nameTokens.has(top) && /^[a-z]+$/.test(top)) {
        return top.charAt(0).toUpperCase() + top.slice(1)
      }
      return null // signal too weak — skip era
    }

    // ── Build eras with stricter splitting ──
    const sortedYears = [...yearTopics.keys()].sort((a, b) => a - b)
    if (sortedYears.length === 0) return { chapters }

    const topTermSet = (year: number) => new Set(yearTopics.get(year)!.slice(0, 6).map(t => t.term))

    let cur = { start: sortedYears[0], end: sortedYears[0], terms: topTermSet(sortedYears[0]), scored: [...yearTopics.get(sortedYears[0])!.slice(0, 8)] }

    const flush = () => {
      const kws = cur.scored.sort((a, b) => b.score - a.score).slice(0, 8).map(t => t.term)
      if (kws.length < 3) return
      const label = labelFor(kws)
      if (!label) return
      const strength = cur.scored.slice(0, 5).reduce((s, t) => s + t.score, 0)
      if (strength < 50) return
      // Deduplicate display keywords
      const display: string[] = []
      for (const kw of kws) {
        if (display.length >= 5) break
        if (!kw.includes(' ') && display.some(dk => dk.includes(kw))) continue
        display.push(kw)
      }
      if (display.length < 2) return
      chapters.push({ startYear: cur.start, endYear: cur.end, topicLabel: label, keywords: display, strengthScore: Math.round(strength) })
    }

    for (let i = 1; i < sortedYears.length; i++) {
      const year = sortedYears[i]
      const terms = topTermSet(year)
      // Stricter: need 3+ overlap from top 6 to merge
      const overlap = [...terms].filter(t => cur.terms.has(t)).length
      if (overlap >= 3) {
        cur.end = year
        for (const t of terms) cur.terms.add(t)
        cur.scored.push(...yearTopics.get(year)!.slice(0, 8))
      } else {
        flush()
        cur = { start: year, end: year, terms: topTermSet(year), scored: [...yearTopics.get(year)!.slice(0, 8)] }
      }
    }
    flush()

    // Chronological order, cap at 8 eras max
    chapters.sort((a, b) => a.startYear - b.startYear)
    if (chapters.length > 8) chapters.splice(8)
  } catch { /* fallback */ }
  return { chapters }
}

export interface MemoryMoment {
  type: 'on_this_day' | 'first_message' | 'biggest_day' | 'biggest_month' | 'streak' | 'intensity_echo' | 'comeback' | 'fading' | 'streak_anniversary' | 'heat_peak'
  title: string
  subtitle: string
  dateLabel: string
  chatName: string | null
  metric: number | null
}

export function getMemoryMoments(): { moments: MemoryMoment[] } {
  const moments: MemoryMoment[] = []
  try {
    const { homedir } = require('os')
    const { join } = require('path')
    const fs = require('fs')
    const chatDbPath = join(homedir(), 'Library/Messages/chat.db')
    if (!fs.existsSync(chatDbPath)) return { moments }

    const chatDb = new Database(chatDbPath, { readonly: true })
    const APPLE_EPOCH = 978307200
    const NS = 1000000000
    const now = new Date()
    const todayMD = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const currentYear = now.getFullYear()
    const MONTH_NAMES_MEM = ['January','February','March','April','May','June','July','August','September','October','November','December']

    try {
      // ── 1. On This Day: find prior-year activity on same month-day ──
      const onThisDay = chatDb.prepare(`
        SELECT CAST(strftime('%Y', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) as year,
               c.chat_identifier as chat_id, COUNT(*) as cnt
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE strftime('%m-%d', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) = ?
          AND CAST(strftime('%Y', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) AS INTEGER) < ${currentYear}
        GROUP BY year, c.chat_identifier
        ORDER BY cnt DESC LIMIT 5
      `).all(todayMD) as { year: number; chat_id: string; cnt: number }[]

      if (onThisDay.length > 0) {
        const best = onThisDay[0]
        const yearsAgo = currentYear - best.year
        moments.push({
          type: 'on_this_day',
          title: 'On This Day',
          subtitle: `${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago today, you exchanged ${best.cnt} messages.`,
          dateLabel: `${MONTH_NAMES_MEM[now.getMonth()]} ${now.getDate()}, ${best.year}`,
          chatName: best.chat_id,
          metric: best.cnt
        })
      }

      // ── 2. First Message Anniversary: find contacts whose first message date is near today ──
      const anniversaries = chatDb.prepare(`
        SELECT c.chat_identifier as chat_id,
               MIN(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as first_date
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        GROUP BY c.chat_identifier
        HAVING first_date IS NOT NULL
      `).all() as { chat_id: string; first_date: string }[]

      let bestAnniv: { chat_id: string; year: number; dayDiff: number } | null = null
      for (const r of anniversaries) {
        const d = new Date(r.first_date)
        if (isNaN(d.getTime())) continue
        const year = d.getFullYear()
        if (year >= currentYear) continue
        // Check if anniversary is within 7 days of today
        const annivThisYear = new Date(currentYear, d.getMonth(), d.getDate())
        const diff = Math.abs(now.getTime() - annivThisYear.getTime()) / 86400000
        if (diff <= 7 && (!bestAnniv || year < bestAnniv.year)) {
          bestAnniv = { chat_id: r.chat_id, year, dayDiff: Math.round(diff) }
        }
      }
      if (bestAnniv) {
        const yearsAgo = currentYear - bestAnniv.year
        const fd = anniversaries.find(a => a.chat_id === bestAnniv!.chat_id)
        const firstDate = fd ? new Date(fd.first_date) : null
        const monthName = firstDate ? MONTH_NAMES_MEM[firstDate.getMonth()] : ''
        moments.push({
          type: 'first_message',
          title: 'First Message Anniversary',
          subtitle: `You first texted this contact ${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago${monthName ? `, in ${monthName} ${bestAnniv.year}` : ''}.`,
          dateLabel: firstDate ? `${monthName} ${firstDate.getDate()}, ${bestAnniv.year}` : String(bestAnniv.year),
          chatName: bestAnniv.chat_id,
          metric: yearsAgo
        })
      }

      // ── 3. Biggest Day Ever ──
      const biggestDay = chatDb.prepare(`
        SELECT date(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d,
               COUNT(*) as cnt
        FROM message m
        WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1) AND m.item_type = 0
        GROUP BY d ORDER BY cnt DESC LIMIT 1
      `).get() as { d: string; cnt: number } | undefined

      if (biggestDay && biggestDay.cnt > 50) {
        const bd = new Date(biggestDay.d + 'T12:00:00')
        // Find dominant contact for that day
        let bigDayContact: string | null = null
        try {
          const dayContact = chatDb.prepare(`SELECT c.chat_identifier as chat_id, COUNT(*) as cnt FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id JOIN chat c ON cmj.chat_id = c.ROWID WHERE date(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) = ? GROUP BY c.chat_identifier ORDER BY cnt DESC LIMIT 1`).get(biggestDay.d) as { chat_id: string; cnt: number } | undefined
          if (dayContact) bigDayContact = dayContact.chat_id
        } catch { /* ignore */ }
        moments.push({
          type: 'biggest_day',
          title: 'Biggest Day',
          subtitle: `${biggestDay.cnt.toLocaleString()} messages exchanged in a single day.`,
          dateLabel: bd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          chatName: bigDayContact,
          metric: biggestDay.cnt
        })
      }

      // ── 4. Biggest Month Ever ──
      const biggestMonth = chatDb.prepare(`
        SELECT strftime('%Y-%m', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as ym,
               COUNT(*) as cnt
        FROM message m
        WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1) AND m.item_type = 0
        GROUP BY ym ORDER BY cnt DESC LIMIT 1
      `).get() as { ym: string; cnt: number } | undefined

      if (biggestMonth && biggestMonth.cnt > 200) {
        const [y, mo] = biggestMonth.ym.split('-').map(Number)
        let bigMonthContact: string | null = null
        try {
          const monthContact = chatDb.prepare(`SELECT c.chat_identifier as chat_id, COUNT(*) as cnt FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id JOIN chat c ON cmj.chat_id = c.ROWID WHERE strftime('%Y-%m', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) = ? GROUP BY c.chat_identifier ORDER BY cnt DESC LIMIT 1`).get(biggestMonth.ym) as { chat_id: string; cnt: number } | undefined
          if (monthContact) bigMonthContact = monthContact.chat_id
        } catch { /* ignore */ }
        moments.push({
          type: 'biggest_month',
          title: 'Biggest Month',
          subtitle: `${biggestMonth.cnt.toLocaleString()} messages in your busiest month ever.`,
          dateLabel: `${MONTH_NAMES_MEM[mo - 1]} ${y}`,
          chatName: bigMonthContact,
          metric: biggestMonth.cnt
        })
      }

      // ── 5. Longest Streak (across all contacts) ──
      const streakRows = chatDb.prepare(`
        SELECT c.chat_identifier as chat_id,
               date(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) = 1
        GROUP BY c.chat_identifier, d
        ORDER BY c.chat_identifier, d
      `).all() as { chat_id: string; d: string }[]

      let bestStreak = { chat: '', length: 0, startDate: '' }
      {
        let curChat = '', curLen = 1, curStart = '', prevDate = ''
        for (const r of streakRows) {
          if (r.chat_id !== curChat) { curChat = r.chat_id; curLen = 1; curStart = r.d; prevDate = r.d; continue }
          const diff = (new Date(r.d).getTime() - new Date(prevDate).getTime()) / 86400000
          if (diff === 1) { curLen++; if (curLen > bestStreak.length) bestStreak = { chat: curChat, length: curLen, startDate: curStart } }
          else { curLen = 1; curStart = r.d }
          prevDate = r.d
        }
      }

      if (bestStreak.length >= 14) {
        const sd = new Date(bestStreak.startDate + 'T12:00:00')
        moments.push({
          type: 'streak',
          title: 'Longest Streak',
          subtitle: `${bestStreak.length} consecutive days of messaging.`,
          dateLabel: `Started ${sd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
          chatName: bestStreak.chat,
          metric: bestStreak.length
        })
      }

      // ── 6. Intensity Echo: compare recent 30-day volume to historical peaks ──
      const thirtyDaysAgo = (Date.now() / 1000 - APPLE_EPOCH - 30 * 86400) * NS
      const recentByChat = chatDb.prepare(`
        SELECT c.chat_identifier as chat_id, COUNT(*) as cnt
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.date >= ${thirtyDaysAgo} AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) = 1
        GROUP BY c.chat_identifier ORDER BY cnt DESC LIMIT 3
      `).all() as { chat_id: string; cnt: number }[]

      for (const recent of recentByChat) {
        if (recent.cnt < 100) continue
        // Find this contact's historical peak month
        const chatIds2 = chatDb.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').all(recent.chat_id) as { ROWID: number }[]
        if (chatIds2.length === 0) continue
        const idList2 = chatIds2.map(r => r.ROWID).join(',')
        const peakMonth = chatDb.prepare(`
          SELECT strftime('%Y-%m', datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as ym, COUNT(*) as cnt
          FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          WHERE cmj.chat_id IN (${idList2})
          GROUP BY ym ORDER BY cnt DESC LIMIT 1
        `).get() as { ym: string; cnt: number } | undefined
        if (peakMonth) {
          const [py, pm] = peakMonth.ym.split('-').map(Number)
          const peakDate = new Date(py, pm - 1)
          const monthsAgo = (currentYear - py) * 12 + (now.getMonth() - (pm - 1))
          if (monthsAgo > 3 && recent.cnt > peakMonth.cnt * 0.5) {
            moments.push({
              type: 'intensity_echo',
              title: 'Familiar Intensity',
              subtitle: `You haven't talked like this since ${MONTH_NAMES_MEM[pm - 1]} ${py}.`,
              dateLabel: 'Last 30 days',
              chatName: recent.chat_id,
              metric: recent.cnt
            })
            break // only one echo
          }
        }
      }

      // ── 7. Comeback: someone silent for 60+ days who returned in last 14 days ──
      try {
        const fourteenDaysAgo = (Date.now() / 1000 - APPLE_EPOCH - 14 * 86400) * NS
        const comebackCandidates = chatDb.prepare(`
          SELECT c.chat_identifier as chat_id, COUNT(*) as total,
            MAX(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as last_msg
          FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          JOIN chat c ON cmj.chat_id = c.ROWID
          WHERE (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) = 1
          GROUP BY c.chat_identifier HAVING total >= 50
        `).all() as { chat_id: string; total: number; last_msg: string }[]

        for (const c of comebackCandidates) {
          // Check for recent activity
          const recentCount = (chatDb.prepare(`SELECT COUNT(*) as cnt FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id JOIN chat ch ON cmj.chat_id = ch.ROWID WHERE ch.chat_identifier = ? AND m.date >= ${fourteenDaysAgo}`).get(c.chat_id) as { cnt: number }).cnt
          if (recentCount < 3) continue

          // Find the largest gap in their conversation
          const chatRowids = chatDb.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').all(c.chat_id) as { ROWID: number }[]
          if (chatRowids.length === 0) continue
          const idList = chatRowids.map(r => r.ROWID).join(',')
          const dates = chatDb.prepare(`SELECT DISTINCT date(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as d FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id WHERE cmj.chat_id IN (${idList}) ORDER BY d`).all() as { d: string }[]

          let maxGap = 0
          for (let i = 1; i < dates.length; i++) {
            const gap = (new Date(dates[i].d).getTime() - new Date(dates[i - 1].d).getTime()) / 86400000
            if (gap > maxGap) maxGap = gap
          }
          if (maxGap >= 60) {
            moments.push({
              type: 'comeback',
              title: 'Comeback',
              subtitle: `${Math.round(maxGap)} days of silence, broken.`,
              dateLabel: 'Recently reconnected',
              chatName: c.chat_id,
              metric: Math.round(maxGap)
            })
            break // only one comeback
          }
        }
      } catch { /* ignore */ }

      // ── 8. Fading: someone you used to talk to who's gone quiet ──
      try {
        const fadingCandidates = chatDb.prepare(`
          SELECT c.chat_identifier as chat_id, COUNT(*) as total,
            MAX(datetime(m.date/${NS}+${APPLE_EPOCH}, 'unixepoch', 'localtime')) as last_msg
          FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          JOIN chat c ON cmj.chat_id = c.ROWID
          WHERE (SELECT COUNT(DISTINCT chj.handle_id) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) = 1
          GROUP BY c.chat_identifier HAVING total >= 200
        `).all() as { chat_id: string; total: number; last_msg: string }[]

        for (const c of fadingCandidates) {
          const lastDate = new Date(c.last_msg)
          if (isNaN(lastDate.getTime())) continue
          const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / 86400000)
          if (daysSince >= 30 && daysSince <= 90) {
            moments.push({
              type: 'fading',
              title: 'Gone Quiet',
              subtitle: `It's been ${daysSince} days. Life shifts.`,
              dateLabel: `Last heard ${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
              chatName: c.chat_id,
              metric: daysSince
            })
            break // only one fading
          }
        }
      } catch { /* ignore */ }

      // ── 9. Streak Anniversary: anniversary of a long streak's start ──
      if (bestStreak.length >= 30 && bestStreak.startDate) {
        try {
          const streakStart = new Date(bestStreak.startDate + 'T12:00:00')
          const annivThisYear = new Date(currentYear, streakStart.getMonth(), streakStart.getDate())
          const dayDiff = Math.abs(now.getTime() - annivThisYear.getTime()) / 86400000
          if (dayDiff <= 7 && streakStart.getFullYear() < currentYear) {
            const yearsAgo = currentYear - streakStart.getFullYear()
            moments.push({
              type: 'streak_anniversary',
              title: 'Streak Anniversary',
              subtitle: `${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago, a ${bestStreak.length}-day streak began.`,
              dateLabel: streakStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
              chatName: bestStreak.chat,
              metric: bestStreak.length
            })
          }
        } catch { /* ignore */ }
      }

      chatDb.close()
    } catch { /* queries failed */ }

    // ── 10. Heat Peak: most intense conversation from conversation_signals ──
    try {
      const stashDb = initDb()
      const heatRow = stashDb.prepare(`SELECT chat_identifier, avg_heat, total_analyzed FROM conversation_signals WHERE total_analyzed > 20 AND avg_heat > 3.0 ORDER BY avg_heat DESC LIMIT 1`).get() as { chat_identifier: string; avg_heat: number; total_analyzed: number } | undefined
      if (heatRow) {
        moments.push({
          type: 'heat_peak',
          title: 'Most Intense',
          subtitle: `Your most intense conversation. Heat score: ${heatRow.avg_heat.toFixed(1)}/10.`,
          dateLabel: `${heatRow.total_analyzed} messages analyzed`,
          chatName: heatRow.chat_identifier,
          metric: heatRow.avg_heat
        })
      }
    } catch { /* conversation_signals may not exist yet */ }
  } catch { /* fallback */ }

  // ── Quality scoring: sort by interestingness, return top 8 ──
  const SCORE_WEIGHTS: Record<string, (m: MemoryMoment) => number> = {
    on_this_day: m => (m.metric || 0),
    first_message: m => (m.metric || 0) * 10,
    biggest_day: m => (m.metric || 0),
    biggest_month: m => (m.metric || 0) / 10,
    streak: m => (m.metric || 0) * 5,
    intensity_echo: m => (m.metric || 0),
    comeback: () => 80,
    fading: () => 60,
    streak_anniversary: () => 70,
    heat_peak: m => (m.metric || 0) * 20,
  }
  moments.sort((a, b) => {
    const scoreA = (SCORE_WEIGHTS[a.type] || (() => 0))(a)
    const scoreB = (SCORE_WEIGHTS[b.type] || (() => 0))(b)
    return scoreB - scoreA
  })
  if (moments.length > 8) moments.splice(8)

  return { moments }
}

export interface TopicEraContext {
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
  // Signal hierarchy fields
  totalMessages: number
  relationshipScore: number
  groupScore: number
  mediaScore: number
  primarySignalType: 'relationship' | 'activity' | 'social' | 'mixed'
  primaryActors: string[]
  attachmentSummary: string
}

// Artifact/system words to aggressively filter from phrases and keywords
const PHRASE_BLACKLIST = new Set([
  'image','images','loved','render','rendered','renderedimage','renderedvideo',
  'video','videos','photo','photos','screenshot','screenshots','file','files',
  'link','links','http','https','www','com','net','org','tkk','preview',
  'code','tiktok','instagram','youtube','fullsizerender','fullsizeoutput',
  'img','mov','jpeg','heic','png','gif','mp4','pdf','attachment','tmp','temp',
  'screen','shot','pic','pics','null','undefined','error','nan','inf',
])

export function getTopicEraContext(chapters: { startYear: number; endYear: number; topicLabel: string; keywords: string[] }[]): { contexts: TopicEraContext[] } {
  const contexts: TopicEraContext[] = []
  try {
    const d = initDb()
    const hasMsgs = (d.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c
    if (hasMsgs < 50) return { contexts }

    for (const ch of chapters) {
      const fromDate = `${ch.startYear}-01-01`
      const toDate = `${ch.endYear}-12-31 23:59:59`

      // ── Top people by message volume (always included) ──
      const topPeopleRows = d.prepare(`
        SELECT chat_name, COUNT(*) as cnt FROM messages
        WHERE sent_at >= ? AND sent_at <= ? AND chat_name IS NOT NULL AND chat_name NOT LIKE 'chat%'
        GROUP BY chat_name ORDER BY cnt DESC LIMIT 5
      `).all(fromDate, toDate) as { chat_name: string; cnt: number }[]
      const topPeople = topPeopleRows.map(r => ({ name: r.chat_name, count: r.cnt }))

      // ── Top groups with counts ──
      const topGroupRows = d.prepare(`
        SELECT chat_name, COUNT(*) as cnt FROM messages
        WHERE sent_at >= ? AND sent_at <= ? AND chat_name IS NOT NULL AND chat_name LIKE 'chat%'
        GROUP BY chat_name ORDER BY cnt DESC LIMIT 3
      `).all(fromDate, toDate) as { chat_name: string; cnt: number }[]
      const topGroups = topGroupRows.map(r => ({ name: r.chat_name, count: r.cnt }))

      // ── Sample messages: meaningful, > 20 chars, evenly distributed ──
      const totalMeaningful = (d.prepare(`
        SELECT COUNT(*) as c FROM messages
        WHERE sent_at >= ? AND sent_at <= ? AND body IS NOT NULL AND length(body) > 20
      `).get(fromDate, toDate) as { c: number }).c

      const step = Math.max(1, Math.floor(totalMeaningful / 15))
      const sampleRows = d.prepare(`
        SELECT body FROM (
          SELECT body, ROW_NUMBER() OVER (ORDER BY sent_at) as rn
          FROM messages
          WHERE sent_at >= ? AND sent_at <= ? AND body IS NOT NULL AND length(body) > 20
        ) WHERE rn % ? = 0 LIMIT 15
      `).all(fromDate, toDate, step) as { body: string }[]

      const sampleMessages = sampleRows.map(r => {
        const text = r.body.slice(0, 280)
        return {
          text,
          hasLink: /https?:\/\//.test(text),
          hasMedia: /\.(jpg|jpeg|png|gif|mp4|mov|heic|pdf)/i.test(text) || /photo|image|video|screenshot/i.test(text)
        }
      })

      // ── Attachments: grouped by type with counts ──
      const topAttachments: { type: string; count: number }[] = []
      try {
        const attTypeRows = d.prepare(`
          SELECT
            CASE
              WHEN is_image = 1 THEN 'image'
              WHEN is_video = 1 THEN 'video'
              WHEN is_document = 1 THEN 'document'
              WHEN mime_type LIKE 'audio/%' THEN 'audio'
              ELSE 'other'
            END as atype,
            COUNT(*) as cnt
          FROM attachments
          WHERE created_at >= ? AND created_at <= ? AND filename IS NOT NULL
          GROUP BY atype ORDER BY cnt DESC
        `).all(fromDate, toDate) as { atype: string; cnt: number }[]
        for (const r of attTypeRows) if (r.cnt > 0) topAttachments.push({ type: r.atype, count: r.cnt })
      } catch { /* ignore */ }

      // ── Repeated phrases: bigrams/trigrams, aggressively filtered ──
      const phraseMap = new Map<string, number>()
      const phraseMsgs = d.prepare(`
        SELECT body FROM messages
        WHERE sent_at >= ? AND sent_at <= ? AND body IS NOT NULL AND length(body) BETWEEN 15 AND 500
        ORDER BY RANDOM() LIMIT 5000
      `).all(fromDate, toDate) as { body: string }[]

      const isCleanWord = (w: string): boolean => w.length >= 3 && !TOPIC_STOPS.has(w) && !PHRASE_BLACKLIST.has(w) && !/\d/.test(w)

      for (const r of phraseMsgs) {
        const words = r.body.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(isCleanWord)
        for (let j = 0; j < words.length - 1; j++) phraseMap.set(`${words[j]} ${words[j + 1]}`, (phraseMap.get(`${words[j]} ${words[j + 1]}`) || 0) + 1)
        for (let j = 0; j < words.length - 2; j++) {
          const tri = `${words[j]} ${words[j + 1]} ${words[j + 2]}`
          phraseMap.set(tri, (phraseMap.get(tri) || 0) + 1)
        }
      }
      // ALL words must be clean, 10+ occurrences, no blacklisted words anywhere in phrase
      const repeatedPhrases = [...phraseMap.entries()]
        .filter(([phrase, count]) => {
          if (count < 10) return false
          const words = phrase.split(' ')
          return words.every(isCleanWord) && !words.some(w => PHRASE_BLACKLIST.has(w))
        })
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([phrase, count]) => `${phrase} (${count}x)`)

      // ── Signal hierarchy scoring ──
      const totalMsgs = (d.prepare(`SELECT COUNT(*) as c FROM messages WHERE sent_at >= ? AND sent_at <= ?`).get(fromDate, toDate) as { c: number }).c
      const top3PeopleCount = topPeople.slice(0, 3).reduce((s, p) => s + p.count, 0)
      const groupMsgs = topGroupRows.reduce((s, r) => s + r.cnt, 0)
      const totalAtt = topAttachments.reduce((s, a) => s + a.count, 0)

      const relationshipScore = totalMsgs > 0 ? Math.round((top3PeopleCount / totalMsgs) * 100) / 100 : 0
      const groupScore = totalMsgs > 0 ? Math.round((groupMsgs / totalMsgs) * 100) / 100 : 0
      const mediaScore = totalMsgs > 0 ? Math.round((totalAtt / totalMsgs) * 100) / 100 : 0

      let primarySignalType: 'relationship' | 'activity' | 'social' | 'mixed' = 'mixed'
      if (relationshipScore >= 0.45) primarySignalType = 'relationship'
      else if (mediaScore >= 0.10) primarySignalType = 'activity'
      else if (groupScore >= 0.30) primarySignalType = 'social'

      const primaryActors = topPeople.slice(0, 3).map(p => p.name)

      // ── Attachment summary (human-readable) ──
      const attTypes = topAttachments.filter(a => a.count > 0)
      let attachmentSummary = ''
      if (attTypes.length > 0) {
        const dominant = attTypes[0]
        if (dominant.count > totalAtt * 0.6) attachmentSummary = `Mostly ${dominant.type}s`
        else attachmentSummary = attTypes.map(a => `${a.type}s`).join(', ')
        if (totalAtt > 100) attachmentSummary += ` (${totalAtt} total)`
      }

      // ── Summary hint: behavior-led, stronger ──
      const groupPct = totalMsgs > 0 ? Math.round((groupMsgs / totalMsgs) * 100) : 0
      const hints: string[] = []
      if (topPeople.length > 0) {
        const names = topPeople.slice(0, 3).map(p => p.name).join(', ')
        const pct = Math.round(relationshipScore * 100)
        hints.push(`Frequent conversations with ${names} (${pct}% of messages)`)
      }
      if (primarySignalType === 'relationship' && topPeople.length > 0) hints.push(`Dominated by ${topPeople[0].name}`)
      if (groupPct > 30) hints.push(`Heavy group activity (${groupPct}%)`)
      else if (groupPct < 10) hints.push('Mostly 1-on-1 conversations')
      if (attachmentSummary) hints.push(attachmentSummary)
      const summaryHint = hints.length > 0 ? hints.join('. ') + '.' : `${totalMsgs} messages across this period.`

      // Clean keywords: remove blacklisted
      const cleanKeywords = ch.keywords.filter(kw => !kw.split(' ').some(w => PHRASE_BLACKLIST.has(w.toLowerCase())))

      contexts.push({
        startYear: ch.startYear, endYear: ch.endYear,
        heuristicLabel: ch.topicLabel, keywords: cleanKeywords,
        topPeople, topGroups, sampleMessages, topAttachments, repeatedPhrases, summaryHint,
        totalMessages: totalMsgs, relationshipScore, groupScore, mediaScore,
        primarySignalType, primaryActors, attachmentSummary
      })
    }
  } catch (err) { console.error('[TopicEraContext] Error:', err) }
  return { contexts }
}

// ── Search execution functions ──

export interface SearchResult {
  type: 'ranked_contacts' | 'messages' | 'aggregation' | 'timeline'
  explanation: string
  ranked?: { contact: string; value: number; label: string }[]
  messages?: { id?: number; body: string; chat_name: string; sent_at: string; is_from_me: number; snippet: string; sender_handle?: string | null }[]
  aggregation?: AggregatedSearchResult[]
  timeline?: { period: string; value: number }[]
}

const SIGNAL_COLUMN_MAP: Record<string, { column: string; label: string }> = {
  laugh: { column: 'laugh_count', label: 'laughs' },
  heat: { column: 'avg_heat', label: 'avg heat' },
  sentiment: { column: 'positive_rate', label: '% positive' },
  emoji: { column: 'emoji_rate', label: '% emoji' },
  question: { column: 'question_count', label: 'questions' },
  word_count: { column: 'avg_word_count', label: 'avg words' },
  all_caps: { column: 'all_caps_rate', label: '% all caps' },
  link: { column: 'link_count', label: 'links' },
}

export function executeSignalRank(signal: string, sort: string, limit: number, chatName?: string): { contact: string; value: number; label: string }[] {
  const d = initDb()
  const mapping = SIGNAL_COLUMN_MAP[signal]
  if (!mapping) return []
  const chatFilter = chatName ? ` AND chat_identifier = '${chatName.replace(/'/g, "''")}'` : ''
  try {
    const rows = d.prepare(`SELECT chat_identifier as contact, ${mapping.column} as value, total_analyzed FROM conversation_signals WHERE total_analyzed > 10${chatFilter} ORDER BY ${mapping.column} ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`).all(limit) as { contact: string; value: number; total_analyzed: number }[]
    return rows.map(r => ({ contact: r.contact, value: Math.round(r.value * 100) / 100, label: mapping.label }))
  } catch { return [] }
}

export function executePhraseFirst(phrase: string, chatName?: string): { body: string; chat_name: string; sent_at: string; is_from_me: number }[] {
  const d = initDb()
  const likeTerm = `%${phrase.trim().toLowerCase()}%`
  const chatFilter = chatName ? ' AND chat_name = ?' : ''
  const params: (string | number)[] = [likeTerm]
  if (chatName) params.push(chatName)
  try {
    return d.prepare(`SELECT body, chat_name, sent_at, is_from_me FROM messages WHERE LOWER(body) LIKE ?${chatFilter} ORDER BY apple_date ASC LIMIT 5`).all(...params) as { body: string; chat_name: string; sent_at: string; is_from_me: number }[]
  } catch { return [] }
}

export function executeBehaviorQuery(signal: string, groupBy: string, sort: string, limit: number): { period: string; value: number }[] {
  const d = initDb()
  try {
    if (groupBy === 'month') {
      return d.prepare(`SELECT strftime('%m', sent_at) as period, COUNT(*) as value FROM message_signals GROUP BY period ORDER BY value ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`).all(limit) as { period: string; value: number }[]
    }
    return d.prepare(`SELECT strftime('%w', sent_at) as period, COUNT(*) as value FROM message_signals GROUP BY period ORDER BY value ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`).all(limit) as { period: string; value: number }[]
  } catch { return [] }
}

// Local signal detection — works without AI
export function detectSignalQuery(query: string): { type: string; signal: string; explanation: string } | null {
  const q = query.toLowerCase().trim()
  if (/\b(laugh|funny|funniest|humor|comedian|comedy)\b/.test(q)) return { type: 'signal_rank', signal: 'laugh', explanation: 'Ranking by laugh count' }
  if (/\b(emoji|emojis)\b/.test(q)) return { type: 'signal_rank', signal: 'emoji', explanation: 'Ranking by emoji usage' }
  if (/\b(heat|heated|intense|intensity|argument)\b/.test(q)) return { type: 'signal_rank', signal: 'heat', explanation: 'Ranking by conversation intensity' }
  if (/\b(question|questions|asks? me)\b/.test(q)) return { type: 'signal_rank', signal: 'question', explanation: 'Ranking by questions asked' }
  if (/\b(long|longest|verbose|wordy|word count)\b/.test(q)) return { type: 'signal_rank', signal: 'word_count', explanation: 'Ranking by average message length' }
  if (/\b(positive|happy|happiest|upbeat)\b/.test(q)) return { type: 'signal_rank', signal: 'sentiment', explanation: 'Ranking by positive sentiment' }
  if (/\b(negative|angry|angriest|toxic|conflict)\b/.test(q)) return { type: 'signal_rank', signal: 'sentiment', explanation: 'Ranking by negative sentiment' }
  if (/\b(link|links|url|urls|share.*link)\b/.test(q)) return { type: 'signal_rank', signal: 'link', explanation: 'Ranking by links shared' }
  if (/\b(caps|yell|yelling|shout|shouting)\b/.test(q)) return { type: 'signal_rank', signal: 'all_caps', explanation: 'Ranking by all-caps messages' }
  return null
}

export function executeSearchIntent(intent: { type: string; phrase?: string | null; signal?: string | null; groupBy?: string | null; sort?: string; limit?: number; explanation: string }, chatName?: string): SearchResult {
  const sort = intent.sort || 'desc'
  const limit = intent.limit || 10

  switch (intent.type) {
    case 'signal_rank': {
      if (!intent.signal) return { type: 'ranked_contacts', explanation: intent.explanation, ranked: [] }
      const ranked = executeSignalRank(intent.signal, sort, limit, chatName)
      return { type: 'ranked_contacts', explanation: intent.explanation, ranked }
    }
    case 'phrase_count': {
      if (!intent.phrase) return { type: 'aggregation', explanation: intent.explanation, aggregation: [] }
      const agg = searchMessagesAggregated(intent.phrase, chatName, limit)
      return { type: 'aggregation', explanation: intent.explanation, aggregation: agg }
    }
    case 'phrase_first': {
      if (!intent.phrase) return { type: 'messages', explanation: intent.explanation, messages: [] }
      const msgs = executePhraseFirst(intent.phrase, chatName)
      return { type: 'messages', explanation: intent.explanation, messages: msgs.map(m => ({ ...m, snippet: m.body.slice(0, 200) })) }
    }
    case 'behavior_query': {
      const timeline = executeBehaviorQuery(intent.signal || 'volume', intent.groupBy || 'month', sort, limit)
      return { type: 'timeline', explanation: intent.explanation, timeline }
    }
    default: {
      // Literal fallback
      const results = searchMessages(intent.phrase || '', chatName, limit)
      return { type: 'messages', explanation: intent.explanation || `Showing messages matching "${intent.phrase}"`, messages: results }
    }
  }
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

export interface AggregatedSearchResult {
  contact: string
  count: number
  samples: { body: string; sent_at: string; is_from_me: number }[]
}

export function searchMessagesAggregated(phrase: string, chatName?: string, limit = 10): AggregatedSearchResult[] {
  const d = initDb()
  if (!phrase.trim()) return []
  try {
    const likeTerm = `%${phrase.trim().toLowerCase()}%`
    const chatFilter = chatName ? ' AND chat_name = ?' : ''
    const params: (string | number)[] = [likeTerm]
    if (chatName) params.push(chatName)

    const rows = d.prepare(`
      SELECT chat_name, body, sent_at, is_from_me
      FROM messages
      WHERE LOWER(body) LIKE ?${chatFilter}
      ORDER BY sent_at DESC
    `).all(...params) as { chat_name: string; body: string; sent_at: string; is_from_me: number }[]

    // Group by contact
    const byContact = new Map<string, { count: number; samples: { body: string; sent_at: string; is_from_me: number }[] }>()
    for (const r of rows) {
      const key = r.chat_name
      if (!byContact.has(key)) byContact.set(key, { count: 0, samples: [] })
      const entry = byContact.get(key)!
      entry.count++
      if (entry.samples.length < 3) entry.samples.push({ body: r.body.slice(0, 200), sent_at: r.sent_at, is_from_me: r.is_from_me })
    }

    return [...byContact.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([contact, data]) => ({ contact, count: data.count, samples: data.samples }))
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

// ── Text Intelligence Utilities ──

const TEXT_STOPWORDS = new Set([
  // Articles, prepositions, conjunctions
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'is','it','its','as','by','from','up','out','about','into','over',
  'after','before','between','under','above','below','through','during',
  'without','within','along','around','against','off','down',
  // Pronouns
  'i','me','my','mine','myself','you','your','yours','yourself',
  'he','him','his','himself','she','her','hers','herself',
  'we','us','our','ours','ourselves','they','them','their','theirs',
  'themselves','this','that','these','those','which','who','whom',
  'what','where','when','how','why','whose',
  // Common verbs
  'am','are','was','were','be','been','being','have','has','had',
  'having','do','does','did','doing','will','would','could','should',
  'shall','may','might','can','must','need',
  'get','got','gets','getting','go','goes','going','gone','went',
  'come','comes','coming','came','make','makes','making','made',
  'take','takes','taking','took','taken','give','gave','given',
  'say','says','said','saying','tell','told','telling',
  'know','knows','knew','known','think','thinks','thought','thinking',
  'see','sees','saw','seen','want','wants','wanted','wanting',
  'let','lets','put','puts','keep','keeps','kept',
  'find','found','seem','seems','seemed','feel','feels','felt',
  'try','tries','tried','trying','leave','left',
  'call','called','ask','asked','turn','use','used',
  'look','looked','looking','run','running','show','start','started',
  'move','moved','work','worked','play','set','help','talk','talked',
  'open','close','read','write','bring','brought','hold','held',
  'stand','sit','hear','heard','pay','meet','send','sent','wait',
  'lose','lost','happen','happened','change','changed','live','believe',
  // Common adverbs/adjectives
  'not','no','nor','so','if','then','than','too','very','much',
  'more','most','less','also','just','only','even','still','already',
  'yet','never','always','often','ever','really','actually','probably',
  'maybe','definitely','basically','literally','honestly','seriously',
  'pretty','quite','rather','anyway','though','although','however',
  'well','now','here','there','all','each','every','both','some',
  'any','many','few','other','new','old','good','bad','big','little',
  'long','great','right','same','different','last','first','next',
  'sure','real','whole','hard','easy','best','worst',
  // Low-value nouns appearing in every conversation
  'thing','things','stuff','something','anything','nothing','everything',
  'someone','anyone','everyone','people','person','man','woman','guy',
  'girl','time','times','day','days','week','weeks','month','year',
  'way','back','place','part','point','home','house','room','car',
  'night','morning','lot','lots','bit','kind','type','end',
  'hand','head','world','life','water','food',
  // Texting/slang/chat noise
  'lol','haha','hahaha','hahahaha','lmao','lmfao','omg','wtf','smh',
  'tbh','ngl','imo','imho','btw','brb','ttyl','idk','irl','fyi',
  'gonna','wanna','gotta','kinda','sorta','tryna','boutta',
  'tho','rn','bc','cuz','cus','pls','plz','thx','ty','np',
  'ok','okay','ooh','ahh','hmm','umm','ugh','mhm','huh','wow',
  'yooo','loll','omgg','damnn','yeahh','okayy','yea','nah','nope',
  'hey','hello','bye','sup','yo','dude','bro','man',
  'yeah','yep','yes','sure',
  // Contractions (split fragments)
  'im','ive','ill','id','dont','didnt','doesnt','isnt','wasnt',
  'werent','wont','cant','couldnt','shouldnt','wouldnt','havent',
  'hasnt','hadnt','thats','theres','heres','whats','whos',
  'youre','youve','youll','youd','theyre','theyve','theyll',
  'weve','wed','hes','shes',
  // URL/tech fragments that survive tokenization
  'http','https','www','com','org','net','edu','gov','io','html',
  'php','jpg','png','gif','pdf','mp4','mov','app','web',
  // iMessage system artifacts
  'liked','loved','laughed','emphasized','questioned','disliked',
  'image','attachment','audio','message','sticker',
])

const DOMAIN_FRAGMENTS = new Set(['com','org','net','edu','gov','io','co','uk','ca','au','de','fr','app','dev','me','info','biz','us','tv'])

function cleanMessageText(text: string): string {
  let clean = text
  clean = clean.replace(/https?:\/\/\S+/gi, '')
  clean = clean.replace(/www\.\S+/gi, '')
  clean = clean.replace(/\S+@\S+\.\S+/g, '')
  clean = clean.replace(/\+?\d[\d\s\-().]{7,}/g, '')
  clean = clean.replace(/^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked)\s+".*"$/i, '')
  clean = clean.replace(/^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked)\s+an?\s+(image|attachment|audio message)/i, '')
  clean = clean.replace(/@\w+/g, '')
  return clean.trim()
}

function tokenizeWords(text: string): string[] {
  const cleaned = cleanMessageText(text)
  if (!cleaned) return []
  const raw = cleaned.toLowerCase().match(/[a-z][a-z']{2,}/g) || []
  return raw
    .map(w => w.replace(/'+$/, '').replace(/^'+/, ''))
    .filter(w => w.length >= 3 && !TEXT_STOPWORDS.has(w) && !DOMAIN_FRAGMENTS.has(w) && !/^(.)\1{2,}$/.test(w))
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
    const counts = new Map<string, number>()
    let totalWords = 0
    for (const { body } of myRows) {
      const words = tokenizeWords(body)
      totalWords += words.length
      for (const w of words) counts.set(w, (counts.get(w) || 0) + 1)
    }
    let theirTotal = 0
    for (const { body } of theirRows) { theirTotal += tokenizeWords(body).length }
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
    const firstSeen = new Map<string, { sent_at: string; chat_name: string }>()
    const counts = new Map<string, number>()
    for (const { body, chat_name: cn, sent_at } of rows) {
      const words = tokenizeWords(body).filter(w => w.length >= 4)
      for (const w of words) {
        counts.set(w, (counts.get(w) || 0) + 1)
        if (!firstSeen.has(w)) firstSeen.set(w, { sent_at, chat_name: cn })
      }
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
