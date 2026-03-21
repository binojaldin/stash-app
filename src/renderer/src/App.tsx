import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { PermissionScreen } from './components/PermissionScreen'
import { ChatPriorityScreen } from './components/ChatPriorityScreen'
import { IndexingOverlay } from './components/IndexingOverlay'
import { IconRail } from './components/IconRail'
import { Sidebar } from './components/Sidebar'
import { Dashboard, DrillThroughPanel } from './components/Dashboard'
import { AttachmentsView } from './components/AttachmentsView'
import { WrappedView } from './components/WrappedView'
import { SettingsPanel } from './components/SettingsPanel'
import { LockScreen } from './components/LockScreen'
import type { ChatSummary, Filters, IndexingProgress, Stats } from './types'

type AppState = 'checking' | 'loading' | 'no-access' | 'priority' | 'main'

type MainView =
  | { kind: 'global-insights' }
  | { kind: 'global-attachments' }
  | { kind: 'person-insights'; person: string }
  | { kind: 'person-attachments'; person: string }

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

export default function App(): JSX.Element {
  // ── Lock screen state (checked before anything else) ──
  const [isLocked, setIsLocked] = useState<boolean | null>(null) // null = loading
  const [authTouchIdAvailable, setAuthTouchIdAvailable] = useState(false)
  const [authTouchIdEnabled, setAuthTouchIdEnabled] = useState(true)

  useEffect(() => {
    window.api.authGetConfig().then(config => {
      if (config.enabled && config.hasPassword) {
        setIsLocked(true)
        setAuthTouchIdAvailable(config.touchIdAvailable)
        setAuthTouchIdEnabled(config.touchIdEnabled)
      } else {
        setIsLocked(false)
      }
    }).catch(() => setIsLocked(false))
  }, [])

  // Idle check — every 30s, check if we should re-lock
  useEffect(() => {
    if (isLocked) return
    const interval = setInterval(async () => {
      try {
        const should = await window.api.authShouldLock()
        if (should) {
          const config = await window.api.authGetConfig()
          setAuthTouchIdAvailable(config.touchIdAvailable)
          setAuthTouchIdEnabled(config.touchIdEnabled)
          setIsLocked(true)
        }
      } catch { /* ignore */ }
    }, 30000)
    return () => clearInterval(interval)
  }, [isLocked])

  // Activity tracking — throttled to once per 30s
  useEffect(() => {
    if (isLocked) return
    let lastReport = 0
    const handler = (): void => {
      const now = Date.now()
      if (now - lastReport > 30000) {
        lastReport = now
        window.api.authUpdateActivity().catch(() => {})
      }
    }
    window.addEventListener('mousemove', handler)
    window.addEventListener('keydown', handler)
    window.addEventListener('mousedown', handler)
    return () => {
      window.removeEventListener('mousemove', handler)
      window.removeEventListener('keydown', handler)
      window.removeEventListener('mousedown', handler)
    }
  }, [isLocked])

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
  const [showSettings, setShowSettings] = useState(false)
  const [wordmarkReady, setWordmarkReady] = useState(false)
  const [dateRange, setDateRange] = useState<string>('all')
  const [filters, setFilters] = useState<Filters>({ type: 'all' })
  const [insightSurface, setInsightSurface] = useState<'relationship' | 'personal' | 'usage' | 'conversational'>('relationship')
  const [isStatsLoading, setIsStatsLoading] = useState(false)
  const [drillThrough, setDrillThrough] = useState<{ title: string; subtitle: string; freeStats: { label: string; value: string }[] } | null>(null)
  // Contact photos removed — will be re-added with proper architecture

  const availableYears = useMemo(() => {
    const chats = stats.chatNames as { lastMessageDate: string }[]
    if (!chats.length) return []
    const years = new Set(chats.filter(c => c.lastMessageDate).map(c => new Date(c.lastMessageDate).getFullYear()))
    return Array.from(years).sort((a, b) => b - a)
  }, [stats.chatNames])

  // ── Derived ──
  const scopedPerson = (mainView.kind === 'person-insights' || mainView.kind === 'person-attachments') ? mainView.person : null
  const showInsights = mainView.kind === 'global-insights' || mainView.kind === 'person-insights'
  const showAttachments = mainView.kind === 'global-attachments' || mainView.kind === 'person-attachments'
  const isPersonScope = scopedPerson !== null

  const startupComplete = useRef(false)

  // ── Effects ──
  useEffect(() => { const t = setTimeout(() => setWordmarkReady(true), 300); return () => clearTimeout(t) }, [])

  // Startup — two-phase: fast stats (stash.db only, ~100ms) then full enrichment (chat.db, ~2min cold)
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
      setAppState('loading')
      try {
        // Phase 1: Fast stats — stash.db only
        const fast = await window.api.getFastStats()
        if (cancelled) return

        if (fast.total > 0) {
          setStats(fast)
          setAppState('main')
          startupComplete.current = true
          // Phase 2: Full enrichment in background
          setIsStatsLoading(true)
          window.api.getStats().then(full => {
            if (!cancelled) { setStats(full); setIsStatsLoading(false) }
          }).catch(() => { if (!cancelled) setIsStatsLoading(false) })
        } else {
          const summaries = await window.api.getChatSummaries()
          if (cancelled) return
          if (summaries.length > 0) { setChatSummaries(summaries); setAppState('priority'); window.api.resolveChatNames() }
          else { setAppState('main'); startupComplete.current = true }
        }
      } catch { setAppState('main'); startupComplete.current = true }
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
    setIsStatsLoading(true)
    try {
      const bounds = dateRangeToBounds(dateRange)
      const s = await window.api.getStats(chatFilter, bounds.from || undefined, bounds.to || undefined)
      setStats(s)
    } finally { setIsStatsLoading(false) }
  }, [dateRange])

  // Only refetch stats when dateRange changes AFTER initial startup (Phase 2 handles the first call)
  const dateRangeInitial = useRef(true)
  useEffect(() => {
    if (dateRangeInitial.current) { dateRangeInitial.current = false; return }
    if (appState === 'main' && startupComplete.current) loadStats()
  }, [dateRange])
  // Do NOT re-call loadStats on appState change — Phase 2 (line 103) handles it
  // Only refetch after indexing completes
  useEffect(() => {
    if (!isIndexing && appState === 'main' && startupComplete.current) loadStats()
  }, [isIndexing])

  useEffect(() => { setInsightSurface('relationship') }, [scopedPerson])

  // ── Navigation helpers ──
  const goHome = (): void => { setMainView({ kind: 'global-insights' }); setFilters({ type: 'all' }) }
  const scopePerson = (rawName: string): void => { setMainView({ kind: 'person-insights', person: rawName }) }

  // ── Early returns ──
  // Lock screen — renders before anything else, no flash of content
  if (isLocked === null) {
    return <div style={{ background: '#0A0A0A', height: '100vh', width: '100vw' }} />
  }
  if (isLocked) {
    return <LockScreen onUnlock={() => { setIsLocked(false); window.api.authUpdateActivity() }} touchIdAvailable={authTouchIdAvailable} touchIdEnabled={authTouchIdEnabled} />
  }

  if (appState === 'checking' || appState === 'loading') {
    return (<div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] gap-3"><div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" /><p className="text-xs text-[#636363]">Loading your library...</p></div>)
  }
  if (appState === 'no-access') return <PermissionScreen />
  if (appState === 'priority') return (
    <ChatPriorityScreen chats={chatSummaries} indexedChats={stats.chatNames} onStart={handleStartWithPriority} onReset={handleResetEverything} onBack={stats.total > 0 ? () => setAppState('main') : undefined} />
  )

  return (
    <div className="flex" style={{ background: '#0A0A0A', height: '100vh', width: '100vw' }}>
      {showWrapped && <WrappedView onClose={() => setShowWrapped(false)} onOpenSettings={() => setShowSettings(true)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {isIndexing && showIndexing && indexingProgress.total > 0 && <IndexingOverlay progress={indexingProgress} onBrowse={() => setShowIndexing(false)} />}

      <IconRail mainView={mainView} onNavigate={(kind) => setMainView({ kind })}
        indexProgress={isIndexing ? Math.round((indexingProgress.processed / Math.max(indexingProgress.total, 1)) * 100) : stats.total > 0 ? 100 : 0}
        attachmentCount={stats.total} hasNewInsights={stats.total > 0}
        onOpenSettings={() => setShowSettings(true)} />

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
            availableYears={availableYears}
            onNavigate={(view) => setMainView(view as MainView)}
            onOpenSettings={() => setShowSettings(true)}
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


        {/* Main surface */}
        {showInsights ? (
          <Dashboard stats={stats} chatNameMap={stats.chatNameMap}
            onSelectConversation={(rawName) => setMainView({ kind: 'person-insights', person: rawName })}
            dateRange={dateRange} scopedPerson={scopedPerson} onClearScope={goHome}
            insightSurface={insightSurface} onSurfaceChange={setInsightSurface}
            isStatsLoading={isStatsLoading}
            onDrillThrough={(title, subtitle, freeStats) => setDrillThrough({ title, subtitle, freeStats })}
            onOpenSettings={() => setShowSettings(true)} />
        ) : (
          <AttachmentsView mainView={mainView} dateRange={dateRange} stats={stats} chatNameMap={stats.chatNameMap} onNavigate={setMainView} />
        )}
      </div>

      {drillThrough && (
        <DrillThroughPanel title={drillThrough.title} subtitle={drillThrough.subtitle} freeStats={drillThrough.freeStats} onClose={() => setDrillThrough(null)} />
      )}
    </div>
  )
}
