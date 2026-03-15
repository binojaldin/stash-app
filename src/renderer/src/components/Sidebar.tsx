import { useState, useRef, useMemo } from 'react'
import {
  Image, Video, FileText, Music, Layers, MessageSquare, Settings, Sparkles, Loader2
} from 'lucide-react'
import type { Stats, Filters, IndexingProgress, ChatNameEntry } from '../types'

interface Props {
  stats: Stats
  filters: Filters
  onFilterChange: (filters: Filters) => void
  onManageConversations?: () => void
  onHideChat?: (rawName: string) => void
  isIndexing?: boolean
  indexingProgress?: IndexingProgress
}

const typeFilters = [
  { key: 'all', label: 'All', icon: Layers },
  { key: 'images', label: 'Images', icon: Image },
  { key: 'videos', label: 'Videos', icon: Video },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'audio', label: 'Audio', icon: Music }
]

function getCount(stats: Stats, key: string): number {
  switch (key) {
    case 'all': return stats.total
    case 'images': return stats.images
    case 'videos': return stats.videos
    case 'documents': return stats.documents
    case 'audio': return stats.audio
    default: return 0
  }
}

const sectionLabel = (text: string, color: string): JSX.Element => (
  <h3 style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color, padding: '0 8px', marginBottom: 6 }}>{text}</h3>
)

