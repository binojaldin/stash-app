import { LayoutGrid, Search, Clock, AlignLeft, Sparkles, Settings } from 'lucide-react'

const icons = [
  { icon: LayoutGrid, label: 'Browse', active: true, color: '#E8604A' },
  { icon: Search, label: 'Search', active: false, color: '#444444' },
  { icon: Clock, label: 'Recents', active: false, color: '#444444' },
  { icon: AlignLeft, label: 'Insights', active: false, color: '#444444' },
  { icon: Sparkles, label: 'AI', active: false, color: '#2EC4A0' }
]

export function IconRail(): JSX.Element {
  return (
    <div className="flex flex-col items-center" style={{ width: 48, minWidth: 48, flexShrink: 0, height: '100%', background: '#0A0A0A', borderRight: '1px solid #1A1A1A' }}>
      {/* Top dot — drag region for window movement, padded below traffic lights */}
      <div className="flex items-center justify-center flex-shrink-0" style={{ height: 52, paddingTop: 20, borderBottom: '1px solid #1A1A1A', width: '100%', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#E8604A' }} />
      </div>

      {/* Icon buttons */}
      <div className="flex flex-col items-center gap-0.5 flex-1" style={{ padding: '10px 0' }}>
        {icons.map(({ icon: Icon, label, active, color }) => (
          <button
            key={label}
            title={label}
            className="flex items-center justify-center transition-colors"
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: active ? '#1E1E1E' : 'transparent'
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#1A1A1A' }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
          >
            <Icon style={{ width: 16, height: 16, stroke: color }} />
          </button>
        ))}
      </div>

      {/* Footer settings */}
      <div className="flex items-center justify-center" style={{ paddingBottom: 12 }}>
        <button
          title="Settings"
          className="flex items-center justify-center transition-colors"
          style={{ width: 36, height: 36, borderRadius: 8 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A1A' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <Settings style={{ width: 16, height: 16, stroke: '#333333' }} />
        </button>
      </div>
    </div>
  )
}
