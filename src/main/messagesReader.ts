import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, basename } from 'path'
import { existsSync } from 'fs'

const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db')

export interface MessageAttachment {
  attachment_id: number
  filename: string | null
  original_path: string | null
  file_size: number
  mime_type: string | null
  created_at: string
  chat_name: string | null
  sender_handle: string | null
}

export interface ChatSummary {
  chat_id: number
  chat_name: string
  display_name: string
  raw_chat_identifier: string
  attachment_count: number
  last_message_date: string
  participant_handles: string[]
}

export function checkFullDiskAccess(): boolean {
  try {
    const db = new Database(CHAT_DB_PATH, { readonly: true })
    db.close()
    return true
  } catch {
    return false
  }
}

export function getChatSummaries(): ChatSummary[] {
  if (!existsSync(CHAT_DB_PATH)) return []

  const db = new Database(CHAT_DB_PATH, { readonly: true })
  try {
    const rows = db.prepare(`
      SELECT
        c.ROWID as chat_id,
        COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) as chat_name,
        c.display_name as display_name,
        c.chat_identifier as raw_chat_identifier,
        COUNT(DISTINCT a.ROWID) as attachment_count,
        datetime(MAX(m.date) / 1000000000 + 978307200, 'unixepoch', 'localtime') as last_message_date
      FROM attachment a
      JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
      JOIN message m ON maj.message_id = m.ROWID
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE a.filename IS NOT NULL AND c.ROWID IS NOT NULL
      GROUP BY c.ROWID
      ORDER BY last_message_date DESC
    `).all() as (Omit<ChatSummary, 'participant_handles'> & { display_name: string | null; raw_chat_identifier: string | null })[]

    // Get participant handles for each chat
    const chatParticipants = new Map<string, string[]>()
    try {
      const participantRows = db.prepare(`
        SELECT
          COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) as chat_name,
          h.id as handle_id
        FROM chat c
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        JOIN handle h ON chj.handle_id = h.ROWID
      `).all() as { chat_name: string; handle_id: string }[]

      for (const row of participantRows) {
        if (!chatParticipants.has(row.chat_name)) {
          chatParticipants.set(row.chat_name, [])
        }
        chatParticipants.get(row.chat_name)!.push(row.handle_id)
      }
    } catch {
      // chat_handle_join may not exist in all versions
    }

    db.close()
    return rows.map((row: any) => ({
      chat_id: row.chat_id,
      chat_name: row.chat_name,
      display_name: row.display_name || '',
      raw_chat_identifier: row.raw_chat_identifier || '',
      attachment_count: row.attachment_count,
      last_message_date: row.last_message_date,
      participant_handles: chatParticipants.get(row.chat_name) || []
    }))
  } catch (err) {
    console.error('Error getting chat summaries:', err)
    db.close()
    return []
  }
}

export function readAllAttachments(): MessageAttachment[] {
  if (!existsSync(CHAT_DB_PATH)) return []

  const db = new Database(CHAT_DB_PATH, { readonly: true })

  const query = `
    SELECT
      a.ROWID as attachment_id,
      a.filename as filename,
      a.filename as original_path,
      a.total_bytes as file_size,
      a.mime_type as mime_type,
      datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') as created_at,
      COALESCE(NULLIF(c.display_name, ''), c.chat_identifier, h.id, 'Unknown') as chat_name,
      h.id as sender_handle
    FROM attachment a
    JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
    JOIN message m ON maj.message_id = m.ROWID
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    LEFT JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE a.filename IS NOT NULL
    ORDER BY m.date DESC
  `

  try {
    const rows = db.prepare(query).all() as MessageAttachment[]
    db.close()
    const JUNK_EXTENSIONS = ['.pluginPayloadAttachment', '.pluginPayloadData', '.archive']
    return rows
      .filter((row) => {
        if (!row.filename) return false
        return !JUNK_EXTENSIONS.some((ext) => row.filename!.includes(ext))
      })
      .map((row) => ({
        ...row,
        filename: row.filename ? basename(row.filename) : null,
        original_path: row.original_path ? row.original_path.replace('~', homedir()) : null,
        file_size: row.file_size || 0
      }))
  } catch (err) {
    console.error('Error reading Messages database:', err)
    db.close()
    return []
  }
}

export interface ConversationListItem {
  chatIdentifier: string
  displayName: string
  lastMessageBody: string
  lastMessageDate: string
  lastMessageIsFromMe: boolean
  messageCount: number
  hasUnindexedAttachments: boolean
}