export function Sidebar({ stats, filters, onFilterChange, onManageConversations, onHideChat, isIndexing, indexingProgress }: Props): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rawName: string } | null>(null)
  const [chatFilter, setChatFilter] = useState('')
  const [chatSort, setChatSort] = useState<string>('most-attachments')
  const [showFinder, setShowFinder] = useState(false)
  const [finderQuery, setFinderQuery] = useState('')
  const [finderLoading, setFinderLoading] = useState(false)
  const [finderResults, setFinderResults] = useState<string[] | null>(null)
  const [finderError, setFinderError] = useState<string | null>(null)
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const finderRef = useRef<HTMLTextAreaElement>(null)

  const filteredChats = useMemo(() => {
    let list = stats.chatNames as ChatNameEntry[]
    if (chatFilter) {
      const q = chatFilter.toLowerCase()
      list = list.filter((c) => {
        const displayName = stats.chatNameMap?.[c.rawName] || c.rawName
        return displayName.toLowerCase().includes(q) || c.rawName.toLowerCase().includes(q)
      })
    }
    return [...list].sort((a, b) => {
      switch (chatSort) {
        case 'most-attachments': return b.attachmentCount - a.attachmentCount
        case 'least-attachments': return a.attachmentCount - b.attachmentCount
        case 'most-recent': return (b.lastMessageDate || '').localeCompare(a.lastMessageDate || '')
        case 'oldest': return (a.lastMessageDate || '').localeCompare(b.lastMessageDate || '')
        case 'most-messages': return b.messageCount - a.messageCount
        case 'least-messages': return a.messageCount - b.messageCount
        case 'most-sent': return b.sentCount - a.sentCount
        case 'most-received': return b.receivedCount - a.receivedCount
        case 'most-initiations': return b.initiationCount - a.initiationCount
        case 'most-laughs-generated': return b.laughsGenerated - a.laughsGenerated
        case 'most-laughs-received': return b.laughsReceived - a.laughsReceived
        default: return b.attachmentCount - a.attachmentCount
      }
    })
  }, [stats.chatNames, stats.chatNameMap, chatFilter, chatSort])

  const handleContextMenu = (e: React.MouseEvent, rawName: string): void => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, rawName })
  }
  const handleHide = (): void => {
    if (contextMenu && onHideChat) { onHideChat(contextMenu.rawName); if (filters.chatName === contextMenu.rawName) onFilterChange({ ...filters, chatName: undefined }) }
    setContextMenu(null)
  }

  const handleFinderSubmit = async (): Promise<void> => {
    if (!finderQuery.trim()) return
    setFinderLoading(true); setFinderError(null); setFinderResults(null)
    try {
      const conversations = stats.chatNames.map((c) => ({ display: stats.chatNameMap?.[c.rawName] || c.rawName, identifier: c.rawName }))
      const result = await window.api.searchConversationsAi(finderQuery, conversations)
      if (result.error) { if (result.error === 'NO_KEY') { setShowKeyInput(true); setFinderError(null) } else setFinderError(result.error) }
      else if (result.results && result.results.length > 0) setFinderResults(result.results)
      else setFinderError('No matches found')
    } catch { setFinderError('Failed to search') }
    setFinderLoading(false)
  }

  const finderSet = useMemo(() => new Set(finderResults || []), [finderResults])

  // Status bar state
  const statusDot = isIndexing ? '#2EC4A0' : stats.total > 0 ? '#2EC4A0' : '#333333'
  const statusText = isIndexing && indexingProgress && indexingProgress.total > 0
    ? `Indexing — ${indexingProgress.processed.toLocaleString()} of ${indexingProgress.total.toLocaleString()}`
    : stats.total > 0 ? `${stats.total.toLocaleString()} attachments indexed` : 'Not indexed yet'
  const statusPct = isIndexing && indexingProgress && indexingProgress.total > 0
    ? Math.round((indexingProgress.processed / indexingProgress.total) * 100)
    : stats.total > 0 ? 100 : 0

  return (
    <div className="flex flex-col flex-shrink-0 overflow-y-auto" style={{ width: 220, background: '#0F0F0F', borderRight: '1px solid #1A1A1A' }} onClick={() => setContextMenu(null)}>
      <div className="flex-1 p-3">
        {/* TYPE */}
        <div className="mb-5">
          {sectionLabel('Type', '#E8604A')}
          {typeFilters.map(({ key, label, icon: Icon }) => {
            const active = (filters.type || 'all') === key
            return (
              <button key={key} onClick={() => onFilterChange({ ...filters, type: key })}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors"
                style={{ borderLeft: active ? '2px solid #E8604A' : '2px solid transparent', color: active ? '#FFFFFF' : '#888888', background: active ? '#1E1E1E' : 'transparent' }}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                <span style={{ fontSize: 11, color: '#555555' }}>{getCount(stats, key).toLocaleString()}</span>
              </button>
            )
          })}
        </div>

        {/* DATE RANGE */}
        <div className="mb-5">
          {sectionLabel('Date Range', '#2EC4A0')}
          <div className="flex items-center gap-1.5 px-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              style={{ flex: 1, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 5, padding: '4px 6px', fontSize: 10, color: '#555555', fontFamily: 'DM Sans', outline: 'none' }}
              placeholder="From" />
            <span style={{ color: '#333', fontSize: 10 }}>→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              style={{ flex: 1, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 5, padding: '4px 6px', fontSize: 10, color: '#555555', fontFamily: 'DM Sans', outline: 'none' }}
              placeholder="To" />
          </div>
          {/* TODO: Wire date inputs to IPC filter with { from, to } */}
        </div>

        {/* CONVERSATIONS */}
        {stats.chatNames.length > 0 && (
          <div>
            {sectionLabel('Conversations', '#E8604A')}

            <div className="relative mb-1.5 px-1">
              <input type="text" value={chatFilter} onChange={(e) => setChatFilter(e.target.value)}
                placeholder="Search by name, number, or group..."
                style={{ width: '100%', height: 28, padding: '0 8px', fontSize: 11, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 5, color: '#FFFFFF', outline: 'none', fontFamily: 'DM Sans' }} />
              {chatFilter && <button onClick={() => setChatFilter('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#636363', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>}
            </div>

            <div className="px-1 mb-1.5">
              <select value={chatSort} onChange={(e) => setChatSort(e.target.value)}
                style={{ width: '100%', height: 28, padding: '0 8px', fontSize: 11, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 5, color: '#888888', outline: 'none', fontFamily: 'DM Sans', cursor: 'pointer' }}>
                <option value="most-attachments">Most attachments</option>
                <option value="least-attachments">Fewest attachments</option>
                <option value="most-recent">Most recent message</option>
                <option value="oldest">Oldest message</option>
                <option value="most-messages">Most messages</option>
                <option value="least-messages">Fewest messages</option>
                <option value="most-sent">Most sent by you</option>
                <option value="most-received">Most received</option>
                <option value="most-initiations">You initiate most</option>
                <option value="most-laughs-generated">Made them laugh most</option>
                <option value="most-laughs-received">They make you laugh most</option>
              </select>
            </div>

            <button onClick={() => { setShowFinder(!showFinder); if (!showFinder) setTimeout(() => finderRef.current?.focus(), 100) }}
              className="w-full flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded-md transition-colors"
              style={{ fontSize: 10, color: '#2EC4A0' }}>
              <Sparkles className="w-3 h-3" /> Find a conversation
            </button>

            {showFinder && (
              <div className="mb-2 p-2 rounded-lg" style={{ background: '#111', border: '1px solid #2A2A2A' }}>
                <textarea ref={finderRef} value={finderQuery} onChange={(e) => setFinderQuery(e.target.value)}
                  placeholder="e.g. 'the friend I texted about moving to NYC'"
                  style={{ width: '100%', height: 64, padding: '6px 8px', fontSize: 11, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 5, color: '#FFFFFF', outline: 'none', resize: 'none', fontFamily: 'DM Sans' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFinderSubmit() } }} />
                <div className="flex items-center gap-2 mt-1.5">
                  <button onClick={handleFinderSubmit} disabled={finderLoading || !finderQuery.trim()}
                    className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md transition-colors"
                    style={{ background: '#2EC4A0', fontSize: 10, color: '#FFFFFF', opacity: finderLoading || !finderQuery.trim() ? 0.4 : 1 }}>
                    {finderLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Searching...</> : 'Search'}
                  </button>
                  {finderResults && <button onClick={() => { setFinderResults(null); setFinderError(null) }} style={{ fontSize: 10, color: '#636363' }}>Clear</button>}
                </div>
                {finderError && <p style={{ fontSize: 10, color: '#E8604A', marginTop: 4 }}>{finderError}</p>}
                {showKeyInput && (
                  <div style={{ marginTop: 8 }}>
                    <p style={{ fontSize: 10, color: '#636363', marginBottom: 4 }}>Enter your Anthropic API key:</p>
                    <div className="flex gap-1">
                      <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="sk-ant-..."
                        style={{ flex: 1, height: 24, padding: '0 8px', fontSize: 10, background: '#141414', border: '1px solid #2A2A2A', borderRadius: 4, color: '#FFFFFF', outline: 'none' }} />
                      <button onClick={async () => { if (!keyInput.trim()) return; await window.api.setAnthropicKey(keyInput.trim()); setShowKeyInput(false); setKeyInput(''); setKeySaved(true); setTimeout(() => setKeySaved(false), 3000) }}
                        style={{ padding: '0 8px', height: 24, borderRadius: 4, background: '#2EC4A0', fontSize: 10, color: '#FFFFFF', border: 'none', cursor: 'pointer' }}>Save</button>
                    </div>
                  </div>
                )}
                {keySaved && <p style={{ fontSize: 10, color: '#2EC4A0', marginTop: 4 }}>Key saved — try again</p>}
              </div>
            )}

            <button onClick={() => onFilterChange({ ...filters, chatName: undefined })}
              className="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors"
              style={{ color: !filters.chatName ? '#FFFFFF' : '#888888', background: !filters.chatName ? '#1E1E1E' : 'transparent', borderLeft: !filters.chatName ? '2px solid #E8604A' : '2px solid transparent' }}>
              All conversations
            </button>

            <div className="max-h-60 overflow-y-auto">
              {filteredChats.map((chat) => {
                let displayName = stats.chatNameMap?.[chat.rawName] || chat.rawName
                if (displayName.startsWith('#')) displayName = 'Group chat'
                const active = filters.chatName === chat.rawName
                const highlighted = finderSet.has(chat.rawName)
                return (
                  <button key={chat.rawName}
                    onClick={() => onFilterChange({ ...filters, chatName: chat.rawName })}
                    onContextMenu={(e) => handleContextMenu(e, chat.rawName)}
                    className="w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-sm transition-colors"
                    style={{
                      color: active ? '#FFFFFF' : '#888888', background: active ? '#1E1E1E' : 'transparent',
                      borderLeft: highlighted ? '2px solid #2EC4A0' : active ? '2px solid #E8604A' : '2px solid transparent'
                    }} title={displayName}>
                    <span className="flex-1 truncate text-left">{displayName}</span>
                    <span style={{ fontSize: 10, color: '#4a4a4a', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{chat.attachmentCount}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #1A1A1A', padding: '8px 12px' }}>
        {/* Status bar — always visible */}
        <div className="mb-2">
          <div className="flex items-center gap-2 mb-1">
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#888888', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusText}</span>
            {isIndexing && indexingProgress && indexingProgress.total > 0 && (
              <span style={{ fontSize: 10, color: '#555555' }}>{statusPct}%</span>
            )}
          </div>
          <div style={{ height: 2, background: '#1A1A1A', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#2EC4A0', borderRadius: 1, width: `${statusPct}%`, transition: 'width 0.3s' }} />
          </div>
        </div>

        {onManageConversations && (
          <button onClick={onManageConversations}
            className="w-full flex items-center gap-2 px-1 py-1 rounded-md transition-colors"
            style={{ fontSize: 11, color: '#555555' }}>
            <Settings style={{ width: 12, height: 12 }} /> Manage conversations
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-[300] rounded-lg shadow-xl py-1 min-w-[160px]" style={{ left: contextMenu.x, top: contextMenu.y, background: '#1A1A1A', border: '1px solid #2A2A2A' }} onClick={(e) => e.stopPropagation()}>
          <button onClick={handleHide} className="w-full text-left px-3 py-1.5 text-sm transition-colors" style={{ color: '#888888' }}>Hide conversation</button>
        </div>
      )}
    </div>
  )
}
