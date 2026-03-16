import { useState, useEffect, useCallback, useRef } from 'react'
import { Sparkles, Image, Video, FileText, Music } from 'lucide-react'
import { PermissionScreen } from './components/PermissionScreen'
import { ChatPriorityScreen } from './components/ChatPriorityScreen'
import { IndexingOverlay } from './components/IndexingOverlay'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './components/Dashboard'
import { AttachmentsView } from './components/AttachmentsView'
import { WrappedView } from './components/WrappedView'
import type { ChatSummary, Filters, IndexingProgress, Stats } from './types'

type AppState = 'checking' | 'loading' | 'no-access' | 'priority' | 'main'

type MainView =
  | { kind: 'global-insights' }
  | { kind: 'global-attachments' }
  | { kind: 'person-insights'; person: string }
  | { kind: 'person-attachments'; person: string }

function dateRangeToBounds(range: string): { from: string | null; to: string | null } {
  const now = new Date()
  switch (range) {
    case '7days': { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: d.toISOString(), to: null } }
    case '30days': { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: d.toISOString(), to: null } }
    case 'month': { return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: null } }
    case 'year': { return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: null } }
    default: return { from: null, to: null }
  }
}

export default function App(): JSX.Element {
  // ── Navigation + global state ──
  const [appState, setAppState] = useState<AppState>('checking')
  const [isIndexing, setIsIndexing] = useState(false)
  const [showIndexing, setShowIndexing] = useState(true)
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([])
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>({ total: 0, processed: 0, currentFile: '' })
  const [mainView, setMainView] = useState<MainView>({ kind: 'global-insights' })
  const [stats, setStats] = useState<Stats>({ total: 0, images: 0, videos: 0, documents: 0, audio: 0, unavailable: 0, chatNames: [], chatNameMap: {} })
  const [showSidebar, setShowSidebar] = useState(true)
  const [showWrapped, setShowWrapped] = useState(false)
  const [wordmarkReady, setWordmarkReady] = useState(false)
  const [dateRange, setDateRange] = useState<string>('all')
  const [filters, setFilters] = useState<Filters>({ type: 'all' })
  // Contact photos removed — will be re-added with proper architecture

  // ── Derived ──
  const scopedPerson = (mainView.kind === 'person-insights' || mainView.kind === 'person-attachments') ? mainView.person : null
  const showInsights = mainView.kind === 'global-insights' || mainView.kind === 'person-insights'
  const showAttachments = mainView.kind === 'global-attachments' || mainView.kind === 'person-attachments'
  const isPersonScope = scopedPerson !== null

  // ── Effects ──
  useEffect(() => { const t = setTimeout(() => setWordmarkReady(true), 300); return () => clearTimeout(t) }, [])

  // Startup
  useEffect(() => {
    let cancelled = false
    const startup = async (): Promise<void> => {
      const access = await window.api.checkDiskAccess()
      if (cancelled) return
      if (!access) {
        setAppState('no-access')
        const interval = setInterval(async () => { const ok = await window.api.checkDiskAccess(); if (ok) { clearInterval(interval); if (!cancelled) startup() } }, 2000)
        return
      }
      setAppState('loading')
      try {
        const s = await window.api.getStats()
        if (cancelled) return
        if (s.total > 0) { setStats(s); setAppState('main') }
        else {
          const summaries = await window.api.getChatSummaries()
          if (cancelled) return
          if (summaries.length > 0) { setChatSummaries(summaries); setAppState('priority'); window.api.resolveChatNames() }
          else setAppState('main')
        }
      } catch { setAppState('main') }
    }
    startup()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const unsub = window.api.onChatNamesResolved((data) => {
      setChatSummaries(data as ChatSummary[])
    })
    return unsub
  }, [])

  const handleManageConversations = useCallback(async () => {
    setAppState('loading')
    const summaries = await window.api.getChatSummaries()
    setChatSummaries(summaries); setAppState('priority'); window.api.resolveChatNames()
  }, [])

  const handleResetEverything = useCallback(async () => {
    const confirmed = await window.api.confirmReset()
    if (!confirmed) return
    await window.api.resetIndexing()
    setStats({ total: 0, images: 0, videos: 0, documents: 0, audio: 0, unavailable: 0, chatNames: [], chatNameMap: {} })
    const summaries = await window.api.getChatSummaries()
    setChatSummaries(summaries); setAppState('priority'); window.api.resolveChatNames()
  }, [])

  useEffect(() => {
    const unsubs = [
      window.api.onToggleSidebar(() => setShowSidebar((p) => !p)),
      window.api.onSetViewGrid(() => {}),
      window.api.onSetViewList(() => {}),
      window.api.onFocusSearch(() => {}),
      window.api.onManageConversations(() => handleManageConversations())
    ]
    return () => unsubs.forEach((u) => u())
  }, [handleManageConversations])

  const handleStartWithPriority = useCallback((priorityChats: string[]) => {
    setAppState('main'); setIsIndexing(true); setShowIndexing(true); window.api.startIndexing(priorityChats)
  }, [])

  useEffect(() => {
    const unsub = window.api.onIndexingProgress((data) => {
      setIndexingProgress(data)
      if (data.total > 0 && data.processed >= data.total && data.phase === 'Up to date') setIsIndexing(false)
    })
    return unsub
  }, [])

  useEffect(() => { const unsub = window.api.onNewAttachment(() => loadStats()); return unsub }, [])

  // ── Stats loading ──
  const loadStats = useCallback(async (chatFilter?: string) => {
    const bounds = dateRangeToBounds(dateRange)
    const s = await window.api.getStats(chatFilter, bounds.from || undefined, bounds.to || undefined)
    setStats(s)
  }, [dateRange])

  useEffect(() => { if (appState === 'main') loadStats(scopedPerson ?? undefined) }, [dateRange, scopedPerson, appState])
  useEffect(() => { if (!isIndexing && appState === 'main') loadStats(scopedPerson || undefined) }, [isIndexing])
  useEffect(() => { if (appState === 'main') loadStats() }, [appState])

  // ── Navigation helpers ──
  const goHome = (): void => { setMainView({ kind: 'global-insights' }); setFilters({ type: 'all' }) }
  const scopePerson = (rawName: string): void => { setMainView({ kind: 'person-insights', person: rawName }) }

  // ── Early returns ──
  if (appState === 'checking' || appState === 'loading') {
    return (<div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] gap-3"><div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /><p className="text-xs text-[#636363]">Loading your library...</p></div>)
  }
  if (appState === 'no-access') return <PermissionScreen />
  if (appState === 'priority') return (
    <ChatPriorityScreen chats={chatSummaries} indexedChats={stats.chatNames} onStart={handleStartWithPriority} onReset={handleResetEverything} onBack={stats.total > 0 ? () => setAppState('main') : undefined} />
  )

  const mediaCards = [
    { icon: Image, label: 'Images', count: stats.images, bg: '#FFF0ED', color: '#E8604A', type: 'images' },
    { icon: Video, label: 'Videos', count: stats.videos, bg: '#EAF8F4', color: '#2EC4A0', type: 'videos' },
    { icon: FileText, label: 'Documents', count: stats.documents, bg: '#F5F0FF', color: '#8B7FD4', type: 'documents' },
    { icon: Music, label: 'Audio', count: stats.audio, bg: '#FFF8ED', color: '#E8A04A', type: 'audio' }
  ]

  return (
    <div className="flex" style={{ background: '#0A0A0A', height: '100vh', width: '100vw' }}>
      {showWrapped && <WrappedView onClose={() => setShowWrapped(false)} />}
      {isIndexing && showIndexing && indexingProgress.total > 0 && <IndexingOverlay progress={indexingProgress} onBrowse={() => setShowIndexing(false)} />}

      <IconRail mainView={mainView} onNavigate={(kind) => setMainView({ kind })}
        indexProgress={isIndexing ? Math.round((indexingProgress.processed / Math.max(indexingProgress.total, 1)) * 100) : stats.total > 0 ? 100 : 0}
        attachmentCount={stats.total} hasNewInsights={stats.total > 0} />

      <div className="flex flex-col" style={{ background: '#0F0F0F' }}>
        {showSidebar && (
          <Sidebar stats={stats} filters={filters}
            onFilterChange={(f) => { setFilters(f); if (!showAttachments) setMainView(isPersonScope ? { kind: 'person-attachments', person: scopedPerson! } : { kind: 'global-attachments' }) }}
            onManageConversations={!isIndexing ? handleManageConversations : undefined}
            onHideChat={async (rawName) => { await window.api.hideChat(rawName); loadStats() }}
            isIndexing={isIndexing} indexingProgress={indexingProgress}
            onGoHome={goHome}
            scopedPerson={scopedPerson}
            onScopePerson={(rawName) => rawName ? scopePerson(rawName) : goHome()}
            selectedRange={dateRange} onDateRangeChange={setDateRange}
          />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col" style={{ background: '#F2EDE8' }}>
        {/* Topbar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4" style={{ height: 44, borderBottom: '1px solid #EAE5DF', background: '#F6F3EF', WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {isPersonScope && (
              <div style={{ display: 'flex', background: '#EAE5DF', borderRadius: 8, padding: 2, gap: 2 }}>
                <button onClick={() => setMainView({ kind: 'person-insights', person: scopedPerson! })}
                  style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, background: showInsights ? '#fff' : 'transparent', color: showInsights ? '#1A1A1A' : '#9a948f', fontWeight: showInsights ? 500 : 400, border: 'none', cursor: 'pointer' }}>Insights</button>
                <button onClick={() => setMainView({ kind: 'person-attachments', person: scopedPerson! })}
                  style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, background: showAttachments ? '#fff' : 'transparent', color: showAttachments ? '#1A1A1A' : '#9a948f', fontWeight: showAttachments ? 500 : 400, border: 'none', cursor: 'pointer' }}>Attachments</button>
              </div>
            )}
          </div>
          {!isPersonScope && (
            <button onClick={() => setShowWrapped(true)}
              style={{ background: '#E8604A', color: '#FFFFFF', borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#C44A36' }} onMouseLeave={(e) => { e.currentTarget.style.background = '#E8604A' }}>
              <Sparkles style={{ width: 12, height: 12, display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> Wrapped
            </button>
          )}
        </div>

        {/* Media summary cards — global views only */}
        {!isPersonScope && stats.total > 0 && showInsights && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 14px', background: '#F6F3EF', flexShrink: 0 }}>
            {mediaCards.map(({ icon: Icon, label, count, bg, color, type }) => (
              <button key={type} onClick={() => { setFilters({ ...filters, type }); setMainView({ kind: 'global-attachments' }) }}
                style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 14, padding: '16px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon style={{ width: 22, height: 22, stroke: color }} /></div>
                <div><div style={{ fontSize: 13, color: '#9a948f', marginBottom: 4, fontFamily: "'DM Sans'" }}>{label}</div><div style={{ fontSize: 32, fontWeight: 500, color, lineHeight: 1, fontFamily: "'DM Sans'" }}>{count.toLocaleString()}</div></div>
              </button>
            ))}
          </div>
        )}

        {/* Insights label */}
        {showInsights && !isPersonScope && stats.total > 0 && (
          <div style={{ padding: '12px 28px 6px', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#b8b2ad' }}>Insights · surfaced automatically</div>
        )}

        {/* Main surface */}
        {showInsights ? (
          <Dashboard stats={stats} chatNameMap={stats.chatNameMap}
            onSelectConversation={(rawName) => setMainView({ kind: 'person-attachments', person: rawName })}
            dateRange={dateRange} scopedPerson={scopedPerson} onClearScope={goHome} />
        ) : (
          <AttachmentsView mainView={mainView} dateRange={dateRange} stats={stats} chatNameMap={stats.chatNameMap} onNavigate={setMainView} />
        )}
      </div>
    </div>
  )
}
