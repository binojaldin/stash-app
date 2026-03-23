import { useState, useEffect, useCallback, useRef } from 'react'
import { Grid, List } from 'lucide-react'
import { AttachmentGrid } from './AttachmentGrid'
import { DetailPanel } from './DetailPanel'
import type { Attachment, Filters, Stats } from '../types'

type MainView =
  | { kind: 'global-insights' }
  | { kind: 'global-attachments' }
  | { kind: 'person-insights'; person: string }
  | { kind: 'person-attachments'; person: string }

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'sender', label: 'By sender' },
  { value: 'most-reacted', label: 'Most reacted' },
  { value: 'burst', label: 'Conversation burst' }
] as const

type SortOrder = typeof SORT_OPTIONS[number]['value']

interface AttachmentsViewProps {
  mainView: MainView
  dateRange: string
  stats: Stats
  chatNameMap: Record<string, string>
  onNavigate: (view: MainView) => void
}

function dateRangeToBounds(range: string): { from: string | null; to: string | null } {
  const now = new Date()
  if (/^\d{4}$/.test(range)) {
    const y = parseInt(range)
    return { from: new Date(y, 0, 1).toISOString(), to: new Date(y, 11, 31, 23, 59, 59).toISOString() }
  }
  if (/^\d{4}-\d{2}$/.test(range)) {
    const [y, m] = range.split('-').map(Number)
    return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 0, 23, 59, 59).toISOString() }
  }
  switch (range) {
    case '7days': { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: d.toISOString(), to: null } }
    case '30days': { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: d.toISOString(), to: null } }
    case 'month': { return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: null } }
    case 'year': { return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: null } }
    default: return { from: null, to: null }
  }
}

