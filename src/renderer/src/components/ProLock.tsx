import { useState, useEffect, type ReactNode } from 'react'

export type ProFeature =
  | 'ai_search'
  | 'ai_summaries'
  | 'ai_topic_eras'
  | 'ai_memory_moments'
  | 'ai_relationship_narrative'
  | 'ai_proactive_intel'
  | 'wrapped_ai_insights'

interface ProLockProps {
  feature: ProFeature
  children: ReactNode
  onOpenSettings?: () => void
}

export function ProLock({ feature, children, onOpenSettings }: ProLockProps): JSX.Element {
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.getAiEnabled().then(setAiEnabled).catch(() => setAiEnabled(false))
  }, [])

  // While loading, show children (avoids flash)
  if (aiEnabled === null || aiEnabled) {
    return <>{children}</>
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ opacity: 0.25, pointerEvents: 'none', userSelect: 'none', filter: 'blur(2px)' }}>
        {children}
      </div>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 10,
        background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(4px)',
        borderRadius: 16, zIndex: 10
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9a948f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <div style={{ fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'", fontWeight: 500 }}>AI Required</div>
        <button
          onClick={() => onOpenSettings?.()}
          style={{
            padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 500,
            background: '#2EC4A0', color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: "'DM Sans'"
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#26A88A' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#2EC4A0' }}
        >
          Enable AI
        </button>
      </div>
    </div>
  )
}
