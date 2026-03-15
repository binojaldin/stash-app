import { useState, useRef, useMemo } from 'react'
import {
  Image, Video, FileText, Music, Layers, Calendar, MessageSquare, Settings, X, Sparkles, Loader2
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

const dateFilters = [
  { key: undefined, label: 'Any time' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'older', label: 'Older' }
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

export function Sidebar({ stats, filters, onFilterChange, onManageConversations, onHideChat, isIndexing, indexingProgress }: Props): JSX.Element {
  const [indexComplete, setIndexComplete] = useState(false)

  // Show "complete" message briefly
  useState(() => {
    if (!isIndexing && indexingProgress && indexingProgress.phase === 'Up to date' && stats.total > 0) {
      setIndexComplete(true)
      setTimeout(() => setIndexComplete(false), 3000)
    }
  })
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
  const finderRef = useRef<HTMLTextAreaElement>(null)

  const filteredChats = useMemo(() => {
    let list = stats.chatNames as ChatNameEntry[]

    // Filter by search
    if (chatFilter) {
      const q = chatFilter.toLowerCase()
      list = list.filter((c) => {
        const displayName = stats.chatNameMap?.[c.rawName] || c.rawName
        return displayName.toLowerCase().includes(q) || c.rawName.toLowerCase().includes(q)
      })
    }

    // Sort
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
    if (contextMenu && onHideChat) {
      onHideChat(contextMenu.rawName)
      if (filters.chatName === contextMenu.rawName) onFilterChange({ ...filters, chatName: undefined })
    }
    setContextMenu(null)
  }

  const handleFinderSubmit = async (): Promise<void> => {
    if (!finderQuery.trim()) return
    setFinderLoading(true); setFinderError(null); setFinderResults(null)
    try {
      const conversations = stats.chatNames.map((c) => ({
        display: stats.chatNameMap?.[c.rawName] || c.rawName,
        identifier: c.rawName
      }))
      const result = await window.api.searchConversationsAi(finderQuery, conversations)
      if (result.error) {
        if (result.error === 'NO_KEY') {
          setShowKeyInput(true)
          setFinderError(null)
        } else {
          setFinderError(result.error)
        }
      } else if (result.results && result.results.length > 0) {
        setFinderResults(result.results)
      } else {
        setFinderError('No matches found')
      }
    } catch (err) {
      console.error('[AI Finder]', err)
      setFinderError('Failed to search')
    }
    setFinderLoading(false)
  }

  const finderSet = useMemo(() => new Set(finderResults || []), [finderResults])

  return (
    <div className="w-56 flex-shrink-0 border-r border-[#262626] overflow-y-auto p-3 flex flex-col" onClick={() => setContextMenu(null)}>
      {/* Type filters */}
      <div className="mb-6">
        <h3 className="text-[10px] font-semibold text-[#636363] uppercase tracking-wider px-2 mb-2">Type</h3>
        {typeFilters.map(({ key, label, icon: Icon }) => {
          const active = (filters.type || 'all') === key
          return (
            <button key={key} onClick={() => onFilterChange({ ...filters, type: key })}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${active ? 'bg-[#1c1c1c] text-white' : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'}`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              <span className="text-xs text-[#636363]">{getCount(stats, key).toLocaleString()}</span>
            </button>
          )
        })}
      </div>

      {/* Date filters */}
      <div className="mb-6">
        <h3 className="text-[10px] font-semibold text-[#636363] uppercase tracking-wider px-2 mb-2">
          <Calendar className="w-3 h-3 inline mr-1" />Date
        </h3>
        {dateFilters.map(({ key, label }) => {
          const active = filters.dateRange === key
          return (
            <button key={label} onClick={() => onFilterChange({ ...filters, dateRange: key })}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${active ? 'bg-[#1c1c1c] text-white' : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'}`}
            >{label}</button>
          )
        })}
      </div>

      {/* Conversations */}
      {stats.chatNames.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-[#636363] uppercase tracking-wider px-2 mb-2">
            <MessageSquare className="w-3 h-3 inline mr-1" />Conversations
          </h3>

          {/* Conversation filter */}
          <div className="relative mb-1.5">
            <input
              type="text" value={chatFilter} onChange={(e) => setChatFilter(e.target.value)}
              placeholder="Search by name, number, or group..."
              className="w-full h-7 px-2 text-xs bg-[#141414] border border-[#262626] rounded-md text-white placeholder-[#4a4a4a] outline-none focus:border-[#444]"
            />
            {chatFilter && (
              <button onClick={() => setChatFilter('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#636363] hover:text-white text-xs">&times;</button>
            )}
          </div>

          {/* Sort dropdown */}
          <select
            value={chatSort}
            onChange={(e) => setChatSort(e.target.value)}
            className="w-full h-7 px-2 mb-1.5 bg-[#141414] border border-[#262626] rounded-md text-[#a3a3a3] outline-none focus:border-[#444] cursor-pointer"
            style={{ fontSize: '11px' }}
          >
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

          {/* AI finder button */}
          <button
            onClick={() => { setShowFinder(!showFinder); if (!showFinder) setTimeout(() => finderRef.current?.focus(), 100) }}
            className="w-full flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded-md text-[10px] text-teal-400 hover:bg-[#141414] transition-colors"
          >
            <Sparkles className="w-3 h-3" /> Find a conversation
          </button>

          {/* AI finder panel */}
          {showFinder && (
            <div className="mb-2 p-2 rounded-lg bg-[#111] border border-[#262626]">
              <textarea
                ref={finderRef}
                value={finderQuery} onChange={(e) => setFinderQuery(e.target.value)}
                placeholder="e.g. 'the friend I texted about moving to NYC' or 'whoever sent me photos in summer 2022'"
                className="w-full h-16 px-2 py-1.5 text-xs bg-[#141414] border border-[#262626] rounded-md text-white placeholder-[#4a4a4a] outline-none focus:border-[#444] resize-none"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFinderSubmit() } }}
              />
              <div className="flex items-center gap-2 mt-1.5">
                <button onClick={handleFinderSubmit} disabled={finderLoading || !finderQuery.trim()}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-teal-600 text-[10px] text-white hover:bg-teal-500 disabled:opacity-40 transition-colors">
                  {finderLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Searching...</> : 'Search'}
                </button>
                {finderResults && (
                  <button onClick={() => { setFinderResults(null); setFinderError(null) }} className="text-[10px] text-[#636363] hover:text-white">Clear</button>
                )}
              </div>
              {finderError && <p className="text-[10px] text-red-400 mt-1">{finderError}</p>}
              {showKeyInput && (
                <div className="mt-2">
                  <p className="text-[10px] text-[#636363] mb-1">Enter your Anthropic API key:</p>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder="sk-ant-..."
                      className="flex-1 h-6 px-2 text-[10px] bg-[#141414] border border-[#262626] rounded text-white placeholder-[#4a4a4a] outline-none"
                    />
                    <button
                      onClick={async () => {
                        if (!keyInput.trim()) return
                        await window.api.setAnthropicKey(keyInput.trim())
                        setShowKeyInput(false)
                        setKeyInput('')
                        setKeySaved(true)
                        setTimeout(() => setKeySaved(false), 3000)
                      }}
                      className="px-2 h-6 rounded bg-teal-600 text-[10px] text-white hover:bg-teal-500"
                    >Save</button>
                  </div>
                </div>
              )}
              {keySaved && <p className="text-[10px] text-teal-400 mt-1">Key saved — try again</p>}
            </div>
          )}

          <button onClick={() => onFilterChange({ ...filters, chatName: undefined })}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${!filters.chatName ? 'bg-[#1c1c1c] text-white' : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'}`}
          >All conversations</button>

          <div className="max-h-60 overflow-y-auto">
            {filteredChats.map((chat) => {
              const displayName = stats.chatNameMap?.[chat.rawName] || chat.rawName
              const active = filters.chatName === chat.rawName
              const highlighted = finderSet.has(chat.rawName)
              return (
                <button key={chat.rawName}
                  onClick={() => onFilterChange({ ...filters, chatName: chat.rawName })}
                  onContextMenu={(e) => handleContextMenu(e, chat.rawName)}
                  className={`w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-sm transition-colors ${
                    active ? 'bg-[#1c1c1c] text-white' : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'
                  } ${highlighted ? 'border-l-2 border-teal-400 pl-1.5' : ''}`}
                  title={displayName}
                >
                  <span className="flex-1 truncate text-left">{displayName}</span>
                  <span className="text-[10px] text-[#4a4a4a] flex-shrink-0 tabular-nums">{chat.attachmentCount}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Sidebar footer */}
      <div className="mt-auto pt-3 border-t border-[#262626]">
        {/* Indexing progress */}
        {isIndexing && indexingProgress && indexingProgress.total > 0 && (
          <div className="px-2 pb-2">
            <div className="flex items-center gap-2 mb-1.5">
              <Loader2 className="w-3 h-3 text-teal-400 animate-spin flex-shrink-0" />
              <span className="text-[10px] text-[#a3a3a3] truncate">
                {indexingProgress.phase ? `${indexingProgress.phase}` : 'Indexing'} — {indexingProgress.processed.toLocaleString()} of {indexingProgress.total.toLocaleString()}
              </span>
            </div>
            <div className="h-1 bg-[#1c1c1c] rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width: `${Math.round((indexingProgress.processed / indexingProgress.total) * 100)}%` }} />
            </div>
          </div>
        )}
        {indexComplete && !isIndexing && (
          <div className="px-2 pb-2">
            <span className="text-[10px] text-teal-400">Index complete — {stats.total.toLocaleString()} attachments</span>
          </div>
        )}

        {/* Manage conversations */}
        {onManageConversations && (
          <button onClick={onManageConversations}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-[#636363] hover:bg-[#141414] hover:text-[#a3a3a3] transition-colors">
            <Settings className="w-3.5 h-3.5" /> Manage conversations
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed z-[300] bg-[#1c1c1c] border border-[#333] rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={handleHide}
            className="w-full text-left px-3 py-1.5 text-sm text-[#a3a3a3] hover:bg-[#262626] hover:text-white transition-colors">
            Hide conversation
          </button>
        </div>
      )}
    </div>
  )
}
