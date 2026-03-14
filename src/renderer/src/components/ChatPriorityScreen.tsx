import { useState, useMemo, useRef, useEffect } from 'react'
import type { ChatSummary } from '../types'

interface Props {
  chats: ChatSummary[]
  onStart: (priorityChats: string[]) => void
}

type SortMode = 'recent' | 'attachments'

export function ChatPriorityScreen({ chats, onStart }: Props): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(chats.slice(0, 10).map((c) => c.chat_name)))
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const sorted = useMemo(() => {
    const filtered = search
      ? chats.filter((c) => {
          const q = search.toLowerCase()
          return (
            c.display_name.toLowerCase().includes(q) ||
            c.chat_name.toLowerCase().includes(q) ||
            c.raw_chat_identifier.toLowerCase().includes(q) ||
            c.participant_handles.some((h) => h.toLowerCase().includes(q))
          )
        })
      : chats

    return [...filtered].sort((a, b) => {
      if (sortMode === 'recent') {
        return (b.last_message_date || '').localeCompare(a.last_message_date || '')
      }
      return b.attachment_count - a.attachment_count
    })
  }, [chats, sortMode, search])

  const selectAll = (): void => setSelected(new Set(chats.map((c) => c.chat_name)))
  const selectNone = (): void => setSelected(new Set())

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

  return (
    <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
      <div className="max-w-lg w-full px-8">
        <div className="text-center mb-6">
          <h2 className="text-xl font-semibold text-white mb-2">Prioritize conversations</h2>
          <p className="text-sm text-[#a3a3a3]">
            Choose which conversations to index first. Checked conversations will have their attachments processed with higher priority.
          </p>
        </div>

        {/* Sort toggle */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1 bg-[#1c1c1c] rounded-lg p-0.5">
            <button
              onClick={() => setSortMode('recent')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                sortMode === 'recent' ? 'bg-[#2a2a2a] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'
              }`}
            >
              Recent
            </button>
            <button
              onClick={() => setSortMode('attachments')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                sortMode === 'attachments' ? 'bg-[#2a2a2a] text-white' : 'text-[#636363] hover:text-[#a3a3a3]'
              }`}
            >
              Most attachments
            </button>
          </div>
          <div className="flex gap-3">
            <button onClick={selectAll} className="text-xs text-teal-400 hover:text-teal-300">
              Select all
            </button>
            <button onClick={selectNone} className="text-xs text-[#636363] hover:text-[#a3a3a3]">
              Deselect all
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mb-3">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full px-3 py-2 bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg text-sm text-white placeholder-[#636363] outline-none focus:border-[#444]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#636363] hover:text-white text-base leading-none"
            >
              &times;
            </button>
          )}
        </div>

        {/* Chat list */}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-[#1c1c1c] mb-2">
          {sorted.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[#636363]">No conversations match your search</div>
          )}
          {sorted.map((chat) => {
            const name = chat.display_name?.trim() || 'Unknown'
            const rawSub = name !== chat.chat_name ? chat.chat_name : null
            const subtitle = rawSub && !isRawIdentifier(rawSub) ? rawSub : null
            const chatName = chat.chat_name
            return (
              <div
                key={chatName}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(chatName)) {
                      next.delete(chatName)
                    } else {
                      next.add(chatName)
                    }
                    return next
                  })
                }}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#141414] cursor-pointer border-b border-[#1c1c1c] last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={selected.has(chatName)}
                  onChange={() => {}}
                  className="w-4 h-4 rounded border-[#333] bg-[#1c1c1c] accent-teal-500 flex-shrink-0 pointer-events-none"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-white block truncate">{name}</span>
                  {subtitle && (
                    <span className="text-xs text-[#4a4a4a] block truncate">{subtitle}</span>
                  )}
                </div>
                <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                  <span className="text-xs text-[#636363] tabular-nums">{chat.attachment_count.toLocaleString()}</span>
                  {chat.last_message_date && (
                    <span className="text-[10px] text-[#4a4a4a]">{formatDate(chat.last_message_date)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-[10px] text-[#4a4a4a] mb-4 text-center">Contact names are resolved locally and never leave your device.</p>

        <button
          onClick={() => onStart(Array.from(selected))}
          className="w-full py-2.5 rounded-lg bg-teal-600 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
        >
          Start indexing
        </button>

        <button
          onClick={() => onStart([])}
          className="mt-2 w-full py-2 rounded-lg bg-[#1c1c1c] text-sm text-[#a3a3a3] hover:bg-[#262626] hover:text-white transition-colors"
        >
          Skip — index everything equally
        </button>
      </div>
    </div>
  )
}
