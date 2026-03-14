import {
  Image,
  Video,
  FileText,
  Music,
  Layers,
  Calendar,
  MessageSquare
} from 'lucide-react'
import type { Stats, Filters } from '../types'

interface Props {
  stats: Stats
  filters: Filters
  onFilterChange: (filters: Filters) => void
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

export function Sidebar({ stats, filters, onFilterChange }: Props): JSX.Element {
  return (
    <div className="w-56 flex-shrink-0 border-r border-[#262626] overflow-y-auto p-3">
      {/* Type filters */}
      <div className="mb-6">
        <h3 className="text-[10px] font-semibold text-[#636363] uppercase tracking-wider px-2 mb-2">
          Type
        </h3>
        {typeFilters.map(({ key, label, icon: Icon }) => {
          const active = (filters.type || 'all') === key
          return (
            <button
              key={key}
              onClick={() => onFilterChange({ ...filters, type: key })}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
                active
                  ? 'bg-[#1c1c1c] text-white'
                  : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'
              }`}
            >
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
          <Calendar className="w-3 h-3 inline mr-1" />
          Date
        </h3>
        {dateFilters.map(({ key, label }) => {
          const active = filters.dateRange === key
          return (
            <button
              key={label}
              onClick={() => onFilterChange({ ...filters, dateRange: key })}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                active
                  ? 'bg-[#1c1c1c] text-white'
                  : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Chat names */}
      {stats.chatNames.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-[#636363] uppercase tracking-wider px-2 mb-2">
            <MessageSquare className="w-3 h-3 inline mr-1" />
            Conversations
          </h3>
          <button
            onClick={() => onFilterChange({ ...filters, chatName: undefined })}
            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
              !filters.chatName
                ? 'bg-[#1c1c1c] text-white'
                : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'
            }`}
          >
            All conversations
          </button>
          <div className="max-h-60 overflow-y-auto">
            {stats.chatNames.map((name) => {
              const active = filters.chatName === name
              return (
                <button
                  key={name}
                  onClick={() => onFilterChange({ ...filters, chatName: name })}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-sm truncate transition-colors ${
                    active
                      ? 'bg-[#1c1c1c] text-white'
                      : 'text-[#a3a3a3] hover:bg-[#141414] hover:text-white'
                  }`}
                  title={name}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
