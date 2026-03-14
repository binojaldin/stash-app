import { useState, useEffect, useCallback, useRef } from 'react'
import { PermissionScreen } from './components/PermissionScreen'
import { ChatPriorityScreen } from './components/ChatPriorityScreen'
import { IndexingOverlay } from './components/IndexingOverlay'
import { SearchBar } from './components/SearchBar'
import { Sidebar } from './components/Sidebar'
import { AttachmentGrid } from './components/AttachmentGrid'
import { DetailPanel } from './components/DetailPanel'
import type { Attachment, ChatSummary, Filters, IndexingProgress, Stats } from './types'

export default function App(): JSX.Element {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [isIndexing, setIsIndexing] = useState(false)
  const [showIndexing, setShowIndexing] = useState(true)
  const [showChatPriority, setShowChatPriority] = useState(false)
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([])
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({
    total: 0,
    processed: 0,
    currentFile: ''
  })
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>({ type: 'all' })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null)
  const [stats, setStats] = useState<Stats>({
    total: 0,
    images: 0,
    videos: 0,
    documents: 0,
    audio: 0,
    chatNames: []
  })
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const debounceRef = useRef<NodeJS.Timeout>()
  const initialIndexDone = useRef(false)

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

  // Once access is granted, check if we need to show priority screen
  useEffect(() => {
    if (hasAccess && !initialIndexDone.current) {
      // Check if user already has saved preferences (returning user)
      window.api.getSavedPriorityChats().then((saved) => {
        if (saved !== null) {
          // Returning user — start indexing directly
          initialIndexDone.current = true
          setIsIndexing(true)
          window.api.startIndexing()
        } else {
          // First time — show chat priority screen
          window.api.getChatSummaries().then((summaries) => {
            if (summaries.length > 0) {
              setChatSummaries(summaries)
              setShowChatPriority(true)
            } else {
              // No chats found, just start
              initialIndexDone.current = true
              setIsIndexing(true)
              window.api.startIndexing()
            }
          })
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
    await window.api.resetIndexing()
    const summaries = await window.api.getChatSummaries()
    setChatSummaries(summaries)
    setAttachments([])
    setStats({ total: 0, images: 0, videos: 0, documents: 0, audio: 0, chatNames: [] })
    setShowChatPriority(true)
  }, [])

  // Listen for indexing progress
  useEffect(() => {
    const unsub = window.api.onIndexingProgress((data) => {
      setIndexingProgress(data)
      if (data.total > 0 && data.processed >= data.total && data.phase === 'Complete') {
        setIsIndexing(false)
      }
      // Refresh results periodically during indexing
      if (data.processed > 0 && data.processed % 20 === 0) {
        loadAttachments()
        loadStats()
      }
    })
    return unsub
  }, [])

  // Listen for new attachments from watcher
  useEffect(() => {
    const unsub = window.api.onNewAttachment(() => {
      loadAttachments()
      loadStats()
    })
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
      ? await window.api.searchAttachments(query, filterParams, 0, 50)
      : await window.api.getAttachments(filterParams, 0, 50)
    setAttachments(results as Attachment[])
    setPage(0)
    setHasMore((results as Attachment[]).length === 50)
  }, [query, filters])

  const loadMore = useCallback(async () => {
    const nextPage = page + 1
    const filterParams: Record<string, string> = {}
    if (filters.type && filters.type !== 'all') filterParams.type = filters.type
    if (filters.chatName) filterParams.chatName = filters.chatName
    if (filters.dateRange) filterParams.dateRange = filters.dateRange

    const results = query
      ? await window.api.searchAttachments(query, filterParams, nextPage, 50)
      : await window.api.getAttachments(filterParams, nextPage, 50)
    const newResults = results as Attachment[]
    setAttachments((prev) => [...prev, ...newResults])
    setPage(nextPage)
    setHasMore(newResults.length === 50)
  }, [query, filters, page])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      loadAttachments()
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, filters, loadAttachments])

  // Load stats on access
  useEffect(() => {
    if (hasAccess) loadStats()
  }, [hasAccess, loadStats])

  // Reload stats after indexing
  useEffect(() => {
    if (!isIndexing && hasAccess) {
      loadStats()
      loadAttachments()
    }
  }, [isIndexing])

  if (hasAccess === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
        <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!hasAccess) {
    return <PermissionScreen />
  }

  if (showChatPriority) {
    return <ChatPriorityScreen chats={chatSummaries} onStart={handleStartWithPriority} />
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a]">
      {isIndexing && showIndexing && indexingProgress.total > 0 && (
        <IndexingOverlay progress={indexingProgress} onBrowse={() => setShowIndexing(false)} />
      )}

      {/* Persistent progress bar while indexing in background */}
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
        <SearchBar value={query} onChange={setQuery} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        <Sidebar
          stats={stats}
          filters={filters}
          onFilterChange={setFilters}
          onManageConversations={!isIndexing ? handleManageConversations : undefined}
        />

        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          <AttachmentGrid
            attachments={attachments}
            selectedId={selectedAttachment?.id ?? null}
            onSelect={setSelectedAttachment}
            onLoadMore={loadMore}
            hasMore={hasMore}
            isImageView={!filters.type || filters.type === 'all' || filters.type === 'images'}
          />
        </div>

        {selectedAttachment && (
          <DetailPanel
            attachment={selectedAttachment}
            onClose={() => setSelectedAttachment(null)}
          />
        )}
      </div>
    </div>
  )
}
