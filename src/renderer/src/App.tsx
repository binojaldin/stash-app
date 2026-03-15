import { useState, useEffect, useCallback, useRef } from 'react'
import { Grid, List, ChevronDown, Sparkles, Image, Video, FileText, Music } from 'lucide-react'
import { PermissionScreen } from './components/PermissionScreen'
import { ChatPriorityScreen } from './components/ChatPriorityScreen'
import { IndexingOverlay } from './components/IndexingOverlay'
import { SearchBar, SearchBarRef } from './components/SearchBar'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { AttachmentGrid } from './components/AttachmentGrid'
import { DetailPanel } from './components/DetailPanel'
import { WrappedView } from './components/WrappedView'
import type { Attachment, ChatSummary, Filters, IndexingProgress, Stats } from './types'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'sender', label: 'By sender' }
] as const

type SortOrder = typeof SORT_OPTIONS[number]['value']
type AppState = 'checking' | 'loading' | 'no-access' | 'priority' | 'main'

export default function App(): JSX.Element {
  const [appState, setAppState] = useState<AppState>('checking')
  const [isIndexing, setIsIndexing] = useState(false)
  const [showIndexing, setShowIndexing] = useState(true)
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([])
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({
    total: 0, processed: 0, currentFile: ''
  })
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({ type: 'all' })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null)
  const [stats, setStats] = useState<Stats>({
    total: 0, images: 0, videos: 0, documents: 0, audio: 0, unavailable: 0, chatNames: [], chatNameMap: {}
  })
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('stash-view-mode') as 'grid' | 'list') || 'grid'
  )
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showWrapped, setShowWrapped] = useState(false)
  const [userActivated, setUserActivated] = useState(false)
  const [wordmarkReady, setWordmarkReady] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()
  const searchBarRef = useRef<SearchBarRef>(null)

  // Persist view mode
  useEffect(() => { localStorage.setItem('stash-view-mode', viewMode) }, [viewMode])

  // Wordmark animation
  useEffect(() => { const t = setTimeout(() => setWordmarkReady(true), 300); return () => clearTimeout(t) }, [])

  // ── Startup flow: getStats only, never getChatSummaries ──
  useEffect(() => {
    let cancelled = false

    const startup = async (): Promise<void> => {
      const access = await window.api.checkDiskAccess()
      if (cancelled) return
      if (!access) {
        setAppState('no-access')
        const interval = setInterval(async () => {
          const ok = await window.api.checkDiskAccess()
          if (ok) { clearInterval(interval); if (!cancelled) startup() }
        }, 2000)
        return
      }

      // getStats is fast — no contact resolution
      setAppState('loading')
      try {
        const s = await window.api.getStats()
        if (cancelled) return
        if (s.total > 0) {
          setStats(s)
          setAppState('main')
        } else {
          // Empty DB — show priority screen (fetch summaries now, user asked for it)
          const summaries = await window.api.getChatSummaries()
          if (cancelled) return
          if (summaries.length > 0) {
            setChatSummaries(summaries)
            setAppState('priority')
            window.api.resolveChatNames()
          } else {
            setAppState('main')
          }
        }
      } catch (err) {
        console.error('[App] Startup error:', err)
        setAppState('main')
      }
    }

    startup()
    return () => { cancelled = true }
  }, [])

  // Listen for resolved contact names (background)
  useEffect(() => {
    const unsub = window.api.onChatNamesResolved((data) => {
      setChatSummaries(data as ChatSummary[])
    })
    return unsub
  }, [])

  // Manage conversations — additive, no reset
  const handleManageConversations = useCallback(async () => {
    setAppState('loading')
    const summaries = await window.api.getChatSummaries()
    setChatSummaries(summaries)
    setAppState('priority')
    window.api.resolveChatNames()
  }, [])

  // Full reset — only from explicit reset button
  const handleResetEverything = useCallback(async () => {
    const confirmed = await window.api.confirmReset()
    if (!confirmed) return
    await window.api.resetIndexing()
    setAttachments([])
    setStats({ total: 0, images: 0, videos: 0, documents: 0, audio: 0, unavailable: 0, chatNames: [], chatNameMap: {} })
    const summaries = await window.api.getChatSummaries()
    setChatSummaries(summaries)
    setAppState('priority')
    window.api.resolveChatNames()
  }, [])

  useEffect(() => {
    const unsubs = [
      window.api.onFocusSearch(() => searchBarRef.current?.focus()),
      window.api.onToggleSidebar(() => setShowSidebar((p) => !p)),
      window.api.onSetViewGrid(() => setViewMode('grid')),
      window.api.onSetViewList(() => setViewMode('list')),
      window.api.onManageConversations(() => handleManageConversations())
    ]
    return () => unsubs.forEach((u) => u())
  }, [handleManageConversations])

  const handleStartWithPriority = useCallback((priorityChats: string[]) => {
    setAppState('main')
    setIsIndexing(true)
    setShowIndexing(true)
    window.api.startIndexing(priorityChats)
  }, [])

  // Listen for indexing progress — preserve current filters
  useEffect(() => {
    const unsub = window.api.onIndexingProgress((data) => {
      setIndexingProgress(data)
      if (data.total > 0 && data.processed >= data.total && data.phase === 'Up to date') {
        setIsIndexing(false)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.api.onNewAttachment(() => { loadAttachments(); loadStats() })
    return unsub
  }, [])

  const loadStats = useCallback(async (chatNameFilter?: string) => {
    const s = await window.api.getStats(chatNameFilter)
    setStats(s)
  }, [])

  const loadAttachments = useCallback(async () => {
    const filterParams: Record<string, string> = {}
    if (filters.type && filters.type !== 'all') filterParams.type = filters.type
    if (filters.chatName) filterParams.chatName = filters.chatName
    if (filters.dateRange) filterParams.dateRange = filters.dateRange

    const results = query
      ? await window.api.searchAttachments(query, filterParams, 0, 50, sortOrder)
      : await window.api.getAttachments(filterParams, 0, 50, sortOrder)
    setAttachments(results as Attachment[])
    setPage(0)
    setHasMore((results as Attachment[]).length === 50)
  }, [query, filters, sortOrder])

  const loadMore = useCallback(async () => {
    const nextPage = page + 1
    const filterParams: Record<string, string> = {}
    if (filters.type && filters.type !== 'all') filterParams.type = filters.type
    if (filters.chatName) filterParams.chatName = filters.chatName
    if (filters.dateRange) filterParams.dateRange = filters.dateRange

    const results = query
      ? await window.api.searchAttachments(query, filterParams, nextPage, 50, sortOrder)
      : await window.api.getAttachments(filterParams, nextPage, 50, sortOrder)
    const newResults = results as Attachment[]
    setAttachments((prev) => [...prev, ...newResults])
    setPage(nextPage)
    setHasMore(newResults.length === 50)
  }, [query, filters, page, sortOrder])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { loadAttachments() }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, filters, sortOrder, loadAttachments])

  // Reload stats when conversation filter changes
  useEffect(() => {
    if (appState === 'main') loadStats(filters.chatName)
  }, [filters.chatName])

  // Reload after indexing completes
  useEffect(() => {
    if (!isIndexing && appState === 'main') { loadStats(filters.chatName); loadAttachments() }
  }, [isIndexing])

  // Load data when entering main view
  useEffect(() => {
    if (appState === 'main') { loadStats(); loadAttachments() }
  }, [appState])

  // Close sort menu on click outside
  useEffect(() => {
    if (!showSortMenu) return
    const handler = (): void => setShowSortMenu(false)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [showSortMenu])

  const selectedIndex = selectedAttachment ? attachments.findIndex((a) => a.id === selectedAttachment.id) : -1

  // ── Render by state ──
  if (appState === 'checking' || appState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] gap-3">
        <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-[#636363]">Loading your library...</p>
      </div>
    )
  }

  if (appState === 'no-access') return <PermissionScreen />
  if (appState === 'priority') return (
    <ChatPriorityScreen
      chats={chatSummaries}
      indexedChats={stats.chatNames}
      onStart={handleStartWithPriority}
      onReset={handleResetEverything}
      onBack={stats.total > 0 ? () => setAppState('main') : undefined}
    />
  )

  const isImageView = viewMode === 'grid' && (!filters.type || filters.type === 'all' || filters.type === 'images')
  const showContent = userActivated || !!query || !!filters.chatName || (filters.type && filters.type !== 'all') || !!filters.dateRange

  const mediaCards = [
    { icon: Image, label: 'Images', count: stats.images, bg: '#FFF0ED', color: '#E8604A', type: 'images' },
    { icon: Video, label: 'Videos', count: stats.videos, bg: '#EAF8F4', color: '#2EC4A0', type: 'videos' },
    { icon: FileText, label: 'Documents', count: stats.documents, bg: '#F5F0FF', color: '#8B7FD4', type: 'documents' },
    { icon: Music, label: 'Audio', count: stats.audio, bg: '#FFF8ED', color: '#E8A04A', type: 'audio' }
  ]

  return (
    <div className="flex" style={{ background: '#0A0A0A', height: '100vh', width: '100vw' }}>
      {showWrapped && <WrappedView onClose={() => setShowWrapped(false)} />}

      {isIndexing && showIndexing && indexingProgress.total > 0 && (
        <IndexingOverlay progress={indexingProgress} onBrowse={() => setShowIndexing(false)} />
      )}

      {/* Icon Rail */}
      <IconRail />

      {/* Sidebar */}
      <div className="flex flex-col" style={{ background: '#0F0F0F' }}>
        {/* Sidebar title bar */}
        <div className="flex items-center justify-between flex-shrink-0" style={{ height: 44, padding: '0 14px', borderBottom: '1px solid #1A1A1A', WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 11, letterSpacing: '0.24em', color: '#FFFFFF' }}>
            ST<span style={{ fontWeight: 400, color: '#E8604A', opacity: wordmarkReady ? 1 : 0, transform: wordmarkReady ? 'translateY(0)' : 'translateY(4px)', transition: 'opacity 0.4s cubic-bezier(0.16,1,0.3,1), transform 0.4s cubic-bezier(0.16,1,0.3,1)', transitionDelay: '0ms', display: 'inline-block' }}>A</span><span style={{ fontWeight: 400, color: '#E8604A', opacity: wordmarkReady ? 1 : 0, transform: wordmarkReady ? 'translateY(0)' : 'translateY(4px)', transition: 'opacity 0.4s cubic-bezier(0.16,1,0.3,1), transform 0.4s cubic-bezier(0.16,1,0.3,1)', transitionDelay: '150ms', display: 'inline-block' }}>S</span><span style={{ fontWeight: 400, color: '#E8604A', opacity: wordmarkReady ? 1 : 0, transform: wordmarkReady ? 'translateY(0)' : 'translateY(4px)', transition: 'opacity 0.4s cubic-bezier(0.16,1,0.3,1), transform 0.4s cubic-bezier(0.16,1,0.3,1)', transitionDelay: '300ms', display: 'inline-block' }}>H</span>
          </span>
        </div>

        {showSidebar && (
          <Sidebar
            stats={stats}
            filters={filters}
            onFilterChange={(f) => { setFilters(f); setUserActivated(true) }}
            onManageConversations={!isIndexing ? handleManageConversations : undefined}
            onHideChat={async (rawName) => { await window.api.hideChat(rawName); loadStats() }}
            isIndexing={isIndexing}
            indexingProgress={indexingProgress}
          />
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ background: '#F5F0EA' }}>
        {/* Title bar drag region */}
        <div className="flex-shrink-0 flex items-center justify-end pr-4" style={{ height: 44, borderBottom: '1px solid #EAE5DF', WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <button
            onClick={() => setShowWrapped(true)}
            style={{ background: '#E8604A', color: '#FFFFFF', borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#C44A36' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#E8604A' }}
          >
            <Sparkles style={{ width: 12, height: 12, display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Wrapped
          </button>
        </div>

        {/* Media summary cards */}
        {stats.total > 0 && (
          <div className="flex gap-1.5 flex-shrink-0" style={{ padding: '8px 14px 6px' }}>
            {mediaCards.map(({ icon: Icon, label, count, bg, color, type }) => (
              <button key={type} onClick={() => { setFilters({ ...filters, type }); setUserActivated(true) }}
                className="flex-1 transition-all"
                style={{ background: '#FFFFFF', border: '1px solid #EAE5DF', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left', maxHeight: 72 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}>
                  <Icon style={{ width: 10, height: 10, stroke: color }} />
                </div>
                <div style={{ fontSize: 9, color: '#AAAAAA', fontFamily: 'DM Sans' }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color, fontFamily: 'DM Sans' }}>{count.toLocaleString()}</div>
              </button>
            ))}
          </div>
        )}

        {/* Search bar */}
        <div style={{ padding: '10px 14px 0' }} className="flex-shrink-0">
          <SearchBar ref={searchBarRef} value={query} onChange={(v) => { setQuery(v); if (v) setUserActivated(true) }} />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between flex-shrink-0" style={{ padding: '8px 14px' }}>
          <div className="flex items-center gap-1">
            <button onClick={() => setViewMode('grid')} style={{ padding: 6, borderRadius: 6, background: viewMode === 'grid' ? '#E8E3DC' : 'transparent', color: viewMode === 'grid' ? '#1A1A1A' : '#AAAAAA' }}>
              <Grid style={{ width: 14, height: 14 }} />
            </button>
            <button onClick={() => setViewMode('list')} style={{ padding: 6, borderRadius: 6, background: viewMode === 'list' ? '#E8E3DC' : 'transparent', color: viewMode === 'list' ? '#1A1A1A' : '#AAAAAA' }}>
              <List style={{ width: 14, height: 14 }} />
            </button>
          </div>

          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu) }}
              className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 300, color: '#AAAAAA', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              {SORT_OPTIONS.find((o) => o.value === sortOrder)?.label}
              <ChevronDown style={{ width: 12, height: 12 }} />
            </button>
            {showSortMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 rounded-lg shadow-lg z-20 overflow-hidden" style={{ background: '#FFFFFF', border: '1px solid #EAE5DF' }}>
                {SORT_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => { setSortOrder(opt.value); setShowSortMenu(false) }}
                    className="w-full text-left px-3 py-2 transition-colors" style={{ fontSize: 11, color: sortOrder === opt.value ? '#1A1A1A' : '#AAAAAA', background: sortOrder === opt.value ? '#F5F0EA' : 'transparent' }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 14px 14px' }}>
          {showContent ? (
            <AttachmentGrid
              attachments={attachments}
              selectedId={selectedAttachment?.id ?? null}
              onSelect={setSelectedAttachment}
              onLoadMore={loadMore}
              hasMore={hasMore}
              isImageView={isImageView}
              chatNameMap={stats.chatNameMap}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Grid style={{ width: 40, height: 40, color: '#C8C0B8', marginBottom: 16 }} />
              <p style={{ color: '#1A1A1A', fontSize: 16, fontWeight: 500 }}>Select a conversation to get started</p>
              <p style={{ color: '#888888', fontSize: 13, marginTop: 4 }}>or search for something specific above</p>
            </div>
          )}
        </div>

        {selectedAttachment && (
          <DetailPanel
            attachment={selectedAttachment}
            attachments={attachments}
            currentIndex={selectedIndex}
            onClose={() => setSelectedAttachment(null)}
            onNavigate={setSelectedAttachment}
          />
        )}
      </div>
    </div>
  )
}
