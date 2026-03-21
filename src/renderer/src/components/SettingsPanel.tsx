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

  // Auth state
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authHasPassword, setAuthHasPassword] = useState(false)
  const [authTouchIdAvailable, setAuthTouchIdAvailable] = useState(false)
  const [authTouchIdEnabled, setAuthTouchIdEnabled] = useState(true)
  const [authIdleTimeout, setAuthIdleTimeout] = useState(15)
  const [showPasswordSetup, setShowPasswordSetup] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.getFeatureFlags(),
      window.api.authGetConfig()
    ]).then(([flags, auth]) => {
      setAiEnabled(flags.aiEnabled)
      setTier(flags.tier)
      setAuthEnabled(auth.enabled)
      setAuthHasPassword(auth.hasPassword)
      setAuthTouchIdAvailable(auth.touchIdAvailable)
      setAuthTouchIdEnabled(auth.touchIdEnabled)
      setAuthIdleTimeout(auth.idleTimeoutMinutes)
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

  const handleSetPassword = async (): Promise<void> => {
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    setPasswordSaving(true)
    try {
      await window.api.authSetupPassword(newPassword)
      setAuthEnabled(true)
      setAuthHasPassword(true)
      setShowPasswordSetup(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPasswordError(String(err))
    } finally {
      setPasswordSaving(false)
    }
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

        {/* Section 0 — Security */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 14, fontFamily: "'DM Sans'", fontWeight: 600 }}>Security</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 14, color: '#d8d8d8', fontFamily: "'DM Sans'", fontWeight: 500 }}>Lock Stash with password</div>
            <button onClick={() => {
              if (authEnabled) {
                setShowDisableConfirm(true)
              } else if (authHasPassword) {
                window.api.authSetEnabled(true).then(() => setAuthEnabled(true))
              } else {
                setShowPasswordSetup(true)
              }
            }} style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative',
              background: authEnabled ? '#2EC4A0' : '#333', transition: 'background 0.2s'
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3,
                left: authEnabled ? 23 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#7c7c7c', lineHeight: 1.6, marginBottom: 12, fontFamily: "'DM Sans'" }}>
            {authEnabled
              ? 'Stash is locked when idle. Unlock with your password or Touch ID.'
              : 'Add a password to protect your messages from anyone with access to this Mac.'}
          </div>

          {/* Password setup flow */}
          {showPasswordSetup && (
            <div style={{ background: '#141414', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #2A2A2A' }}>
              <div style={{ fontSize: 12, color: '#d8d8d8', marginBottom: 10, fontFamily: "'DM Sans'", fontWeight: 500 }}>
                {authHasPassword ? 'Change Password' : 'Set a Password'}
              </div>
              <input type="password" value={newPassword} onChange={e => { setNewPassword(e.target.value); setPasswordError(null) }}
                placeholder="New password (min 8 characters)"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0A0A0A', border: '1px solid #2A2A2A', color: '#fff', fontSize: 13, outline: 'none', marginBottom: 8, fontFamily: "'DM Sans'" }} />
              <input type="password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null) }}
                placeholder="Confirm password"
                onKeyDown={e => { if (e.key === 'Enter') handleSetPassword() }}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0A0A0A', border: '1px solid #2A2A2A', color: '#fff', fontSize: 13, outline: 'none', marginBottom: 8, fontFamily: "'DM Sans'" }} />
              {passwordError && <div style={{ fontSize: 11, color: '#E8604A', marginBottom: 8, fontFamily: "'DM Sans'" }}>{passwordError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setShowPasswordSetup(false); setNewPassword(''); setConfirmPassword(''); setPasswordError(null) }}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, background: '#1A1A1A', color: '#9a948f', border: '1px solid #2A2A2A', cursor: 'pointer', fontFamily: "'DM Sans'" }}>Cancel</button>
                <button onClick={handleSetPassword} disabled={passwordSaving}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, background: '#2EC4A0', color: '#fff', border: 'none', cursor: passwordSaving ? 'default' : 'pointer', opacity: passwordSaving ? 0.5 : 1, fontFamily: "'DM Sans'", fontWeight: 500 }}>
                  {passwordSaving ? 'Saving...' : 'Set Password'}
                </button>
              </div>
            </div>
          )}

          {/* Auth options (when enabled) */}
          {authEnabled && !showPasswordSetup && (
            <>
              <button onClick={() => setShowPasswordSetup(true)}
                style={{ fontSize: 12, color: '#2EC4A0', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: 12, fontFamily: "'DM Sans'" }}>
                Change Password
              </button>

              {authTouchIdAvailable && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: '#d8d8d8', fontFamily: "'DM Sans'" }}>Use Touch ID</div>
                  <button onClick={() => {
                    const next = !authTouchIdEnabled
                    window.api.authSetTouchIdEnabled(next).then(() => setAuthTouchIdEnabled(next))
                  }} style={{
                    width: 38, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', position: 'relative',
                    background: authTouchIdEnabled ? '#2EC4A0' : '#333', transition: 'background 0.2s'
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3,
                      left: authTouchIdEnabled ? 21 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                    }} />
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, color: '#d8d8d8', fontFamily: "'DM Sans'" }}>Lock after</div>
                <select value={authIdleTimeout} onChange={e => {
                  const val = parseInt(e.target.value)
                  window.api.authSetIdleTimeout(val).then(() => setAuthIdleTimeout(val))
                }} style={{
                  background: '#1A1A1A', color: '#d8d8d8', border: '1px solid #2A2A2A', borderRadius: 6,
                  padding: '4px 8px', fontSize: 12, outline: 'none', fontFamily: "'DM Sans'", cursor: 'pointer'
                }}>
                  <option value={0}>Never</option>
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </div>
            </>
          )}
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

      {/* Disable lock confirmation */}
      {showDisableConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDisableConfirm(false)} />
          <div style={{ position: 'relative', width: 380, background: '#0F0F0F', borderRadius: 16, border: '1px solid #2A2A2A', padding: '24px 24px 20px', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 16, color: '#fff', fontWeight: 500, marginBottom: 12, fontFamily: "'DM Sans'" }}>Disable App Lock?</div>
            <div style={{ fontSize: 13, color: '#9a948f', lineHeight: 1.7, marginBottom: 20, fontFamily: "'DM Sans'" }}>
              This will disable app lock. Anyone with access to this Mac can open Stash and see your messages.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowDisableConfirm(false)} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: '#1A1A1A', color: '#9a948f', border: '1px solid #2A2A2A', cursor: 'pointer', fontFamily: "'DM Sans'"
              }}>Cancel</button>
              <button onClick={() => {
                window.api.authSetEnabled(false).then(() => { setAuthEnabled(false); setShowDisableConfirm(false) })
              }} style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: '#E8604A', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'"
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#C44A36' }}
                onMouseLeave={e => { e.currentTarget.style.background = '#E8604A' }}
              >Disable Lock</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Confirmation modal */}
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
