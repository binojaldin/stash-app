import { useState, useMemo, useRef, useEffect } from 'react'
import { Cloud, Check, ChevronLeft } from 'lucide-react'
import type { ChatSummary } from '../types'

interface Props {
  chats: ChatSummary[]
  indexedChatNames: string[]
  onStart: (priorityChats: string[]) => void
  onReset: () => void
  onBack?: () => void
}

type SortMode = 'recent' | 'attachments'
type FilterMode = 'all' | 'new' | 'indexed'

export function ChatPriorityScreen({ chats, indexedChatNames, onStart, onReset, onBack }: Props): JSX.Element {
  const indexedSet = useMemo(() => new Set(indexedChatNames), [indexedChatNames])
  const hasIndexedData = indexedSet.size > 0
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [filterMode, setFilterMode] = useState<FilterMode>(hasIndexedData ? 'new' : 'all')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  const sorted = useMemo(() => {
    let list = chats

    // Search filter
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((c) =>
        c.display_name.toLowerCase().includes(q) ||
        c.chat_name.toLowerCase().includes(q) ||
        c.raw_chat_identifier.toLowerCase().includes(q) ||
        c.participant_handles.some((h) => h.toLowerCase().includes(q))
      )
    }

    // Indexed/new filter
    if (filterMode === 'new') list = list.filter((c) => !indexedSet.has(c.chat_name))
    else if (filterMode === 'indexed') list = list.filter((c) => indexedSet.has(c.chat_name))

    // Sort
    const sortFn = (a: ChatSummary, b: ChatSummary): number => {
      if (sortMode === 'recent') return (b.last_message_date || '').localeCompare(a.last_message_date || '')
      return b.attachment_count - a.attachment_count
    }

    if (filterMode === 'all') {
      // Unindexed first, then indexed
      const unindexed = list.filter((c) => !indexedSet.has(c.chat_name)).sort(sortFn)
      const indexed = list.filter((c) => indexedSet.has(c.chat_name)).sort(sortFn)
      return { unindexed, indexed }
    }

    return { unindexed: list.sort(sortFn), indexed: [] }
  }, [chats, sortMode, search, filterMode, indexedSet])

  const selectAllNew = (): void => {
    const next: Record<string, boolean> = {}
    chats.forEach((c) => { if (!indexedSet.has(c.chat_name)) next[String(c.chat_id)] = true })
    setSelected(next)
  }
  const selectNone = (): void => setSelected({})

  const isRawIdentifier = (s: string): boolean => {
    if (!s) return true
    if (/^[0-9a-f]{20,}$/i.test(s)) return true
    if (/^chat\d+/i.test(s)) return true
    if (/^iMessage;/.test(s)) return true
    return false
  }

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
    return `${Math.floor(diffDays / 365)}y ago`
  }

  const handleStart = (): void => {
    const selectedChatNames = chats.filter((c) => selected[String(c.chat_id)]).map((c) => c.chat_name)
    onStart(selectedChatNames)
  }

  const newSelectedCount = Object.keys(selected).length

  const renderRow = (chat: ChatSummary): JSX.Element => {
    const name = chat.display_name?.trim() || 'Unknown'
    const rawSub = name !== chat.chat_name ? chat.chat_name : null
    const subtitle = rawSub && !isRawIdentifier(rawSub) ? rawSub : null
    const id = String(chat.chat_id)
    const isIndexed = indexedSet.has(chat.chat_name)
    const isChecked = isIndexed || !!selected[id]
    return (
      <div
        key={id}
        onClick={(e) => {
          e.stopPropagation()
          if (isIndexed) return
          setSelected((prev) => { const next = { ...prev }; if (next[id]) delete next[id]; else next[id] = true; return next })
        }}
        className={`flex items-center gap-3 px-4 py-2.5 border-b border-[#1c1c1c] last:border-b-0 select-none ${isIndexed ? 'opacity-50 cursor-default' : 'hover:bg-[#141414] cursor-pointer'}`}
      >
        {isIndexed ? (
          <div className="w-4 h-4 rounded bg-teal-600 flex items-center justify-center flex-shrink-0"><Check className="w-3 h-3 text-white" /></div>
        ) : (
          <input type="checkbox" checked={isChecked} onChange={() => {}} className="w-4 h-4 rounded border-[#333] bg-[#1c1c1c] accent-teal-500 flex-shrink-0 pointer-events-none" />
        )}
        <div className="flex-1 min-w-0">
          <span className={`text-sm block truncate ${isIndexed ? 'text-[#8b8b8b]' : 'text-white'}`}>{name}</span>
          {subtitle && <span className="text-xs text-[#4a4a4a] block truncate">{subtitle}</span>}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); window.api.openImessage(chat.raw_chat_identifier) }}
          className="flex-shrink-0 p-1.5 rounded-md text-[#4a4a4a] hover:text-teal-400 hover:bg-[#1c1c1c] transition-colors"
          title="Open in Messages to sync from iCloud"
        ><Cloud className="w-3.5 h-3.5" /></button>
        <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
          <span className="text-xs text-[#636363] tabular-nums">{chat.attachment_count.toLocaleString()}</span>
          {chat.last_message_date && <span className="text-[10px] text-[#4a4a4a]">{formatDate(chat.last_message_date)}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#0a0a0a]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="absolute left-5 top-4 flex items-center gap-1 h-8 px-3 rounded-lg text-sm text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-white transition-colors z-10"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      )}

      <div className="max-w-lg w-full px-8">
        <div className="text-center mb-5">
          <h2 className="text-xl font-semibold text-white mb-2">
            {hasIndexedData ? 'Add conversations' : 'Choose conversations to index'}
          </h2>
          <p className="text-sm text-[#a3a3a3]">
            {hasIndexedData
              ? 'Select additional conversations to index.'
              : 'Select which conversations to index. You can add more later.'}
          </p>
        </div>

        {/* Filter toggle: All | New | Indexed */}
        {hasIndexedData && (
          <div className="flex gap-1 bg-[#1c1c1c] rounded-lg p-0.5 mb-3">
            {(['all', 'new', 'indexed'] as FilterMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`flex-1 px-3 py-1 text-xs rounded-md transition-colors capitalize ${filterMode === mode ? 'bg-[#2a2a2a] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'}`}
              >{mode}</button>
            ))}
          </div>
        )}

        {/* Sort + select controls */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1 bg-[#1c1c1c] rounded-lg p-0.5">
            <button onClick={() => setSortMode('recent')} className={`px-3 py-1 text-xs rounded-md transition-colors ${sortMode === 'recent' ? 'bg-[#2a2a2a] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'}`}>Recent</button>
            <button onClick={() => setSortMode('attachments')} className={`px-3 py-1 text-xs rounded-md transition-colors ${sortMode === 'attachments' ? 'bg-[#2a2a2a] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'}`}>Most attachments</button>
          </div>
          <div className="flex gap-3">
            <button onClick={selectAllNew} className="text-xs text-teal-400 hover:text-teal-300">Select all new</button>
            <button onClick={selectNone} className="text-xs text-[#636363] hover:text-[#a3a3a3]">Deselect all</button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <input ref={searchRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg text-sm text-white placeholder-[#636363] outline-none focus:border-[#444]" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#636363] hover:text-white text-base leading-none">&times;</button>}
        </div>

        {/* Chat list */}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[#1c1c1c] mb-2">
          {sorted.unindexed.length === 0 && sorted.indexed.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[#636363]">No conversations match your search</div>
          )}

          {sorted.unindexed.map(renderRow)}

          {/* Divider between unindexed and indexed */}
          {filterMode === 'all' && sorted.unindexed.length > 0 && sorted.indexed.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2">
              <div className="flex-1 h-px bg-[#262626]" />
              <span className="text-[10px] text-[#4a4a4a] uppercase tracking-wider">Already indexed</span>
              <div className="flex-1 h-px bg-[#262626]" />
            </div>
          )}

          {sorted.indexed.map(renderRow)}
        </div>

        <p className="text-[10px] text-[#4a4a4a] mb-4 text-center">Contact names are resolved locally and never leave your device.</p>

        <button onClick={handleStart} disabled={newSelectedCount === 0}
          className="w-full py-2.5 rounded-lg bg-teal-600 text-sm font-medium text-white hover:bg-teal-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {newSelectedCount > 0 ? `Index ${newSelectedCount} conversation${newSelectedCount > 1 ? 's' : ''}` : 'Select conversations to index'}
        </button>

        {!hasIndexedData && (
          <button onClick={() => onStart([])} className="mt-2 w-full py-2 rounded-lg bg-[#1c1c1c] text-sm text-[#a3a3a3] hover:bg-[#262626] hover:text-white transition-colors">
            Skip — index everything equally
          </button>
        )}

        <button onClick={onReset} className="mt-6 w-full py-1.5 text-[11px] text-[#4a4a4a] hover:text-red-400 transition-colors">
          Reset everything
        </button>
      </div>
    </div>
  )
}
