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
    <div className="flex items-center gap-2.5 h-10 rounded-lg" style={{ padding: '0 14px', background: '#FFFFFF', border: '1px solid #EAE5DF' }}>
      <Search style={{ width: 14, height: 14, color: '#C8BFB5', flexShrink: 0 }} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search attachments, conversations, text in images..."
        className="flex-1 bg-transparent text-sm outline-none min-w-0"
        style={{ color: '#1A1A1A', fontFamily: 'DM Sans' }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: '#EAE5DF' }}
        >
          <X style={{ width: 10, height: 10, color: '#888888' }} />
        </button>
      )}
    </div>
  )
})
