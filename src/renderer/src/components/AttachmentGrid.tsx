import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { Image, FileText, Video, Music, File, Cloud, CloudOff } from 'lucide-react'
import { format } from 'date-fns'
import type { Attachment } from '../types'
import { clusterAttachments, Cluster } from '../utils/clusters'

interface Props {
  attachments: Attachment[]
  selectedId: number | null
  onSelect: (attachment: Attachment) => void
  onLoadMore: () => void
  hasMore: boolean
  isImageView: boolean
  chatNameMap?: Record<string, string>
  sortOrder?: string
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

function ThumbnailImage({ attachment }: { attachment: Attachment }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!attachment.is_available) { setSrc(null); return }
    const tryPath = async (): Promise<void> => {
      if (attachment.thumbnail_path) { const url = await window.api.getFileUrl(attachment.thumbnail_path); if (url) { setSrc(url); return } }
      if (attachment.is_image && attachment.original_path) { const url = await window.api.getFileUrl(attachment.original_path); if (url) { setSrc(url); return } }
      setSrc(null)
    }
    tryPath()
  }, [attachment])
  if (!src) return (<div className="w-full h-full flex items-center justify-center" style={{ background: !attachment.is_available ? '#111' : '#2A2520' }}>{!attachment.is_available ? <CloudOff className="w-6 h-6 text-[#333]" /> : <FileTypeIcon attachment={attachment} />}</div>)
  return <img src={src} alt={attachment.filename} className="w-full h-full object-cover" loading="lazy" onError={(e) => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
}

function resolveName(raw: string | null, map?: Record<string, string>): string {
  if (!raw) return ''
  const resolved = map?.[raw] || raw
  return resolved.startsWith('#') ? 'Group chat' : resolved
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

// ── Shared tile renderer ──
function Tile({ attachment, selected, onClick, chatNameMap, height }: {
  attachment: Attachment; selected: boolean; onClick: () => void; chatNameMap?: Record<string, string>; height?: number
}): JSX.Element {
  const badge = typeBadge(attachment.mime_type, attachment.file_extension)
  const senderName = resolveName(attachment.chat_name, chatNameMap)
  const dateStr = attachment.created_at ? new Date(attachment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

  return (
    <div onClick={onClick}
      style={{ background: '#201C19', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}
      onMouseEnter={(e) => { e.currentTarget.querySelector<HTMLElement>('.card-overlay')?.style.setProperty('opacity', '1') }}
      onMouseLeave={(e) => { e.currentTarget.querySelector<HTMLElement>('.card-overlay')?.style.setProperty('opacity', '0') }}>
      <div style={{ height: height || undefined, aspectRatio: height ? undefined : '1', background: '#2A2520', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <ThumbnailImage attachment={attachment} />
      </div>
      <div style={{ position: 'absolute', top: 6, left: 6, background: badge.bg, color: badge.color, borderRadius: 4, padding: '2px 5px', fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', fontFamily: "'DM Sans'" }}>{badge.label}</div>
      <div className="card-overlay" style={{ position: 'absolute', inset: 0, border: '1.5px solid #E8604A', borderRadius: 12, opacity: selected ? 1 : 0, pointerEvents: 'none', transition: 'opacity 0.15s' }} />
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

// ── Cluster header ──
function ClusterHeader({ cluster, chatNameMap }: { cluster: Cluster; chatNameMap?: Record<string, string> }): JSX.Element {
  const COLORS = ['#E8604A', '#2EC4A0', '#7F77DD']
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', letterSpacing: '-0.01em' }}>{cluster.title}</div>
        <div style={{ fontSize: 11, color: '#9a948f', marginTop: 2 }}>
          {cluster.attachments.length} attachments
          {cluster.totalReactions > 0 && ` · ♥ ${cluster.totalReactions}`}
          {` · peak ${cluster.peakHour}`}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {cluster.participants.slice(0, 3).map((p, i) => {
          const name = resolveName(p, chatNameMap)
          const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
          return (
            <div key={p} style={{ width: 20, height: 20, borderRadius: '50%', background: COLORS[i % 3], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, color: '#fff', marginLeft: i === 0 ? 0 : -5, border: '1.5px solid #F2EDE8', zIndex: 3 - i, position: 'relative' }}>{initials}</div>
          )
        })}
        <div style={{ fontSize: 10, color: '#E8604A', border: '1px solid rgba(232,96,74,0.25)', borderRadius: 999, padding: '2px 8px', cursor: 'pointer', background: 'rgba(232,96,74,0.04)', fontFamily: "'DM Sans'" }}>Share moment</div>
      </div>
    </div>
  )
}

// ── Cluster tile layout ──
function ClusterGrid({ cluster, selectedId, onSelect, chatNameMap }: { cluster: Cluster; selectedId: number | null; onSelect: (a: Attachment) => void; chatNameMap?: Record<string, string> }): JSX.Element {
  const atts = cluster.attachments
  const n = atts.length

  if (n <= 2) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 7 }}>
        {atts.map((a) => <Tile key={a.id} attachment={a} selected={selectedId === a.id} onClick={() => onSelect(a)} chatNameMap={chatNameMap} height={160} />)}
      </div>
    )
  }

  if (n <= 4) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 7 }}>
        <Tile attachment={atts[0]} selected={selectedId === atts[0].id} onClick={() => onSelect(atts[0])} chatNameMap={chatNameMap} height={180} />
        <div style={{ display: 'grid', gridTemplateRows: `repeat(${n - 1}, 1fr)`, gap: 7 }}>
          {atts.slice(1).map((a) => <Tile key={a.id} attachment={a} selected={selectedId === a.id} onClick={() => onSelect(a)} chatNameMap={chatNameMap} />)}
        </div>
      </div>
    )
  }

  // 5+ items: hero row then remaining in 4-col grid
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 7 }}>
        <Tile attachment={atts[0]} selected={selectedId === atts[0].id} onClick={() => onSelect(atts[0])} chatNameMap={chatNameMap} height={200} />
        <Tile attachment={atts[1]} selected={selectedId === atts[1].id} onClick={() => onSelect(atts[1])} chatNameMap={chatNameMap} height={200} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
        {atts.slice(2).map((a) => <Tile key={a.id} attachment={a} selected={selectedId === a.id} onClick={() => onSelect(a)} chatNameMap={chatNameMap} height={100} />)}
      </div>
    </div>
  )
}

