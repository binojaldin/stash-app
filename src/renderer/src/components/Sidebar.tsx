import { useState, useRef, useMemo } from 'react'
import { Search, Sparkles, Loader2, Settings } from 'lucide-react'
import type { Stats, Filters, IndexingProgress, ChatNameEntry } from '../types'

interface Props {
  stats: Stats
  filters: Filters
  onFilterChange: (filters: Filters) => void
  onManageConversations?: () => void
  onHideChat?: (rawName: string) => void
  isIndexing?: boolean
  indexingProgress?: IndexingProgress
  onGoHome?: () => void
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

export function Sidebar({ stats, filters, onFilterChange, onManageConversations, onHideChat, isIndexing, indexingProgress, onGoHome }: Props): JSX.Element {
  const [chatFilter, setChatFilter] = useState('')
  const [chatSort, setChatSort] = useState<string>('most-messages')
  const [showAllChats, setShowAllChats] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rawName: string } | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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

  const displayChats = showAllChats || chatFilter ? sortedChats : sortedChats.slice(0, 5)

  const sortLabels: Record<string, string> = { 'most-messages': 'Most messages', 'most-attachments': 'Most attachments', 'most-recent': 'Most recent', 'most-laughs': 'Most laughs' }
  const sortKeys = Object.keys(sortLabels)

  const cycleSort = (): void => {
    const idx = sortKeys.indexOf(chatSort)
    setChatSort(sortKeys[(idx + 1) % sortKeys.length])
  }

  // Insight rows
  const byLaughs = [...(stats.chatNames as ChatNameEntry[])].sort((a, b) => b.laughsGenerated - a.laughsGenerated)
  const byMessages = [...(stats.chatNames as ChatNameEntry[])].sort((a, b) => b.messageCount - a.messageCount)
  const funniestName = byLaughs[0] ? resolveName(byLaughs[0].rawName, stats.chatNameMap) : '—'
  const mostActiveName = byMessages[0] ? resolveName(byMessages[0].rawName, stats.chatNameMap) : '—'

  // Status
  const statusDot = isIndexing ? '#2EC4A0' : stats.total > 0 ? '#2EC4A0' : '#333'
  const statusText = isIndexing && indexingProgress && indexingProgress.total > 0
    ? `Indexing — ${indexingProgress.processed.toLocaleString()} of ${indexingProgress.total.toLocaleString()}`
    : stats.total > 0 ? `${stats.total.toLocaleString()} indexed` : 'Not indexed'
  const statusPct = isIndexing && indexingProgress && indexingProgress.total > 0
    ? Math.round((indexingProgress.processed / indexingProgress.total) * 100) : stats.total > 0 ? 100 : 0

  return (
    <div style={{ width: 240, minWidth: 240, flexShrink: 0, height: '100%', background: '#0F0F0F', borderRight: '1px solid #1A1A1A', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }} onClick={() => setContextMenu(null)}>
      {/* Wordmark */}
      <div style={{ padding: '16px 18px 20px', cursor: 'pointer' }} onClick={onGoHome}>
        <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 18, letterSpacing: '0.22em' }}>
          <span style={{ fontWeight: 200, color: '#FFFFFF' }}>ST</span>
          <span style={{ fontWeight: 400, color: '#E8604A' }}>ASH</span>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px' }}>
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <input type="text" value={chatFilter} onChange={(e) => setChatFilter(e.target.value)}
            placeholder="Find a conversation"
            style={{ width: '100%', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: '12px 14px', fontSize: 14, color: 'white', outline: 'none', fontFamily: "'DM Sans'" }} />
        </div>

        {/* Sort pill */}
        <button onClick={cycleSort} style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', color: '#b9b9b9', padding: '8px 16px', fontSize: 12, background: 'transparent', cursor: 'pointer', marginBottom: 20, fontFamily: "'DM Sans'" }}>
          {sortLabels[chatSort]}
        </button>

        {/* Date range */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#E8604A', margin: '18px 0 10px' }}>Date range</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '8px 10px', fontSize: 12, color: '#888', outline: 'none', fontFamily: "'DM Sans'" }} />
            <span style={{ color: '#555', fontSize: 12 }}>→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '8px 10px', fontSize: 12, color: '#888', outline: 'none', fontFamily: "'DM Sans'" }} />
          </div>
          {/* TODO: Wire date inputs to IPC filter with { from, to } */}
        </div>

        {/* Top chats */}
        <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#E8604A', margin: '18px 0 12px' }}>
          Top chats
        </div>

        {displayChats.map((chat) => {
          const dn = resolveName(chat.rawName, stats.chatNameMap)
          const active = filters.chatName === chat.rawName
          return (
            <button key={chat.rawName}
              onClick={() => onFilterChange({ ...filters, chatName: chat.rawName })}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, rawName: chat.rawName }) }}
              style={{
                width: '100%', textAlign: 'left', padding: 12, borderRadius: 14, marginBottom: 8, cursor: 'pointer', border: active ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                background: active ? 'rgba(255,255,255,0.04)' : 'transparent', display: 'block'
              }}>
              <div style={{ fontSize: 14, color: '#d8d8d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dn}</div>
              <div style={{ fontSize: 12, color: '#7c7c7c', marginTop: 3 }}>
                {compactNum(chat.messageCount)} messages <span style={{ color: '#E8604A' }}>·</span> {compactNum(chat.attachmentCount)} attachments
              </div>
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
