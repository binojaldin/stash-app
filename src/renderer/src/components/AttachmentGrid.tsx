import { useRef, useCallback, useEffect, useState } from 'react'
import { Image, FileText, Video, Music, File } from 'lucide-react'
import { format } from 'date-fns'
import type { Attachment } from '../types'

interface Props {
  attachments: Attachment[]
  selectedId: number | null
  onSelect: (attachment: Attachment) => void
  onLoadMore: () => void
  hasMore: boolean
  isImageView: boolean
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
    if (attachment.thumbnail_path) {
      window.api.getFileUrl(attachment.thumbnail_path).then((url) => setSrc(url))
    } else if (attachment.is_image && attachment.original_path) {
      window.api.getFileUrl(attachment.original_path).then((url) => setSrc(url))
    }
  }, [attachment])

  if (!src) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#1c1c1c]">
        <FileTypeIcon attachment={attachment} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={attachment.filename}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={(e) => {
        ;(e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

function ImageCard({
  attachment,
  selected,
  onClick
}: {
  attachment: Attachment
  selected: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`group rounded-lg overflow-hidden border transition-all cursor-pointer text-left ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-500/30'
          : 'border-[#262626] hover:border-[#333]'
      }`}
    >
      <div className="aspect-square overflow-hidden bg-[#141414]">
        <ThumbnailImage attachment={attachment} />
      </div>
      <div className="p-2">
        <p className="text-xs text-white truncate">{attachment.filename}</p>
        <p className="text-[10px] text-[#636363] truncate">
          {attachment.sender_handle || attachment.chat_name || ''}
          {attachment.created_at && ` · ${format(new Date(attachment.created_at), 'MMM d, yyyy')}`}
        </p>
      </div>
    </button>
  )
}

function ListRow({
  attachment,
  selected,
  onClick
}: {
  attachment: Attachment
  selected: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer text-left ${
        selected
          ? 'border-blue-500 bg-blue-500/5'
          : 'border-transparent hover:bg-[#141414]'
      }`}
    >
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-[#1c1c1c] flex items-center justify-center">
        {attachment.thumbnail_path || attachment.is_image ? (
          <ThumbnailImage attachment={attachment} />
        ) : (
          <FileTypeIcon attachment={attachment} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{attachment.filename}</p>
        <p className="text-xs text-[#636363]">
          {attachment.sender_handle || attachment.chat_name || ''}
          {attachment.created_at && ` · ${format(new Date(attachment.created_at), 'MMM d, yyyy')}`}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-[#636363]">{formatFileSize(attachment.file_size)}</p>
      </div>
    </button>
  )
}

export function AttachmentGrid({
  attachments,
  selectedId,
  onSelect,
  onLoadMore,
  hasMore,
  isImageView
}: Props): JSX.Element {
  const observerRef = useRef<IntersectionObserver>()
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect()
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          onLoadMore()
        }
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
            <ImageCard
              key={att.id}
              attachment={att}
              selected={selectedId === att.id}
              onClick={() => onSelect(att)}
            />
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
          <ListRow
            key={att.id}
            attachment={att}
            selected={selectedId === att.id}
            onClick={() => onSelect(att)}
          />
        ))}
      </div>
      {hasMore && <div ref={loadMoreRef} className="h-10" />}
    </>
  )
}
