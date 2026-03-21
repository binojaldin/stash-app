import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props): JSX.Element {
  const [aiEnabled, setAiEnabled] = useState(false)
  const [tier, setTier] = useState<'local' | 'pro'>('local')
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getFeatureFlags().then(flags => {
      setAiEnabled(flags.aiEnabled)
      setTier(flags.tier)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleToggle = (): void => {
    if (!aiEnabled) {
      setShowConfirm(true)
    } else {
      window.api.setAiEnabled(false).then(() => setAiEnabled(false))
    }
  }

  const handleConfirmEnable = (): void => {
    window.api.setAiEnabled(true).then(() => {
      setAiEnabled(true)
      setShowConfirm(false)
    })
  }

  if (loading) return <div />

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{ position: 'relative', width: 420, maxHeight: '80vh', background: '#0A0A0A', borderRadius: 20, border: '1px solid #1A1A1A', padding: '28px 28px 24px', overflow: 'auto', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 20, color: '#fff', letterSpacing: '0.02em' }}>Settings</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X style={{ width: 18, height: 18, color: '#555' }} />
          </button>
        </div>

        {/* Section 1 — AI Access */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 14, fontFamily: "'DM Sans'", fontWeight: 600 }}>AI Access</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, color: '#d8d8d8', fontFamily: "'DM Sans'", fontWeight: 500 }}>Enable AI Features</div>
            <button onClick={handleToggle} style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
              background: aiEnabled ? '#2EC4A0' : '#333', transition: 'background 0.2s'
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3,
                left: aiEnabled ? 23 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#7c7c7c', lineHeight: 1.6, fontFamily: "'DM Sans'" }}>
            {aiEnabled
              ? 'AI features are active. Message content may be sent to Anthropic\u2019s servers to power search, summaries, and insights.'
              : 'All data stays on your device. No data is sent to third-party AI services.'}
          </div>
        </div>

        {/* Section 2 — Plan */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 14, fontFamily: "'DM Sans'", fontWeight: 600 }}>Plan</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, color: '#d8d8d8', fontFamily: "'DM Sans'", fontWeight: 500 }}>
              Current tier: <span style={{ color: tier === 'pro' ? '#2EC4A0' : '#9a948f' }}>{tier === 'pro' ? 'Pro' : 'Local'}</span>
            </div>
          </div>
          <button disabled style={{
            width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: '#1A1A1A', color: '#555', border: '1px solid #2A2A2A', cursor: 'not-allowed',
            fontFamily: "'DM Sans'"
          }}>
            Upgrade to Pro
          </button>
          <div style={{ fontSize: 11, color: '#555', marginTop: 8, lineHeight: 1.5, fontFamily: "'DM Sans'" }}>
            Pro unlocks AI-powered features including smart search, relationship insights, summaries, and your yearly Wrapped.
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowConfirm(false)} />
          <div style={{ position: 'relative', width: 380, background: '#0F0F0F', borderRadius: 16, border: '1px solid #2A2A2A', padding: '24px 24px 20px', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 16, color: '#fff', fontWeight: 500, marginBottom: 12, fontFamily: "'DM Sans'" }}>Enable AI Features?</div>
            <div style={{ fontSize: 13, color: '#9a948f', lineHeight: 1.7, marginBottom: 20, fontFamily: "'DM Sans'" }}>
              This will allow Stash to send message content to Anthropic's servers to power AI search, smart summaries, and relationship insights. Your data will leave this device. You can turn this off at any time.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowConfirm(false)} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: '#1A1A1A', color: '#9a948f', border: '1px solid #2A2A2A', cursor: 'pointer',
                fontFamily: "'DM Sans'"
              }}>Cancel</button>
              <button onClick={handleConfirmEnable} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: '#2EC4A0', color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: "'DM Sans'"
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#26A88A' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#2EC4A0' }}
              >Enable AI</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
