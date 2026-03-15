import { useState, useEffect, useCallback, useRef } from 'react'
import { Grid, List, ChevronDown } from 'lucide-react'
import { PermissionScreen } from './components/PermissionScreen'
import { ChatPriorityScreen } from './components/ChatPriorityScreen'
import { IndexingOverlay } from './components/IndexingOverlay'
import { SearchBar, SearchBarRef } from './components/SearchBar'
import { Sidebar } from './components/Sidebar'
import { AttachmentGrid } from './components/AttachmentGrid'
import { DetailPanel } from './components/DetailPanel'
import type { Attachment, ChatSummary, Filters, IndexingProgress, Stats } from './types'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'sender', label: 'By sender' }
] as const

type SortOrder = typeof SORT_OPTIONS[number]['value']

export default function App(): JSX.Element {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [isIndexing, setIsIndexing] = useState(false)
  const [showIndexing, setShowIndexing] = useState(true)
  const [showChatPriority, setShowChatPriority] = useState(false)
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([])
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({
    total: 0, processed: 0, currentFile: ''
  })
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({ type: 'all' })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null)
  const [stats, setStats] = useState<Stats>({
    total: 0, images: 0, videos: 0, documents: 0, audio: 0, unavailable: 0, chatNames: []
  })
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('stash-view-mode') as 'grid' | 'list') || 'grid'
  )
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()
  const initialIndexDone = useRef(false)
  const searchBarRef = useRef<SearchBarRef>(null)
  const [showSidebar, setShowSidebar] = useState(true)

  // Persist view mode
  useEffect(() => { localStorage.setItem('stash-view-mode', viewMode) }, [viewMode])

  // Menu bar listeners
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

  // Check disk access on mount
  useEffect(() => {
    let interval: NodeJS.Timeout
    const check = async (): Promise<void> => {
      const access = await window.api.checkDiskAccess()
      setHasAccess(access)
      if (access) clearInterval(interval)
    }
    check()
    interval = setInterval(check, 2000)
    return () => clearInterval(interval)
  }, [])

  // Once access is granted, always show priority screen so user chooses what to index
  useEffect(() => {
    if (hasAccess && !initialIndexDone.current) {
      window.api.getChatSummaries().then((summaries) => {
        if (summaries.length > 0) {
          setChatSummaries(summaries)
          setShowChatPriority(true)
        } else {
          initialIndexDone.current = true
          setIsIndexing(true)
          window.api.startIndexing()
        }
      })
    }
  }, [hasAccess])

  const handleStartWithPriority = useCallback((priorityChats: string[]) => {
    setShowChatPriority(false)
    initialIndexDone.current = true
    setIsIndexing(true)
    setShowIndexing(true)
    window.api.startIndexing(priorityChats)
  }, [])

  const handleManageConversations = useCallback(async () => {
    const confirmed = await window.api.confirmReset()
    if (!confirmed) return
    await window.api.resetIndexing()
    const summaries = await window.api.getChatSummaries()
    setChatSummaries(summaries)
    setAttachments([])
    setStats({ total: 0, images: 0, videos: 0, documents: 0, audio: 0, unavailable: 0, chatNames: [] })
    setShowChatPriority(true)
  }, [])

  // Listen for indexing progress
  useEffect(() => {
    const unsub = window.api.onIndexingProgress((data) => {
      setIndexingProgress(data)
      if (data.total > 0 && data.processed >= data.total && data.phase === 'Up to date') {
        setIsIndexing(false)
      }
      if (data.processed > 0 && data.processed % 20 === 0) {
        loadAttachments()
        loadStats()
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.api.onNewAttachment(() => { loadAttachments(); loadStats() })
    return unsub
  }, [])

  const loadStats = useCallback(async () => {
    const s = await window.api.getStats()
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

  useEffect(() => { if (hasAccess) loadStats() }, [hasAccess, loadStats])
  useEffect(() => { if (!isIndexing && hasAccess) { loadStats(); loadAttachments() } }, [isIndexing])

  // Close sort menu on click outside
  useEffect(() => {
    if (!showSortMenu) return
    const handler = (): void => setShowSortMenu(false)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [showSortMenu])

  const selectedIndex = selectedAttachment ? attachments.findIndex((a) => a.id === selectedAttachment.id) : -1

  if (hasAccess === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
        <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasAccess) return <PermissionScreen />
  if (showChatPriority) return <ChatPriorityScreen chats={chatSummaries} onStart={handleStartWithPriority} />

  const isImageView = viewMode === 'grid' && (!filters.type || filters.type === 'all' || filters.type === 'images')

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a]">
      {isIndexing && showIndexing && indexingProgress.total > 0 && (
        <IndexingOverlay progress={indexingProgress} onBrowse={() => setShowIndexing(false)} />
      )}

      {isIndexing && !showIndexing && indexingProgress.total > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-[#1c1c1c]">
          <div
            className="h-full bg-teal-500 transition-all duration-300"
            style={{ width: `${Math.round((indexingProgress.processed / indexingProgress.total) * 100)}%` }}
          />
        </div>
      )}

      {/* Drag region for title bar */}
      <div className="h-12 flex-shrink-0 flex items-center px-20" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span className="text-xs font-medium text-[#636363] tracking-wide uppercase">Stash</span>
      </div>

      {/* Search bar */}
      <div className="px-4 pb-3 flex-shrink-0">
        <SearchBar ref={searchBarRef} value={query} onChange={setQuery} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <Sidebar
            stats={stats}
            filters={filters}
            onFilterChange={setFilters}
            onManageConversations={!isIndexing ? handleManageConversations : undefined}
          />
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Toolbar: view toggle + sort */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#1c1c1c] flex-shrink-0">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-[#1c1c1c] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-[#1c1c1c] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowSortMenu(!showSortMenu) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-white transition-colors"
              >
                {SORT_OPTIONS.find((o) => o.value === sortOrder)?.label}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showSortMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-[#1c1c1c] border border-[#262626] rounded-lg shadow-lg z-20 overflow-hidden">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setSortOrder(opt.value); setShowSortMenu(false) }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                        sortOrder === opt.value ? 'text-white bg-[#262626]' : 'text-[#a3a3a3] hover:bg-[#222] hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <AttachmentGrid
              attachments={attachments}
              selectedId={selectedAttachment?.id ?? null}
              onSelect={setSelectedAttachment}
              onLoadMore={loadMore}
              hasMore={hasMore}
              isImageView={isImageView}
            />
          </div>
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
