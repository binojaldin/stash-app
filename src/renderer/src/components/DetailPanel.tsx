import { useState, useEffect } from 'react'
import { X, ExternalLink, Download, Image, FileText, Video, Music, File, Eye, Cloud, CloudOff, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import type { Attachment } from '../types'

interface Props {
  attachment: Attachment
  onClose: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function FileTypeIcon({ attachment }: { attachment: Attachment }): JSX.Element {
  const size = 'w-8 h-8'
  if (attachment.is_image) return <Image className={`${size} text-blue-400`} />
  if (attachment.is_video) return <Video className={`${size} text-purple-400`} />
  if (attachment.is_document) return <FileText className={`${size} text-orange-400`} />
  if (attachment.mime_type?.startsWith('audio/')) return <Music className={`${size} text-green-400`} />
  return <File className={`${size} text-[#636363]`} />
}

export function DetailPanel({ attachment, onClose }: Props): JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const unavailable = !attachment.is_available && !recovered

  useEffect(() => {
    setRecovered(false)
    setRecovering(false)
    if (unavailable) { setPreviewUrl(null); return }
    const path = attachment.thumbnail_path || (attachment.is_image ? attachment.original_path : null)
    if (path) { window.api.getFileUrl(path).then(setPreviewUrl) }
    else { setPreviewUrl(null) }
  }, [attachment])

  const handleRecover = async (): Promise<void> => {
    setRecovering(true)
    const ok = await window.api.recoverFromIcloud(attachment.id)
    setRecovering(false)
    if (ok) {
      setRecovered(true)
      const path = attachment.thumbnail_path || (attachment.is_image ? attachment.original_path : null)
      if (path) window.api.getFileUrl(path).then(setPreviewUrl)
    }
  }

  return (
    <div className="w-80 flex-shrink-0 border-l border-[#262626] bg-[#0a0a0a] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-[#0a0a0a] z-10 flex items-center justify-between p-4 border-b border-[#262626]">
        <h3 className="text-sm font-medium text-white truncate pr-2">{attachment.filename}</h3>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-[#1c1c1c] flex items-center justify-center hover:bg-[#262626] transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5 text-[#a3a3a3]" />
        </button>
      </div>

      <div className="p-4">
        {/* Unavailable banner */}
        {unavailable && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-[#141414] border border-[#262626]">
            <CloudOff className="w-4 h-4 text-[#636363] flex-shrink-0" />
            <p className="text-xs text-[#8b8b8b]">This file is stored in iCloud and not available on this Mac.</p>
          </div>
        )}

        {/* Source badge */}
        {attachment.source === 'backup' && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-amber-950/30 border border-amber-900/30">
            <p className="text-xs text-amber-400">From iPhone backup</p>
          </div>
        )}
        {attachment.source === 'orphan' && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-[#141414] border border-[#262626]">
            <p className="text-xs text-[#636363]">Unknown conversation — file found on disk without a Messages record.</p>
          </div>
        )}

        {/* Preview */}
        <div className={`aspect-square rounded-lg overflow-hidden mb-4 flex items-center justify-center ${unavailable ? 'bg-[#111] border border-dashed border-[#262626]' : 'bg-[#141414]'}`}>
          {previewUrl ? (
            <img src={previewUrl} alt={attachment.filename} className="w-full h-full object-contain" />
          ) : unavailable ? (
            <div className="text-center">
              <Cloud className="w-10 h-10 text-[#262626] mx-auto mb-2" />
              <p className="text-[10px] text-[#4a4a4a]">Preview unavailable</p>
            </div>
          ) : (
            <FileTypeIcon attachment={attachment} />
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-6">
          {unavailable ? (
            <button
              onClick={handleRecover}
              disabled={recovering}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-teal-600 text-sm text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
            >
              {recovering ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Recovering...</>
              ) : (
                <><Cloud className="w-3.5 h-3.5" /> Recover from iCloud</>
              )}
            </button>
          ) : (
            <>
              <button
                onClick={() => window.api.openInFinder(attachment.original_path)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#141414] border border-[#262626] text-sm text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open original
              </button>
              <button
                onClick={() => window.api.exportFile(attachment.id)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500 text-sm text-white hover:bg-blue-600 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export copy
              </button>
            </>
          )}
        </div>

        {/* Metadata */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-[#636363] uppercase tracking-wider">Details</h4>
          <MetaRow label="File size" value={formatFileSize(attachment.file_size)} />
          <MetaRow label="Type" value={attachment.mime_type || attachment.file_extension || 'Unknown'} />
          {attachment.created_at && (
            <MetaRow label="Date" value={format(new Date(attachment.created_at), 'MMM d, yyyy · h:mm a')} />
          )}
          {attachment.sender_handle && <MetaRow label="From" value={attachment.sender_handle} />}
          {attachment.chat_name && <MetaRow label="Conversation" value={attachment.chat_name} />}
          <MetaRow label="Extension" value={attachment.file_extension || 'None'} />
          <MetaRow label="Status" value={unavailable ? 'In iCloud' : 'Available'} />
          {attachment.source !== 'messages' && <MetaRow label="Source" value={attachment.source === 'backup' ? 'iPhone backup' : attachment.source === 'orphan' ? 'Orphaned file' : attachment.source} />}
        </div>

        {/* OCR Text */}
        {attachment.ocr_text && (
          <div className="mt-6">
            <div className="flex items-center gap-1.5 mb-2">
              <Eye className="w-3.5 h-3.5 text-[#636363]" />
              <h4 className="text-xs font-semibold text-[#636363] uppercase tracking-wider">Text in image</h4>
            </div>
            <div className="p-3 rounded-lg bg-[#141414] border border-[#262626]">
              <p className="text-xs text-[#a3a3a3] whitespace-pre-wrap leading-relaxed select-text">{attachment.ocr_text}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-xs text-[#636363] flex-shrink-0">{label}</span>
      <span className="text-xs text-[#a3a3a3] text-right truncate select-text">{value}</span>
    </div>
  )
}
