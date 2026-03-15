export interface Attachment {
  id: number
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
  metadata_only: number
  is_available: number
  source: string
}

export interface Filters {
  type?: string
  chatName?: string
  dateRange?: string
}

export interface IndexingProgress {
  total: number
  processed: number
  currentFile: string
  phase?: string
}

export interface Stats {
  total: number
  images: number
  videos: number
  documents: number
  audio: number
  unavailable: number
  chatNames: string[]
  chatNameMap: Record<string, string>
}

export interface ChatSummary {
  chat_name: string
  display_name: string
  raw_chat_identifier: string
  attachment_count: number
  last_message_date: string
  participant_handles: string[]
}
