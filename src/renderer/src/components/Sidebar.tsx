import { useState, useRef, useMemo } from 'react'
import { Search, Sparkles, Loader2, Settings } from 'lucide-react'
import type { Stats, Filters, IndexingProgress, ChatNameEntry } from '../types'
import { ProLock } from './ProLock'

interface Props {
  stats: Stats
  filters: Filters
  onFilterChange: (filters: Filters) => void
  onManageConversations?: () => void
  onHideChat?: (rawName: string) => void
  isIndexing?: boolean
  indexingProgress?: IndexingProgress
  onGoHome?: () => void
  selectedRange?: string
  onDateRangeChange?: (range: string) => void
  scopedPerson?: string | null
  onScopePerson?: (rawName: string | null) => void
  onNavigate?: (view: { kind: string; person?: string }) => void
  availableYears?: number[]
  onOpenSettings?: () => void
}

function getVibeTag(c: ChatNameEntry): { label: string; color: string }[] {
  const tags: { label: string; color: string; cat: string }[] = []
  const total = c.messageCount
  if (total < 10) return []
  const sentPct = total > 0 ? c.sentCount / total : 0.5
  const recvPct = 1 - sentPct
  const daysSince = c.lastMessageDate ? Math.floor((Date.now() - new Date(c.lastMessageDate).getTime()) / 86400000) : 999

  const add = (label: string, color: string, cat: string) => {
    if (tags.length >= 2) return
    if (tags.some(t => t.cat === cat)) return // no two from same category
    tags.push({ label, color, cat })
  }

  // Priority 1: Gone cold
  if (daysSince > 60 && total > 100) add('Gone cold', '#9a948f', 'health')
  // Priority 2: One-sided / They carry it
  if (sentPct > 0.70 && total > 30) add('One-sided', '#9a948f', 'health')
  else if (recvPct > 0.70 && total > 30) add('They carry it', '#9a948f', 'health')
  // Priority 3: New connection
  if (total < 50 && daysSince < 90) add('New connection', '#2EC4A0', 'health')
  // Priority 4: Always on
  if (c.avgReplyMinutes > 0 && c.avgReplyMinutes < 5 && total > 100) add('Always on', '#2EC4A0', 'behavior')
  // Priority 5: Late night
  if (c.lateNightRatio > 35) add('Late night', '#7F77DD', 'temporal')
  // Priority 6: Comedy
  if (c.laughsReceived > 20 && c.laughsReceived / Math.max(total * 0.01, 1) > 2) add('Comedy', '#E8604A', 'behavior')
  // Priority 7: Balanced
  if (sentPct >= 0.42 && sentPct <= 0.58 && total > 200) add('Balanced', '#2EC4A0', 'health')
  // Priority 8: Chatterbox
  if (total > 5000) add('Chatterbox', '#E8604A', 'behavior')
  // Priority 9: Photo heavy
  if (c.attachmentCount > total * 0.3 && c.attachmentCount > 50) add('Photo heavy', '#7F77DD', 'behavior')
  // Priority 10: Slow burn
  if (c.avgReplyMinutes > 120 && total > 20) add('Slow burn', '#9a948f', 'behavior')

  return tags.map(({ label, color }) => ({ label, color }))
}

function resolveName(raw: string, map: Record<string, string>): string {
  const n = map[raw] || raw
  return n.startsWith('#') ? 'Group chat' : n
}

function compactNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getRangeLabel(range: string): string {
  if (!range || range === 'all') return 'All time'
  if (range === '7days') return 'Last 7 days'
  if (range === '30days') return 'Last 30 days'
  if (range === 'month') return MONTH_SHORT[new Date().getMonth()] + ' ' + new Date().getFullYear()
  if (range === 'year') return String(new Date().getFullYear())
  if (/^\d{4}$/.test(range)) return range
  if (/^\d{4}-\d{2}$/.test(range)) {
    const [y, m] = range.split('-').map(Number)
    return MONTH_SHORT[m - 1] + ' ' + y
  }
  return 'All time'
}

