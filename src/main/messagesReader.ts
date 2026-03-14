import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
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

export function checkFullDiskAccess(): boolean {
  try {
    const db = new Database(CHAT_DB_PATH, { readonly: true })
    db.close()
    return true
  } catch {
    return false
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
      COALESCE(c.display_name, c.chat_identifier) as chat_name,
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
    return rows.map((row) => ({
      ...row,
      original_path: row.original_path ? row.original_path.replace('~', homedir()) : null,
      file_size: row.file_size || 0
    }))
  } catch (err) {
    console.error('Error reading Messages database:', err)
    db.close()
    return []
  }
}