// ── List row (unchanged) ──
function ListRow({ attachment, selected, onClick, chatNameMap }: { attachment: Attachment; selected: boolean; onClick: () => void; chatNameMap?: Record<string, string> }): JSX.Element {
  const unavailable = !attachment.is_available
  const displayContact = attachment.chat_name ? resolveName(attachment.chat_name, chatNameMap) : ''
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-3 rounded-lg transition-all cursor-pointer text-left"
      style={{ border: selected ? '1px solid #E8604A' : '1px solid transparent', background: selected ? 'rgba(232,96,74,0.04)' : 'transparent', opacity: unavailable ? 0.6 : 1 }}>
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#E8E3DC' }}>
        {attachment.thumbnail_path || attachment.is_image ? <ThumbnailImage attachment={attachment} /> : unavailable ? <CloudOff style={{ width: 16, height: 16, color: '#b8b2ad' }} /> : <FileTypeIcon attachment={attachment} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {unavailable && <Cloud style={{ width: 12, height: 12, color: '#b8b2ad', flexShrink: 0 }} />}
          <p className="text-sm truncate" style={{ color: unavailable ? '#9a948f' : '#1A1A1A' }}>{attachment.filename}</p>
        </div>
        <p style={{ fontSize: 12, color: '#6f6a65' }} className="truncate">
          {displayContact}{unavailable && ' · in iCloud'}{attachment.created_at && ` · ${format(new Date(attachment.created_at), 'MMM d, yyyy')}`}
        </p>
      </div>
      <div className="text-right flex-shrink-0"><p style={{ fontSize: 12, color: '#9a948f' }}>{formatFileSize(attachment.file_size)}</p></div>
    </button>
  )
}

// ── Main component ──
export function AttachmentGrid({ attachments, selectedId, onSelect, onLoadMore, hasMore, isImageView, chatNameMap, sortOrder }: Props): JSX.Element {
  const observerRef = useRef<IntersectionObserver>()
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect()
    observerRef.current = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && hasMore) onLoadMore() })
    if (node) observerRef.current.observe(node)
  }, [hasMore, onLoadMore])

  // Compute clusters for grid view
  const clusters = useMemo(() => {
    if (!isImageView || attachments.length === 0) return []
    let cls = clusterAttachments(attachments)

    // Sort clusters by sortOrder
    if (sortOrder === 'burst') cls.sort((a, b) => b.attachments.length - a.attachments.length)
    if (sortOrder === 'most-reacted') {
      cls = cls.map((c) => ({ ...c, attachments: [...c.attachments].sort((a, b) => (b.reaction_count || 0) - (a.reaction_count || 0)) }))
    }

    return cls
  }, [attachments, isImageView, sortOrder])

  // Fallback: if clustering produces <2 clusters or all tiny, render flat
  const useClusters = clusters.length >= 2 || (clusters.length === 1 && clusters[0].attachments.length >= 4)

  if (attachments.length === 0) {
    return (<div className="flex flex-col items-center justify-center h-full text-[#636363]"><File className="w-10 h-10 mb-3" /><p className="text-sm">No attachments found</p></div>)
  }

  if (!isImageView) {
    return (
      <><div className="space-y-1">{attachments.map((att) => <ListRow key={att.id} attachment={att} selected={selectedId === att.id} onClick={() => onSelect(att)} chatNameMap={chatNameMap} />)}</div>
      {hasMore && <div ref={loadMoreRef} className="h-10" />}</>
    )
  }

  // Clustered masonry view
  if (useClusters) {
    return (
      <>
        {clusters.map((cluster) => (
          <div key={cluster.id} style={{ marginBottom: 20 }}>
            <ClusterHeader cluster={cluster} chatNameMap={chatNameMap} />
            <ClusterGrid cluster={cluster} selectedId={selectedId} onSelect={onSelect} chatNameMap={chatNameMap} />
            <div style={{ height: 1, background: '#EAE5DF', margin: '4px 0 20px' }} />
          </div>
        ))}
        {hasMore && <div ref={loadMoreRef} className="h-10" />}
      </>
    )
  }

  // Flat grid fallback
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7 }}>
        {attachments.map((att) => <Tile key={att.id} attachment={att} selected={selectedId === att.id} onClick={() => onSelect(att)} chatNameMap={chatNameMap} />)}
      </div>
      {hasMore && <div ref={loadMoreRef} className="h-10" />}
    </>
  )
}
