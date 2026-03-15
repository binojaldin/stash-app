import { useRef, useCallback, useEffect, useState } from 'react'
import { Image, FileText, Video, Music, File, Cloud, CloudOff } from 'lucide-react'
import { format } from 'date-fns'
import type { Attachment } from '../types'

interface Props {
  attachments: Attachment[]
  selectedId: number | null
  onSelect: (attachment: Attachment) => void
  onLoadMore: () => void
  hasMore: boolean
  isImageView: boolean
  chatNameMap?: Record<string, string>
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function FileTypeIcon({ attachment }: { attachment: Attachment }): JSX.Element {
  if (attachment.is_image) return <Image className="w-6 h-6 text-blue-400" />
  if (attachment.is_video) return <Video className="w-6 h-6 text-purple-400" />
  if (attachment.is_document) return <FileText className="w-6 h-6 text-orange-400" />
  if (attachment.mime_type?.startsWith('audio/')) return <Music className="w-6 h-6 text-green-400" />
  return <File className="w-6 h-6 text-[#636363]" />
}

function SourceBadge({ attachment }: { attachment: Attachment }): JSX.Element | null {
  if (!attachment.is_available) {
    return (
      <span className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-[#8b8b8b]">
        <Cloud className="w-3 h-3" />
        Not on this Mac
      </span>
    )
  }
  if (attachment.source === 'backup') {
    return (
      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-amber-900/70 text-[10px] text-amber-300">
        iPhone backup
      </span>
    )
  }
  if (attachment.source === 'orphan') {
    return (
      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-[#636363]">
        Unknown conversation
      </span>
    )
  }
  return null
}

function ThumbnailImage({ attachment }: { attachment: Attachment }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!attachment.is_available) { setSrc(null); return }
    // Try thumbnail first, then fall back to original file for images
    const tryPath = async (): Promise<void> => {
      if (attachment.thumbnail_path) {
        const url = await window.api.getFileUrl(attachment.thumbnail_path)
        if (url) { setSrc(url); return }
      }
      // No thumbnail or thumbnail missing — use original if it's an image
      if (attachment.is_image && attachment.original_path) {
        const url = await window.api.getFileUrl(attachment.original_path)
        if (url) { setSrc(url); return }
      }
      setSrc(null)
    }
    tryPath()
  }, [attachment])

  if (!src) {
    return (
      <div className={`w-full h-full flex items-center justify-center ${!attachment.is_available ? 'bg-[#111]' : 'bg-[#1c1c1c]'}`}>
        {!attachment.is_available ? (
          <CloudOff className="w-6 h-6 text-[#333]" />
        ) : (
          <FileTypeIcon attachment={attachment} />
        )}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={attachment.filename}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

function resolveName(raw: string | null, map?: Record<string, string>): string {
  if (!raw) return ''
  const resolved = map?.[raw] || raw
  if (resolved.startsWith('#')) return 'Group chat'
  return resolved
}

function ImageCard({ attachment, selected, onClick, chatNameMap }: { attachment: Attachment; selected: boolean; onClick: () => void; chatNameMap?: Record<string, string> }): JSX.Element {
  const unavailable = !attachment.is_available
  const displayContact = attachment.chat_name ? resolveName(attachment.chat_name, chatNameMap) : ''
  return (
    <button
      onClick={onClick}
      className="group overflow-hidden transition-all cursor-pointer text-left relative"
      style={{
        borderRadius: 10,
        border: selected ? '1.5px solid #E8604A' : unavailable ? '1px dashed rgba(255,255,255,0.06)' : '1px solid rgba(255,255,255,0.06)',
        background: '#201C19',
        opacity: unavailable ? 0.6 : 1
      }}
    >
      <div className="aspect-square overflow-hidden relative" style={{ background: '#1A1714' }}>
        <ThumbnailImage attachment={attachment} />
        <SourceBadge attachment={attachment} />
      </div>
      <div style={{ padding: '8px 10px' }}>
        <p className="truncate" style={{ fontSize: 11, fontWeight: 500, color: unavailable ? '#636363' : '#FFFFFF' }}>{attachment.filename}</p>
        <p className="truncate" style={{ fontSize: 10 }}>
          <span style={{ color: '#E8604A', fontWeight: 400 }}>{displayContact}</span>
          {displayContact && attachment.created_at && <span style={{ color: '#444444' }}> · </span>}
          {attachment.created_at && <span style={{ color: '#555555', fontWeight: 300 }}>{format(new Date(attachment.created_at), 'MMM d, yyyy')}</span>}
        </p>
      </div>
    </button>
  )
}

function ListRow({ attachment, selected, onClick, chatNameMap }: { attachment: Attachment; selected: boolean; onClick: () => void; chatNameMap?: Record<string, string> }): JSX.Element {
  const unavailable = !attachment.is_available
  const displayContact = attachment.chat_name ? resolveName(attachment.chat_name, chatNameMap) : ''
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer text-left ${
        selected
          ? 'border-blue-500 bg-blue-500/5'
          : 'border-transparent hover:bg-[#141414]'
      } ${unavailable ? 'opacity-60' : ''}`}
    >
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-[#1c1c1c] flex items-center justify-center relative">
        {attachment.thumbnail_path || attachment.is_image ? (
          <ThumbnailImage attachment={attachment} />
        ) : unavailable ? (
          <CloudOff className="w-4 h-4 text-[#333]" />
        ) : (
          <FileTypeIcon attachment={attachment} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {unavailable && <Cloud className="w-3 h-3 text-[#4a4a4a] flex-shrink-0" />}
          <p className={`text-sm truncate ${unavailable ? 'text-[#636363]' : 'text-white'}`}>{attachment.filename}</p>
          {attachment.source === 'backup' && <span className="text-[10px] text-amber-400 flex-shrink-0">backup</span>}
        </div>
        <p className="text-xs text-[#636363]">
          {displayContact}
          {unavailable && ' · in iCloud'}
          {attachment.created_at && ` · ${format(new Date(attachment.created_at), 'MMM d, yyyy')}`}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-[#636363]">{formatFileSize(attachment.file_size)}</p>
      </div>
    </button>
  )
}

export function AttachmentGrid({ attachments, selectedId, onSelect, onLoadMore, hasMore, isImageView, chatNameMap }: Props): JSX.Element {
  const observerRef = useRef<IntersectionObserver>()
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect()
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) onLoadMore()
      })
      if (node) observerRef.current.observe(node)
    },
    [hasMore, onLoadMore]
  )

  if (attachments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#636363]">
        <File className="w-10 h-10 mb-3" />
        <p className="text-sm">No attachments found</p>
      </div>
    )
  }

  if (isImageView) {
    return (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {attachments.map((att) => (
            <ImageCard key={att.id} attachment={att} selected={selectedId === att.id} onClick={() => onSelect(att)} chatNameMap={chatNameMap} />
          ))}
        </div>
        {hasMore && <div ref={loadMoreRef} className="h-10" />}
      </>
    )
  }

  return (
    <>
      <div className="space-y-1">
        {attachments.map((att) => (
          <ListRow key={att.id} attachment={att} selected={selectedId === att.id} onClick={() => onSelect(att)} chatNameMap={chatNameMap} />
        ))}
      </div>
      {hasMore && <div ref={loadMoreRef} className="h-10" />}
    </>
  )
}