export function AttachmentsView({ mainView, dateRange, stats, chatNameMap, onNavigate }: AttachmentsViewProps): JSX.Element {
  const [filters, setFilters] = useState<Filters>({ type: 'all' })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [query, setQuery] = useState('')
  const debounceRef = useRef<NodeJS.Timeout>()

  useEffect(() => { localStorage.setItem('stash-view-mode', viewMode) }, [viewMode])

  // Derive effective chat filter from navigation state
  const effectiveChatName = (mainView.kind === 'person-attachments' || mainView.kind === 'person-insights')
    ? mainView.person : undefined

  const isImageView = viewMode === 'grid'

  const loadAttachments = useCallback(async () => {
    const filterParams: Record<string, string> = {}
    if (filters.type && filters.type !== 'all') filterParams.type = filters.type
    if (effectiveChatName) filterParams.chatName = effectiveChatName
    const bounds = dateRangeToBounds(dateRange)
    if (bounds.from) filterParams.dateFrom = bounds.from
    if (bounds.to) filterParams.dateTo = bounds.to
    const results = query
      ? await window.api.searchAttachments(query, filterParams, 0, 50, sortOrder)
      : await window.api.getAttachments(filterParams, 0, 50, sortOrder)
    setAttachments(results as Attachment[]); setPage(0); setHasMore((results as Attachment[]).length === 50)
  }, [query, filters, sortOrder, dateRange, effectiveChatName])

  const loadMore = useCallback(async () => {
    const nextPage = page + 1
    const filterParams: Record<string, string> = {}
    if (filters.type && filters.type !== 'all') filterParams.type = filters.type
    if (effectiveChatName) filterParams.chatName = effectiveChatName
    const bounds = dateRangeToBounds(dateRange)
    if (bounds.from) filterParams.dateFrom = bounds.from
    if (bounds.to) filterParams.dateTo = bounds.to
    const results = query
      ? await window.api.searchAttachments(query, filterParams, nextPage, 50, sortOrder)
      : await window.api.getAttachments(filterParams, nextPage, 50, sortOrder)
    const newResults = results as Attachment[]
    setAttachments((prev) => [...prev, ...newResults]); setPage(nextPage); setHasMore(newResults.length === 50)
  }, [query, filters, page, sortOrder, dateRange, effectiveChatName])

  // Reload when mainView, filters, sort, date, or query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadAttachments(), 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, filters, sortOrder, dateRange, mainView])

  // Close sort menu on click outside
  useEffect(() => {
    if (!showSortMenu) return
    const h = (): void => setShowSortMenu(false)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [showSortMenu])

  const selectedIndex = selectedAttachment ? attachments.findIndex((a) => a.id === selectedAttachment.id) : -1

  return (
    <>
      {/* Control bar */}
      <div style={{ height: 48, background: '#F6F3EF', borderBottom: '1px solid #EAE5DF', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', flexShrink: 0 }}>
        {[
          { label: 'All', type: 'all', color: '#888' },
          { label: 'Images', type: 'images', color: '#E8604A' },
          { label: 'Videos', type: 'videos', color: '#2EC4A0' },
          { label: 'Docs', type: 'documents', color: '#7F77DD' },
          { label: 'Audio', type: 'audio', color: '#BA7517' }
        ].map(({ label, type: t, color }) => (
          <button key={t} onClick={() => setFilters({ ...filters, type: t })}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: `1px solid ${(filters.type || 'all') === t ? 'rgba(0,0,0,0.1)' : 'transparent'}`, background: (filters.type || 'all') === t ? '#fff' : 'transparent', color: (filters.type || 'all') === t ? '#1A1A1A' : '#8a8480', fontWeight: (filters.type || 'all') === t ? 500 : 400, fontFamily: "'DM Sans'" }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />{label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: '#EAE5DF', flexShrink: 0, margin: '0 4px' }} />
        <span style={{ fontSize: 11, color: '#9a948f', whiteSpace: 'nowrap' }}>{attachments.length} files</span>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu) }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, fontSize: 12, color: '#6f6a65', cursor: 'pointer', border: '1px solid #EAE5DF', background: '#fff', fontFamily: "'DM Sans'", whiteSpace: 'nowrap' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 3h10M3 6h6M5 9h2" /></svg>
            {SORT_OPTIONS.find((o) => o.value === sortOrder)?.label}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4l3 3 3-3" /></svg>
          </button>
          {showSortMenu && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, background: '#fff', border: '1px solid #EAE5DF', borderRadius: 10, overflow: 'hidden', width: 148, zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
              {SORT_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => { setSortOrder(opt.value); setShowSortMenu(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 12, color: sortOrder === opt.value ? '#E8604A' : '#6f6a65', fontWeight: sortOrder === opt.value ? 500 : 400, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'" }}>{opt.label}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ width: 1, height: 20, background: '#EAE5DF', flexShrink: 0, margin: '0 4px' }} />
        <div style={{ display: 'flex', background: '#EAE5DF', borderRadius: 8, padding: 2, gap: 1 }}>
          <button onClick={() => setViewMode('grid')} style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: viewMode === 'grid' ? '#fff' : 'transparent', border: 'none', cursor: 'pointer' }}>
            <Grid style={{ width: 14, height: 14, stroke: viewMode === 'grid' ? '#1A1A1A' : '#8a8480' }} /></button>
          <button onClick={() => setViewMode('list')} style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: viewMode === 'list' ? '#fff' : 'transparent', border: 'none', cursor: 'pointer' }}>
            <List style={{ width: 14, height: 14, stroke: viewMode === 'list' ? '#1A1A1A' : '#8a8480' }} /></button>
        </div>
      </div>

      {/* Grid/list */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '0 14px 14px' }}>
        <AttachmentGrid attachments={attachments} selectedId={selectedAttachment?.id ?? null} onSelect={setSelectedAttachment} onLoadMore={loadMore} hasMore={hasMore} isImageView={isImageView} chatNameMap={chatNameMap} sortOrder={sortOrder} />
      </div>

      {/* Detail panel */}
      {selectedAttachment && (
        <DetailPanel attachment={selectedAttachment} attachments={attachments} currentIndex={selectedIndex} onClose={() => setSelectedAttachment(null)} onNavigate={setSelectedAttachment} />
      )}
    </>
  )
}
