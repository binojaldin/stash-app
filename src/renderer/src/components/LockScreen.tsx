import { useState, useEffect, useRef, useCallback } from 'react'

interface LockScreenProps {
  onUnlock: () => void
  touchIdAvailable: boolean
  touchIdEnabled: boolean
}

export function LockScreen({ onUnlock, touchIdAvailable, touchIdEnabled }: LockScreenProps): JSX.Element {
  const [mode, setMode] = useState<'touchid' | 'password'>(touchIdAvailable && touchIdEnabled ? 'touchid' : 'password')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const attemptTouchId = useCallback(async () => {
    try {
      const result = await window.api.authTouchId()
      if (result === 'success') {
        onUnlock()
      } else if (result === 'fallback') {
        setMode('password')
      }
    } catch {
      setMode('password')
    }
  }, [onUnlock])

  // Auto-attempt Touch ID on mount
  useEffect(() => {
    if (mode === 'touchid') {
      attemptTouchId()
    }
  }, [])

  useEffect(() => {
    if (mode === 'password') {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [mode])

  const handleSubmit = async (): Promise<void> => {
    if (!password.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const ok = await window.api.authVerifyPassword(password)
      if (ok) {
        onUnlock()
      } else {
        setError('Incorrect password')
        setPassword('')
        setShake(true)
        setTimeout(() => setShake(false), 500)
      }
    } catch {
      setError('Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0A0A0A',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', sans-serif"
    }}>
      <style>{`
        @keyframes lockShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
      `}</style>

      {/* Wordmark */}
      <div style={{ marginBottom: 40 }}>
        <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 28, letterSpacing: '0.22em' }}>
          <span style={{ fontWeight: 200, color: '#FFFFFF' }}>ST</span>
          <span style={{ fontWeight: 400, color: '#E8604A' }}>ASH</span>
        </span>
      </div>

      {/* Lock icon */}
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: '#1A1A1A', border: '1px solid #2A2A2A',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 24
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      {mode === 'touchid' ? (
        <>
          <div style={{ fontSize: 14, color: '#7c7c7c', marginBottom: 24 }}>Use Touch ID to unlock</div>
          <button onClick={attemptTouchId} style={{
            padding: '10px 28px', borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: '#2EC4A0', color: '#fff', border: 'none', cursor: 'pointer',
            marginBottom: 16
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#26A88A' }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2EC4A0' }}
          >
            Use Touch ID
          </button>
          <button onClick={() => setMode('password')} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#555'
          }}>
            Use Password
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, color: '#7c7c7c', marginBottom: 20 }}>Enter your password to unlock</div>
          <div style={{
            width: 280,
            animation: shake ? 'lockShake 0.4s ease-in-out' : 'none'
          }}>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Password"
              autoFocus
              style={{
                width: '100%', padding: '12px 16px', borderRadius: 10,
                background: '#141414', border: error ? '1px solid #C94040' : '1px solid #2A2A2A',
                color: '#fff', fontSize: 14, outline: 'none',
                fontFamily: "'DM Sans'", transition: 'border-color 0.2s'
              }}
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#E8604A', marginTop: 8 }}>{error}</div>
          )}
          <button onClick={handleSubmit} disabled={submitting} style={{
            marginTop: 16, padding: '10px 28px', borderRadius: 10, fontSize: 13, fontWeight: 500,
            background: submitting ? '#1A1A1A' : '#2EC4A0', color: '#fff',
            border: 'none', cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.5 : 1
          }}
            onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = '#26A88A' }}
            onMouseLeave={e => { if (!submitting) e.currentTarget.style.background = '#2EC4A0' }}
          >
            {submitting ? 'Verifying...' : 'Unlock'}
          </button>
          {touchIdAvailable && touchIdEnabled && (
            <button onClick={() => { setMode('touchid'); attemptTouchId() }} style={{
              marginTop: 12, background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: '#555'
            }}>
              Use Touch ID
            </button>
          )}
        </>
      )}

      <div style={{ position: 'absolute', bottom: 20, fontSize: 10, color: '#333' }}>
        Your messages are protected
      </div>
    </div>
  )
}