export function getConversationList(
  periodYear?: number,
  periodMonth?: number,
  searchQuery?: string
): ConversationListItem[] {
  if (!existsSync(CHAT_DB_PATH)) return []

  const db = new Database(CHAT_DB_PATH, { readonly: true })
  try {
    const APPLE_EPOCH = 978307200
    const NS = 1000000000

    let dateCond = ''
    if (periodYear !== undefined && periodYear !== null) {
      const startDate = periodMonth !== undefined && periodMonth !== null
        ? `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`
        : `${periodYear}-01-01`
      const endDate = periodMonth !== undefined && periodMonth !== null
        ? new Date(periodYear, periodMonth, 0, 23, 59, 59) // last day of month
        : new Date(periodYear, 11, 31, 23, 59, 59)
      const appleFrom = (new Date(startDate).getTime() / 1000 - APPLE_EPOCH) * NS
      const appleTo = (endDate.getTime() / 1000 - APPLE_EPOCH) * NS
      dateCond = ` AND m.date >= ${appleFrom} AND m.date <= ${appleTo}`
    }

    // Get conversations with message counts and most recent message date
    const rows = db.prepare(`
      SELECT
        c.chat_identifier as chatIdentifier,
        COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) as displayName,
        COUNT(m.ROWID) as messageCount,
        MAX(m.date) as maxDate
      FROM chat c
      JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
      JOIN message m ON cmj.message_id = m.ROWID
      WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1)
        AND m.associated_message_type = 0
        ${dateCond}
      GROUP BY c.chat_identifier
      HAVING messageCount > 0
      ORDER BY maxDate DESC
    `).all() as { chatIdentifier: string; displayName: string; messageCount: number; maxDate: number }[]

    // Get last message for each conversation (within period if specified)
    const result: ConversationListItem[] = []
    const getLastMsg = db.prepare(`
      SELECT m.text as body, m.is_from_me as isFromMe,
        datetime(m.date / ${NS} + ${APPLE_EPOCH}, 'unixepoch', 'localtime') as sentAt,
        m.cache_has_attachments as hasAttachment
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE c.chat_identifier = ?
        AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
        AND m.associated_message_type = 0
        ${dateCond}
      ORDER BY m.date DESC
      LIMIT 1
    `)

    for (const row of rows) {
      const lastMsg = getLastMsg.get(row.chatIdentifier) as {
        body: string | null; isFromMe: number; sentAt: string; hasAttachment: number
      } | undefined

      if (!lastMsg) continue

      const displayName = row.displayName
      const body = lastMsg.body || (lastMsg.hasAttachment ? 'Attachment' : '')
      const preview = body.length > 80 ? body.slice(0, 80) + '...' : body

      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!displayName.toLowerCase().includes(q) && !body.toLowerCase().includes(q)) continue
      }

      result.push({
        chatIdentifier: row.chatIdentifier,
        displayName,
        lastMessageBody: preview,
        lastMessageDate: lastMsg.sentAt,
        lastMessageIsFromMe: lastMsg.isFromMe === 1,
        messageCount: row.messageCount,
        hasUnindexedAttachments: false
      })
    }

    db.close()
    return result
  } catch (err) {
    console.error('Error fetching conversation list:', err)
    db.close()
    return []
  }
}

export interface ConversationMessage {
  rowId: number
  body: string
  isFromMe: boolean
  sentAt: string
  hasAttachment: boolean
  attachmentId?: number
}

export interface ConversationPage {
  messages: ConversationMessage[]
  hasOlder: boolean
  hasNewer: boolean
}

