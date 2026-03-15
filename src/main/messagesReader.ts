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
    return rows.map((row) => ({
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
