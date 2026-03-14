import { Search, X } from 'lucide-react'
import { useRef, useEffect } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
}

export function SearchBar({ value, onChange }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#636363]" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search attachments, conversations, text in images..."
        className="w-full h-10 pl-11 pr-10 rounded-lg bg-[#141414] border border-[#262626] text-sm text-white placeholder-[#636363] outline-none focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]/50 transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#262626] flex items-center justify-center hover:bg-[#333] transition-colors"
        >
          <X className="w-3 h-3 text-[#a3a3a3]" />
        </button>
      )}
    </div>
  )
}
