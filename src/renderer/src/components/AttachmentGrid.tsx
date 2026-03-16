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

function typeBadge(mime: string | null, ext: string | null): { label: string; bg: string; color: string } {
  const e = (ext || '').toLowerCase().replace('.', '')
  const m = mime || ''
  if (e === 'heic' || e === 'heif') return { label: 'HEIC', bg: '#2EC4A0', color: '#04342C' }
  if (e === 'gif') return { label: 'GIF', bg: '#854F0B', color: '#FAEEDA' }
  if (e === 'pdf') return { label: 'PDF', bg: '#993C1D', color: '#FAECE7' }
  if (m.startsWith('video/') || ['mov', 'mp4', 'm4v'].includes(e)) return { label: e.toUpperCase() || 'VID', bg: '#3A3030', color: '#C8A090' }
  if (m.startsWith('audio/') || ['m4a', 'mp3', 'aac'].includes(e)) return { label: e.toUpperCase() || 'AUD', bg: '#854F0B', color: '#FAEEDA' }
  if (e === 'png') return { label: 'PNG', bg: '#534AB7', color: '#EEEDFE' }
  if (['jpg', 'jpeg'].includes(e)) return { label: 'JPG', bg: '#534AB7', color: '#EEEDFE' }
  return { label: (e || 'FILE').toUpperCase().slice(0, 4), bg: '#2A2520', color: '#9a948f' }
}

function ImageCard({ attachment, selected, onClick, chatNameMap }: { attachment: Attachment; selected: boolean; onClick: () => void; chatNameMap?: Record<string, string> }): JSX.Element {
  const badge = typeBadge(attachment.mime_type, attachment.file_extension)
  const isVideo = attachment.is_video === 1 || attachment.mime_type?.startsWith('video/')
  const isAudio = attachment.mime_type?.startsWith('audio/')
  const senderName = resolveName(attachment.chat_name, chatNameMap)
  const dateStr = attachment.created_at ? new Date(attachment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

  return (
    <div onClick={onClick}
      style={{ background: '#201C19', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
      onMouseEnter={(e) => { const el = e.currentTarget; el.querySelector<HTMLElement>('.card-overlay')?.style.setProperty('opacity', '1'); el.querySelector<HTMLElement>('.card-actions')?.style.setProperty('opacity', '1') }}
      onMouseLeave={(e) => { const el = e.currentTarget; el.querySelector<HTMLElement>('.card-overlay')?.style.setProperty('opacity', '0'); el.querySelector<HTMLElement>('.card-actions')?.style.setProperty('opacity', '0') }}>

      <div style={{ aspectRatio: '1', background: '#2A2520', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        <ThumbnailImage attachment={attachment} />
      </div>

      {/* Type badge */}
      <div style={{ position: 'absolute', top: 6, left: 6, background: badge.bg, color: badge.color, borderRadius: 4, padding: '2px 5px', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', fontFamily: "'DM Sans'" }}>{badge.label}</div>

      {/* Scene tag placeholder */}
      <div style={{ position: 'absolute', bottom: 36, left: 6, border: '1px dashed rgba(46,196,160,0.35)', borderRadius: 4, padding: '2px 6px', fontSize: 9, color: 'rgba(46,196,160,0.5)', display: 'flex', alignItems: 'center', gap: 3, fontFamily: "'DM Sans'" }}>
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(46,196,160,0.5)', flexShrink: 0 }} />scene · V2
      </div>

      {/* Hover actions */}
      <div className="card-actions" style={{ position: 'absolute', bottom: 36, right: 6, opacity: 0, display: 'flex', gap: 4, transition: 'opacity 0.15s' }}>
        <button onClick={(e) => { e.stopPropagation() }}
          style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(232,96,74,0.8)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1l3 3-3 3M11 4H5a3 3 0 000 6h1" /></svg>
        </button>
      </div>

      {/* Hover border */}
      <div className="card-overlay" style={{ position: 'absolute', inset: 0, border: selected ? '1.5px solid #E8604A' : '1.5px solid #E8604A', borderRadius: 12, opacity: selected ? 1 : 0, pointerEvents: 'none', transition: 'opacity 0.15s' }} />

      {/* Card info */}
      <div style={{ padding: '6px 8px 8px' }}>
        <div style={{ fontSize: 11, color: '#d0ccc8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 1, fontWeight: 500, fontFamily: "'DM Sans'" }}>{attachment.filename}</div>
        <div style={{ fontSize: 10, color: '#4a4542', display: 'flex', alignItems: 'center', gap: 3, fontFamily: "'DM Sans'" }}>
          <span style={{ color: '#E8604A' }}>{senderName}</span>
          {senderName && dateStr && <span>·</span>}
          <span>{dateStr}</span>
        </div>
      </div>
    </div>
  )
}

function ListRow({ attachment, selected, onClick, chatNameMap }: { attachment: Attachment; selected: boolean; onClick: () => void; chatNameMap?: Record<string, string> }): JSX.Element {
  const unavailable = !attachment.is_available
  const displayContact = attachment.chat_name ? resolveName(attachment.chat_name, chatNameMap) : ''
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg transition-all cursor-pointer text-left"
      style={{
        border: selected ? '1px solid #E8604A' : '1px solid transparent',
        background: selected ? 'rgba(232,96,74,0.04)' : 'transparent',
        opacity: unavailable ? 0.6 : 1
      }}
    >
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#E8E3DC' }}>
        {attachment.thumbnail_path || attachment.is_image ? (
          <ThumbnailImage attachment={attachment} />
        ) : unavailable ? (
          <CloudOff style={{ width: 16, height: 16, color: '#b8b2ad' }} />
        ) : (
          <FileTypeIcon attachment={attachment} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {unavailable && <Cloud style={{ width: 12, height: 12, color: '#b8b2ad', flexShrink: 0 }} />}
          <p className="text-sm truncate" style={{ color: unavailable ? '#9a948f' : '#1A1A1A' }}>{attachment.filename}</p>
          {attachment.source === 'backup' && <span style={{ fontSize: 10, color: '#E8A04A', flexShrink: 0 }}>backup</span>}
        </div>
        <p style={{ fontSize: 12, color: '#6f6a65' }} className="truncate">
          {displayContact}
          {unavailable && ' · in iCloud'}
          {attachment.created_at && ` · ${format(new Date(attachment.created_at), 'MMM d, yyyy')}`}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p style={{ fontSize: 12, color: '#9a948f' }}>{formatFileSize(attachment.file_size)}</p>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7 }}>
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
