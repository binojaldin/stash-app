import { useState, useEffect } from 'react'
import { Settings } from 'lucide-react'

interface IconRailProps {
  mainView: { kind: string }
  onNavigate: (kind: 'global-insights' | 'global-attachments') => void
  onOpenMessages?: () => void
  indexProgress: number
  attachmentCount: number
  hasNewInsights: boolean
  onOpenSettings?: () => void
}

const ICONS = [
  { id: 'index', label: 'Index', meta: (p: number) => `${p}% indexed`, color: '#E8604A', nav: 'global-insights' as const,
    path: <><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></> },
  { id: 'messages', label: 'Messages', meta: () => 'Browse conversations', color: '#C8A96E', nav: 'messages-home' as const,
    path: <><rect x="1" y="2" width="14" height="9" rx="2" /><path d="M4 14l2-3h0" /></> },
  { id: 'search', label: 'Search', meta: () => 'Coming in V2', color: '#2EC4A0', nav: null,
    path: <><circle cx="7" cy="7" r="4" /><line x1="10.5" y1="10.5" x2="14" y2="14" /></> },
  { id: 'explore', label: 'Explore', meta: (n: number) => `${n.toLocaleString()} attachments`, color: '#7F77DD', nav: 'global-attachments' as const,
    path: <><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></> },
  { id: 'insights', label: 'Insights', meta: () => 'Tap to explore', color: '#2EC4A0', nav: 'global-insights' as const,
    path: <path d="M2 12l3-4 3 2 3-5 3 3" /> }
]

function RingIcon({ ringPct, ringColor, isActive, pulse, icon, activeColor, onClick, label, meta, onHover }: {
  ringPct: number; ringColor: string; isActive: boolean; pulse: boolean
  icon: JSX.Element; activeColor: string; onClick: () => void; label: string; meta: string
  onHover: (show: boolean, el: HTMLElement | null) => void
}): JSX.Element {
  return (
    <div style={{ position: 'relative', width: 44, height: 44 }}
      onMouseEnter={(e) => onHover(true, e.currentTarget)}
      onMouseLeave={(e) => onHover(false, null)}>
      {/* Ring SVG */}
      <svg style={{ position: 'absolute', top: 0, left: 0, width: 44, height: 44, pointerEvents: 'none' }} viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="15" fill="none" stroke="#1e1e1e" strokeWidth="1.5" />
        <circle cx="22" cy="22" r="15" fill="none" stroke={ringColor} strokeWidth="1.5" strokeLinecap="round"
          strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - ringPct / 100)}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '22px 22px', transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
        {pulse && ringPct > 0 && (
          <circle cx="22" cy="22" r="15" fill="none" stroke={ringColor} strokeWidth="1" opacity="0"
            style={{ animation: 'iconPulse 2.5s ease-in-out infinite', transformOrigin: '22px 22px' }} />
        )}
      </svg>
      {/* Button */}
      <button onClick={onClick}
        style={{ position: 'absolute', top: 4, left: 4, width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isActive ? `${activeColor}18` : 'transparent', border: 'none', cursor: 'pointer', transition: 'background 0.15s' }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#1A1A1A' }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={isActive ? activeColor : '#888888'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </button>
    </div>
  )
}

export function IconRail({ mainView, onNavigate, onOpenMessages, indexProgress, attachmentCount, hasNewInsights, onOpenSettings }: IconRailProps): JSX.Element {
  const [tooltip, setTooltip] = useState<{ label: string; meta: string; y: number } | null>(null)
  const [aiActive, setAiActive] = useState(false)

  useEffect(() => {
    window.api.getAiEnabled().then(setAiActive).catch(() => {})
    const interval = setInterval(() => {
      window.api.getAiEnabled().then(setAiActive).catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const activeId = mainView.kind === 'messages-home' ? 'messages'
    : mainView.kind === 'global-attachments' || mainView.kind === 'person-attachments' ? 'explore'
    : mainView.kind === 'global-insights' || mainView.kind === 'person-insights' ? 'insights' : 'index'

  const ringPcts: Record<string, number> = {
    index: indexProgress,
    messages: 0,
    search: 0,
    explore: Math.min(100, Math.round((attachmentCount / 500) * 100)),
    insights: hasNewInsights ? 60 : 0
  }

  const activeColor = ICONS.find((i) => i.id === activeId)?.color || '#E8604A'

  return (
    <div className="flex flex-col items-center" style={{ width: 48, minWidth: 48, flexShrink: 0, height: '100%', background: '#0A0A0A', borderRight: '1px solid #1A1A1A' }}>
      {/* Top dot — color follows active pillar */}
      <div className="flex items-center justify-center flex-shrink-0" style={{ height: 44, borderBottom: '1px solid #1A1A1A', width: '100%', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: activeColor, transition: 'background 0.3s' }} />
      </div>

      {/* Icons */}
      <div className="flex flex-col items-center gap-2 flex-1" style={{ padding: '12px 0' }}>
        {ICONS.map((icon) => (
          <RingIcon key={icon.id}
            ringPct={ringPcts[icon.id]}
            ringColor={icon.color}
            isActive={activeId === icon.id}
            pulse={icon.id === 'insights' && hasNewInsights}
            icon={icon.path}
            activeColor={icon.color}
            label={icon.label}
            meta={icon.id === 'index' ? icon.meta(indexProgress) : icon.id === 'explore' ? icon.meta(attachmentCount) : icon.meta(0)}
            onClick={() => { if (icon.nav === 'messages-home') { onOpenMessages?.() } else if (icon.nav) { onNavigate(icon.nav) } }}
            onHover={(show, el) => {
              if (show && el) {
                const rect = el.getBoundingClientRect()
                setTooltip({ label: icon.label, meta: icon.id === 'index' ? icon.meta(indexProgress) : icon.id === 'explore' ? icon.meta(attachmentCount) : icon.meta(0), y: rect.top + rect.height / 2 - 18 })
              } else setTooltip(null)
            }}
          />
        ))}
      </div>

      {/* Settings */}
      <div className="flex items-center justify-center" style={{ paddingBottom: 12, position: 'relative' }}>
        <button title="Settings" onClick={() => onOpenSettings?.()} style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', position: 'relative' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A1A' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}>
          <Settings style={{ width: 16, height: 16, stroke: '#555' }} />
          {aiActive && <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: '#2EC4A0' }} />}
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position: 'fixed', left: 56, top: tooltip.y, background: '#1A1A1A', border: '1px solid #2a2a2a', borderRadius: 8, padding: '5px 10px', zIndex: 200, pointerEvents: 'none' }}>
          <div style={{ fontSize: 12, color: '#d8d4d0', fontWeight: 500, fontFamily: "'DM Sans'" }}>{tooltip.label}</div>
          <div style={{ fontSize: 10, color: '#4a4542', fontFamily: "'DM Sans'" }}>{tooltip.meta}</div>
        </div>
      )}

      <style>{`
        @keyframes iconPulse {
          0%, 100% { opacity: 0; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.25); }
        }
      `}</style>
    </div>
  )
}