export function getMessagesForChat(
  chatIdentifier: string,
  limit: number,
  beforeRowId?: number,
  afterRowId?: number
): ConversationPage {
  if (!existsSync(CHAT_DB_PATH)) return { messages: [], hasOlder: false, hasNewer: false }

  const db = new Database(CHAT_DB_PATH, { readonly: true })
  try {
    // Resolve chat ROWID from identifier
    const chat = db.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').get(chatIdentifier) as { ROWID: number } | undefined
    if (!chat) { db.close(); return { messages: [], hasOlder: false, hasNewer: false } }
    const chatRowId = chat.ROWID

    let sql: string
    let params: (string | number)[]

    if (beforeRowId !== undefined && beforeRowId !== null) {
      // Fetch older messages (rowId < beforeRowId), ordered newest-first, then reverse
      sql = `
        SELECT m.ROWID as rowId, m.text as body, m.is_from_me as isFromMe,
          datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') as sentAt,
          m.cache_has_attachments as hasAttachment,
          (SELECT a.ROWID FROM message_attachment_join maj JOIN attachment a ON maj.attachment_id = a.ROWID WHERE maj.message_id = m.ROWID LIMIT 1) as attachmentId
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ? AND m.ROWID < ?
          AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND m.associated_message_type = 0
        ORDER BY m.ROWID DESC
        LIMIT ?
      `
      params = [chatRowId, beforeRowId, limit + 1]
    } else if (afterRowId !== undefined && afterRowId !== null) {
      // Fetch newer messages (rowId > afterRowId)
      sql = `
        SELECT m.ROWID as rowId, m.text as body, m.is_from_me as isFromMe,
          datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') as sentAt,
          m.cache_has_attachments as hasAttachment,
          (SELECT a.ROWID FROM message_attachment_join maj JOIN attachment a ON maj.attachment_id = a.ROWID WHERE maj.message_id = m.ROWID LIMIT 1) as attachmentId
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ? AND m.ROWID > ?
          AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND m.associated_message_type = 0
        ORDER BY m.ROWID ASC
        LIMIT ?
      `
      params = [chatRowId, afterRowId, limit + 1]
    } else {
      // Most recent messages
      sql = `
        SELECT m.ROWID as rowId, m.text as body, m.is_from_me as isFromMe,
          datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime') as sentAt,
          m.cache_has_attachments as hasAttachment,
          (SELECT a.ROWID FROM message_attachment_join maj JOIN attachment a ON maj.attachment_id = a.ROWID WHERE maj.message_id = m.ROWID LIMIT 1) as attachmentId
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        WHERE cmj.chat_id = ?
          AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
          AND m.associated_message_type = 0
        ORDER BY m.ROWID DESC
        LIMIT ?
      `
      params = [chatRowId, limit + 1]
    }

    const rows = db.prepare(sql).all(...params) as {
      rowId: number; body: string | null; isFromMe: number; sentAt: string
      hasAttachment: number; attachmentId: number | null
    }[]

    let hasOlder = false
    let hasNewer = false

    if (beforeRowId !== undefined && beforeRowId !== null) {
      hasNewer = true // we came from somewhere newer
      hasOlder = rows.length > limit
      const trimmed = rows.slice(0, limit).reverse() // chronological
      db.close()
      return {
        messages: trimmed.map(r => ({
          rowId: r.rowId, body: r.body || '', isFromMe: r.isFromMe === 1,
          sentAt: r.sentAt, hasAttachment: r.hasAttachment === 1,
          ...(r.attachmentId ? { attachmentId: r.attachmentId } : {})
        })),
        hasOlder, hasNewer
      }
    } else if (afterRowId !== undefined && afterRowId !== null) {
      hasOlder = true // we came from somewhere older
      hasNewer = rows.length > limit
      const trimmed = rows.slice(0, limit) // already chronological
      db.close()
      return {
        messages: trimmed.map(r => ({
          rowId: r.rowId, body: r.body || '', isFromMe: r.isFromMe === 1,
          sentAt: r.sentAt, hasAttachment: r.hasAttachment === 1,
          ...(r.attachmentId ? { attachmentId: r.attachmentId } : {})
        })),
        hasOlder, hasNewer
      }
    } else {
      hasOlder = rows.length > limit
      hasNewer = false // we're at the bottom
      const trimmed = rows.slice(0, limit).reverse() // chronological
      db.close()
      return {
        messages: trimmed.map(r => ({
          rowId: r.rowId, body: r.body || '', isFromMe: r.isFromMe === 1,
          sentAt: r.sentAt, hasAttachment: r.hasAttachment === 1,
          ...(r.attachmentId ? { attachmentId: r.attachmentId } : {})
        })),
        hasOlder, hasNewer
      }
    }
  } catch (err) {
    console.error('Error fetching messages for chat:', err)
    db.close()
    return { messages: [], hasOlder: false, hasNewer: false }
  }
}

export function getFirstMessageForPeriod(
  chatIdentifier: string,
  year: number,
  month?: number
): { rowId: number } | null {
  if (!existsSync(CHAT_DB_PATH)) return null

  const db = new Database(CHAT_DB_PATH, { readonly: true })
  try {
    const chat = db.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').get(chatIdentifier) as { ROWID: number } | undefined
    if (!chat) { db.close(); return null }

    const startDate = month !== undefined && month !== null
      ? `${year}-${String(month).padStart(2, '0')}-01`
      : `${year}-01-01`
    const APPLE_EPOCH = 978307200
    const NS = 1000000000
    const appleDate = (new Date(startDate).getTime() / 1000 - APPLE_EPOCH) * NS

    const row = db.prepare(`
      SELECT m.ROWID as rowId
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      WHERE cmj.chat_id = ? AND m.date >= ?
        AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
        AND m.associated_message_type = 0
      ORDER BY m.ROWID ASC
      LIMIT 1
    `).get(chat.ROWID, appleDate) as { rowId: number } | undefined

    db.close()
    return row ? { rowId: row.rowId } : null
  } catch (err) {
    console.error('Error finding first message for period:', err)
    db.close()
    return null
  }
}