export function Sidebar({ stats, filters, onFilterChange, onManageConversations, onHideChat, isIndexing, indexingProgress, onGoHome, selectedRange, onDateRangeChange, scopedPerson, onScopePerson, onNavigate, availableYears, onOpenSettings }: Props): JSX.Element {
  const [chatFilter, setChatFilter] = useState('')
  const [aiMode, setAiMode] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiResults, setAiResults] = useState<string[] | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [chatSort, setChatSort] = useState<string>('most-messages')
  const [showAllChats, setShowAllChats] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rawName: string } | null>(null)
  const [expandedYear, setExpandedYear] = useState<number | null>(() => {
    const r = selectedRange || 'all'
    if (/^\d{4}$/.test(r)) return parseInt(r)
    if (/^\d{4}-\d{2}$/.test(r)) return parseInt(r.split('-')[0])
    return null
  })
  const handleAiSearch = async (): Promise<void> => {
    if (!aiQuery.trim() || aiLoading) return
    setAiLoading(true); setAiError(null)
    const conversations = (stats.chatNames as ChatNameEntry[]).map(c => ({ display: resolveName(c.rawName, stats.chatNameMap), identifier: c.rawName }))
    try {
      const res = await window.api.searchConversationsAi(aiQuery.trim(), conversations)
      if (res.error) setAiError(res.error); else setAiResults(res.results || [])
    } catch { setAiError('ERROR') }
    finally { setAiLoading(false) }
  }
  const exitAiMode = (): void => { setAiMode(false); setAiQuery(''); setAiResults(null); setAiError(null) }

  const sidebarCurrentYear = new Date().getFullYear()
  const sidebarCurrentMonth = new Date().getMonth()

  const sortedChats = useMemo(() => {
    let list = stats.chatNames as ChatNameEntry[]
    if (chatFilter) {
      const q = chatFilter.toLowerCase()
      list = list.filter((c) => {
        const dn = stats.chatNameMap?.[c.rawName] || c.rawName
        return dn.toLowerCase().includes(q) || c.rawName.toLowerCase().includes(q)
      })
    }
    return [...list].sort((a, b) => {
      switch (chatSort) {
        case 'most-messages': return b.messageCount - a.messageCount
        case 'most-attachments': return b.attachmentCount - a.attachmentCount
        case 'most-recent': return (b.lastMessageDate || '').localeCompare(a.lastMessageDate || '')
        case 'most-laughs': return b.laughsGenerated - a.laughsGenerated
        default: return b.messageCount - a.messageCount
      }
    })
  }, [stats.chatNames, stats.chatNameMap, chatFilter, chatSort])

  const displayChats = aiResults !== null
    ? aiResults.map(id => sortedChats.find(c => c.rawName === id)).filter(Boolean) as ChatNameEntry[]
    : (showAllChats || chatFilter ? sortedChats : sortedChats.slice(0, 5))

  const sortLabels: Record<string, string> = { 'most-messages': 'Most messages', 'most-attachments': 'Most attachments', 'most-recent': 'Most recent', 'most-laughs': 'Most laughs' }
  const sortKeys = Object.keys(sortLabels)

  const cycleSort = (): void => {
    const idx = sortKeys.indexOf(chatSort)
    setChatSort(sortKeys[(idx + 1) % sortKeys.length])
  }

  // Insight rows — individuals only
  const individuals = (stats.chatNames as ChatNameEntry[]).filter((c) => !c.isGroup)
  const byLaughs = [...individuals].sort((a, b) => b.laughsGenerated - a.laughsGenerated)
  const byMessages = [...individuals].sort((a, b) => b.messageCount - a.messageCount)
  const funniestName = byLaughs[0] ? resolveName(byLaughs[0].rawName, stats.chatNameMap) : '—'
  const mostActiveName = byMessages[0] ? resolveName(byMessages[0].rawName, stats.chatNameMap) : '—'

  // Status
  const statusDot = isIndexing ? '#2EC4A0' : stats.total > 0 ? '#2EC4A0' : '#333'
  const statusText = isIndexing && indexingProgress && indexingProgress.total > 0
    ? `Indexing — ${indexingProgress.processed.toLocaleString()} of ${indexingProgress.total.toLocaleString()}`
    : stats.total > 0 ? `${stats.total.toLocaleString()} indexed` : 'Not indexed'
  const statusPct = isIndexing && indexingProgress && indexingProgress.total > 0
    ? Math.round((indexingProgress.processed / indexingProgress.total) * 100) : stats.total > 0 ? 100 : 0

  // Relationship mode sidebar
  if (scopedPerson) {
    const personName = resolveName(scopedPerson, stats.chatNameMap)
    const personData = (stats.chatNames as ChatNameEntry[]).find((c) => c.rawName === scopedPerson)
    const initials = personName.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'

    return (
      <div style={{ width: 240, minWidth: 240, flexShrink: 0, height: '100%', background: '#0F0F0F', borderRight: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ height: 44, display: 'flex', alignItems: 'center', paddingLeft: 36, flexShrink: 0, borderBottom: '1px solid #1A1A1A', cursor: 'pointer', WebkitAppRegion: 'drag' } as React.CSSProperties} onClick={() => onScopePerson?.(null)}>
          <span style={{ color: '#2EC4A0', fontSize: 13, marginRight: 8, fontFamily: "'DM Sans'", WebkitAppRegion: 'no-drag' } as React.CSSProperties}>←</span>
          <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 18, letterSpacing: '0.22em', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <span style={{ fontWeight: 200, color: '#FFFFFF' }}>ST</span>
            <span style={{ fontWeight: 400, color: '#E8604A' }}>ASH</span>
          </span>
        </div>
        <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid #1A1A1A' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#2EC4A0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600, color: '#0A0A0A', marginBottom: 10 }}>{initials}</div>
          <div style={{ fontSize: 15, color: '#fff', fontWeight: 500, marginBottom: 3 }}>{personName}</div>
          {(() => { if (!personData) return null; const tags = getVibeTag(personData); return tags.length > 0 ? <div style={{ display: 'flex', gap: 6, marginTop: 2, marginBottom: 4, flexWrap: 'wrap' }}>{tags.map((t, i) => <span key={i} style={{ fontSize: 9, color: t.color, letterSpacing: '0.06em', fontFamily: "'DM Sans'" }}>{t.label}</span>)}</div> : null })()}
          <div style={{ fontSize: 11, color: '#7c7c7c' }}>
            {personData ? `${compactNum(personData.messageCount)} messages` : ''} <span style={{ color: '#2EC4A0' }}>·</span> {personData ? `${compactNum(personData.attachmentCount)} attachments` : ''}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '12px 14px', borderBottom: '1px solid #1A1A1A' }}>
          {[
            { val: personData ? `${Math.min(99, Math.round((personData.initiationCount / Math.max(personData.messageCount * 0.1, 1)) * 100))}%` : '—', label: 'You initiate' },
            { val: personData?.laughsReceived ? `${personData.laughsReceived}` : '—', label: 'Made you laugh' },
            { val: personData?.laughsGenerated ? `${personData.laughsGenerated}` : '—', label: 'You made laugh' },
            { val: personData ? compactNum(personData.attachmentCount) : '—', label: 'Attachments' }
          ].map(({ val, label }) => (
            <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#2EC4A0', marginBottom: 2 }}>{val}</div>
              <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 14px', flex: 1 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 10 }}>Jump to</div>
          {[
            { label: 'Relationship insights', count: `${personData?.isGroup ? 4 : 5} cards`, onClick: () => onNavigate?.({ kind: 'person-insights', person: scopedPerson! }) },
            { label: 'Shared attachments', count: `${compactNum(personData?.attachmentCount || 0)} items`, onClick: () => onNavigate?.({ kind: 'person-attachments', person: scopedPerson! }) },
          ].map(({ label, count, onClick }) => (
            <button key={label} onClick={onClick}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              <span style={{ fontSize: 12, color: '#d0ccc8', fontFamily: "'DM Sans'" }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#5a5550', fontFamily: "'DM Sans'" }}>{count}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#5a5550" strokeWidth="1.5" strokeLinecap="round"><path d="M4 2l4 4-4 4"/></svg>
              </div>
            </button>
          ))}
        </div>
        <div style={{ borderTop: '1px solid #1A1A1A', padding: '8px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#2EC4A0' }} />
            <span style={{ fontSize: 10, color: '#7c7c7c' }}>{stats.total.toLocaleString()} indexed</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: 240, minWidth: 240, flexShrink: 0, height: '100%', background: '#0F0F0F', borderRight: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }} onClick={() => setContextMenu(null)}>
      {/* Wordmark — padded to clear traffic lights */}
      <div style={{ height: 44, display: 'flex', alignItems: 'center', paddingLeft: 36, flexShrink: 0, borderBottom: '1px solid #1A1A1A', cursor: 'pointer', WebkitAppRegion: 'drag' } as React.CSSProperties} onClick={onGoHome}>
        <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 18, letterSpacing: '0.22em' }}>
          <span style={{ fontWeight: 200, color: '#FFFFFF' }}>ST</span>
          <span style={{ fontWeight: 400, color: '#E8604A' }}>ASH</span>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px' }}>
        {/* Search — normal + AI mode */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.4 }}>
            {aiMode ? <Sparkles style={{ width: 13, height: 13, color: '#2EC4A0' }} /> : <Search style={{ width: 13, height: 13, color: '#fff' }} />}
          </div>
          <input type="text" value={aiMode ? aiQuery : chatFilter}
            onChange={(e) => aiMode ? setAiQuery(e.target.value) : setChatFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && aiMode && aiQuery.trim()) handleAiSearch(); if (e.key === 'Escape') { if (aiMode) exitAiMode(); else setChatFilter('') } }}
            placeholder={aiMode ? 'describe a conversation...' : 'find a conversation'}
            style={{ width: '100%', border: aiMode ? '1px solid rgba(46,196,160,0.4)' : '1px solid rgba(255,255,255,0.12)', background: aiMode ? 'rgba(46,196,160,0.06)' : 'rgba(255,255,255,0.03)', borderRadius: 14, padding: '12px 36px 12px 32px', fontSize: 13, color: 'white', outline: 'none', fontFamily: "'DM Sans'", transition: 'border-color 0.2s, background 0.2s' }} />
          <button onClick={() => { if (aiMode) { if (aiLoading) return; exitAiMode() } else { setAiMode(true); setChatFilter('') } }}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: aiLoading ? 'default' : 'pointer', padding: 2 }}>
            {aiLoading ? <Loader2 style={{ width: 13, height: 13, color: '#2EC4A0', animation: 'spin 0.7s linear infinite' }} /> : <Sparkles style={{ width: 13, height: 13, color: aiMode ? '#2EC4A0' : 'rgba(255,255,255,0.25)' }} />}
          </button>
        </div>
        {aiMode && (
          <ProLock feature="ai_search" onOpenSettings={onOpenSettings}>
            {aiError === 'NO_KEY' && <div style={{ fontSize: 10, color: '#E8604A', marginBottom: 10, fontFamily: "'DM Sans'", lineHeight: 1.4 }}>No API key — add anthropic-key.txt to app data folder</div>}
            {aiError === 'AI_DISABLED' && <div style={{ fontSize: 10, color: '#E8604A', marginBottom: 10, fontFamily: "'DM Sans'", lineHeight: 1.4 }}>AI features are disabled. Enable them in Settings.</div>}
          </ProLock>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

        {/* Sort pill */}
        <button onClick={cycleSort} style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', color: '#b9b9b9', padding: '8px 16px', fontSize: 12, background: 'transparent', cursor: 'pointer', marginBottom: 20, fontFamily: "'DM Sans'" }}>
          {sortLabels[chatSort]}
        </button>

        {/* Date range */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 10, fontFamily: "'DM Sans'" }}>
            {getRangeLabel(selectedRange || 'all')}
          </div>

          {/* Quick presets */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
            {([
              { val: 'all', label: 'All time' },
              { val: '7days', label: '7 days' },
              { val: '30days', label: '30 days' },
              { val: 'month', label: 'This month' },
            ] as const).map(({ val, label }) => {
              const isActive = (selectedRange || 'all') === val
              return (
                <button key={val} onClick={() => { onDateRangeChange?.(val); setExpandedYear(null) }}
                  style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                    fontFamily: "'DM Sans'", border: '1px solid',
                    borderColor: isActive ? '#E8604A' : 'rgba(255,255,255,0.1)',
                    background: isActive ? 'rgba(232,96,74,0.1)' : 'transparent',
                    color: isActive ? '#E8604A' : '#8a8480'
                  }}>
                  {label}
                </button>
              )
            })}
          </div>

          {/* Year chips — compact horizontal wrap */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(availableYears || []).map(year => {
              const isYearActive = (selectedRange || 'all') === String(year)
              const isMonthInYear = (selectedRange || '').startsWith(String(year) + '-')
              const isActive = isYearActive || isMonthInYear
              return (
                <button key={year}
                  onClick={() => {
                    if (expandedYear === year) {
                      setExpandedYear(null)
                    } else {
                      setExpandedYear(year)
                      onDateRangeChange?.(String(year))
                    }
                  }}
                  style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                    fontFamily: "'DM Sans'", border: '1px solid',
                    borderColor: isActive ? '#E8604A' : 'rgba(255,255,255,0.1)',
                    background: isActive ? 'rgba(232,96,74,0.1)' : 'transparent',
                    color: isActive ? '#E8604A' : '#8a8480',
                    transition: 'all 0.1s'
                  }}>
                  {year}
                </button>
              )
            })}
          </div>

          {/* Month chips — shared row below year chips */}
          {expandedYear !== null && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingTop: 6 }}>
              {MONTH_SHORT.map((mo, idx) => {
                if (expandedYear === sidebarCurrentYear && idx > sidebarCurrentMonth) return null
                const val = `${expandedYear}-${String(idx + 1).padStart(2, '0')}`
                const isMonthActive = (selectedRange || 'all') === val
                return (
                  <button key={val} onClick={() => onDateRangeChange?.(val)}
                    style={{
                      padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                      fontFamily: "'DM Sans'", border: '1px solid',
                      borderColor: isMonthActive ? '#E8604A' : 'rgba(255,255,255,0.08)',
                      background: isMonthActive ? 'rgba(232,96,74,0.15)' : 'rgba(255,255,255,0.02)',
                      color: isMonthActive ? '#E8604A' : '#6a6460',
                      transition: 'all 0.1s'
                    }}>
                    {mo}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Top chats */}
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#E8604A', margin: '18px 0 12px' }}>
          Top chats
        </div>

        {aiResults !== null && (
          <ProLock feature="ai_search" onOpenSettings={onOpenSettings}>
            <button onClick={exitAiMode} style={{ fontSize: 10, color: '#2EC4A0', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 8px', display: 'block', fontFamily: "'DM Sans'" }}>
              ✕ Clear AI results ({aiResults.length} found)
            </button>
          </ProLock>
        )}
        {displayChats.map((chat) => {
          const dn = resolveName(chat.rawName, stats.chatNameMap)
          const active = filters.chatName === chat.rawName
          return (
            <button key={chat.rawName}
              onClick={() => onScopePerson ? onScopePerson(chat.rawName) : onFilterChange({ ...filters, chatName: chat.rawName })}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, rawName: chat.rawName }) }}
              style={{
                width: '100%', textAlign: 'left', padding: 12, borderRadius: 14, marginBottom: 8, cursor: 'pointer',
                border: active ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                borderLeft: aiResults?.includes(chat.rawName) ? '2px solid #2EC4A0' : undefined,
                background: active ? 'rgba(255,255,255,0.04)' : 'transparent', display: 'block'
              }}>
              <div style={{ fontSize: 14, color: '#d8d8d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dn}</div>
              <div style={{ fontSize: 11, color: '#5a5550', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {compactNum(chat.messageCount)} msgs <span style={{ color: '#E8604A' }}>·</span> {compactNum(chat.attachmentCount)} files
              </div>
              {(() => { const tags = getVibeTag(chat); return tags.length > 0 ? <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>{tags.map((t, i) => <span key={i} style={{ fontSize: 9, color: t.color, letterSpacing: '0.06em', fontFamily: "'DM Sans'" }}>{t.label}</span>)}</div> : null })()}
            </button>
          )
        })}

        {!showAllChats && !chatFilter && sortedChats.length > 5 && (
          <button onClick={() => setShowAllChats(true)} style={{ fontSize: 12, color: '#E8604A', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 16 }}>
            Show all ({sortedChats.length})
          </button>
        )}

        {/* Insights section */}
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#E8604A', margin: '18px 0 12px' }}>
          Insights
        </div>

        {[
          { label: 'Funniest person', value: funniestName },
          { label: 'Most active', value: mostActiveName },
          { label: 'Most late-night', value: '—' }
        ].map((row) => (
          <button key={row.label} onClick={onGoHome} style={{ width: '100%', textAlign: 'left', padding: 12, borderRadius: 14, marginBottom: 8, cursor: 'pointer', border: '1px solid transparent', background: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#7c7c7c' }}>{row.label}</span>
            <span style={{ fontSize: 13, color: '#d8d8d8' }}>{row.value}</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #1A1A1A', padding: '8px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot }} />
          <span style={{ fontSize: 10, color: '#7c7c7c', flex: 1 }}>{statusText}</span>
          {isIndexing && <span style={{ fontSize: 10, color: '#555' }}>{statusPct}%</span>}
        </div>
        <div style={{ height: 2, background: '#1A1A1A', borderRadius: 1, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', background: '#2EC4A0', borderRadius: 1, width: `${statusPct}%`, transition: 'width 0.3s' }} />
        </div>
        {onManageConversations && (
          <button onClick={onManageConversations} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px', fontSize: 11, color: '#555', background: 'none', border: 'none', cursor: 'pointer' }}>
            <Settings style={{ width: 12, height: 12 }} /> Manage conversations
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-[300]" style={{ left: contextMenu.x, top: contextMenu.y, background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, padding: 4, minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { if (onHideChat) onHideChat(contextMenu.rawName); if (filters.chatName === contextMenu.rawName) onFilterChange({ ...filters, chatName: undefined }); setContextMenu(null) }}
            style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#888', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6 }}>
            Hide conversation
          </button>
        </div>
      )}
    </div>
  )
}
