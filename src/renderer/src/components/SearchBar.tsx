import { Search, X } from 'lucide-react'
import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
}

export interface SearchBarRef {
  focus: () => void
}

export const SearchBar = forwardRef<SearchBarRef, Props>(function SearchBar({ value, onChange }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus()
  }))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex items-center gap-2.5 px-4 h-10 rounded-lg bg-[#141414] border border-[#262626] focus-within:border-[#3b82f6] focus-within:ring-1 focus-within:ring-[#3b82f6]/50 transition-colors">
      <Search className="w-4 h-4 text-[#636363] flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search attachments, conversations, text in images..."
        className="flex-1 bg-transparent text-sm text-white placeholder-[#636363] outline-none min-w-0"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="w-5 h-5 rounded-full bg-[#262626] flex items-center justify-center hover:bg-[#333] transition-colors flex-shrink-0"
        >
          <X className="w-3 h-3 text-[#a3a3a3]" />
        </button>
      )}
    </div>
  )
})
