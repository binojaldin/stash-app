import { useState, useRef, useMemo } from 'react'
import {
  Image, Video, FileText, Music, Layers, Calendar, MessageSquare, Settings, X, Sparkles, Loader2
} from 'lucide-react'
import type { Stats, Filters } from '../types'

interface Props {
  stats: Stats
  filters: Filters
  onFilterChange: (filters: Filters) => void
  onManageConversations?: () => void
  onHideChat?: (rawName: string) => void
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

export function Sidebar({ stats, filters, onFilterChange, onManageConversations, onHideChat }: Props): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rawName: string } | null>(null)
  const [chatFilter, setChatFilter] = useState('')
  const [showFinder, setShowFinder] = useState(false)
  const [finderQuery, setFinderQuery] = useState('')
  const [finderLoading, setFinderLoading] = useState(false)
  const [finderResults, setFinderResults] = useState<string[] | null>(null)
  const [finderError, setFinderError] = useState<string | null>(null)
  const finderRef = useRef<HTMLTextAreaElement>(null)

  const filteredChats = useMemo(() => {
    if (!chatFilter) return stats.chatNames
    const q = chatFilter.toLowerCase()
    return stats.chatNames.filter((rawName) => {
      const displayName = stats.chatNameMap?.[rawName] || rawName
      return displayName.toLowerCase().includes(q) || rawName.toLowerCase().includes(q)
    })
  }, [stats.chatNames, stats.chatNameMap, chatFilter])

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
      const chatList = stats.chatNames.map((raw) => {
        const display = stats.chatNameMap?.[raw] || raw
        return `- "${display}" (identifier: ${raw})`
      }).join('\n')

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': localStorage.getItem('stash-anthropic-key') || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          system: 'You are helping a user find a specific iMessage conversation. You will be given a list of conversations with metadata and the user\'s description. Return ONLY a JSON array of chat_identifier strings for the conversations that best match the description, ranked by confidence, max 5 results. No explanation, just the JSON array.',
          messages: [{ role: 'user', content: `Conversations:\n${chatList}\n\nFind: ${finderQuery}` }]
        })
      })

      if (!response.ok) {
        const err = await response.text()
        if (response.status === 401) {
          const key = prompt('Enter your Anthropic API key to use conversation finder:')
          if (key) { localStorage.setItem('stash-anthropic-key', key); handleFinderSubmit(); return }
          setFinderError('API key required')
        } else {
          setFinderError(`API error: ${response.status}`)
        }
        setFinderLoading(false)
        return
      }

      const data = await response.json()
      const text = data.content?.[0]?.text || '[]'
      const matches = JSON.parse(text) as string[]
      setFinderResults(matches.length > 0 ? matches : null)
      if (matches.length === 0) setFinderError('No matches found')
    } catch (err) {
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
              placeholder="Filter conversations..."
              className="w-full h-7 px-2 text-xs bg-[#141414] border border-[#262626] rounded-md text-white placeholder-[#4a4a4a] outline-none focus:border-[#444]"
            />
            {chatFilter && (
              <button onClick={() => setChatFilter('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#636363] hover:text-white text-xs">&times;</button>
            )}
          </div>

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
                placeholder="Describe what you remember... e.g. 'the friend I texted about moving to NYC'"
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
            </div>
          )}

          <button onClick={() => onFilterChange({ ...filters, chatName: undefined })}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${!filters.chatName ? 'bg-[#1c1c1c] text-white' : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'}`}
          >All conversations</button>

          <div className="max-h-60 overflow-y-auto">
            {filteredChats.map((rawName) => {
              const displayName = stats.chatNameMap?.[rawName] || rawName
              const active = filters.chatName === rawName
              const highlighted = finderSet.has(rawName)
              return (
                <button key={rawName}
                  onClick={() => onFilterChange({ ...filters, chatName: rawName })}
                  onContextMenu={(e) => handleContextMenu(e, rawName)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm truncate transition-colors ${
                    active ? 'bg-[#1c1c1c] text-white' : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'
                  } ${highlighted ? 'border-l-2 border-teal-400 pl-1.5' : ''}`}
                  title={displayName}
                >{displayName}</button>
              )
            })}
          </div>
        </div>
      )}

      {/* Manage conversations */}
      {onManageConversations && (
        <div className="mt-auto pt-3 border-t border-[#262626]">
          <button onClick={onManageConversations}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-[#636363] hover:bg-[#141414] hover:text-[#a3a3a3] transition-colors">
            <Settings className="w-3.5 h-3.5" /> Manage conversations
          </button>
        </div>
      )}

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
