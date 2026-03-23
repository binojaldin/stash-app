import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search } from 'lucide-react'
import { ConversationView } from './ConversationView'
import { AttachmentsView } from './AttachmentsView'
import type { Stats } from '../types'

interface ConversationListItem {
  chatIdentifier: string
  displayName: string
  lastMessageBody: string
  lastMessageDate: string
  lastMessageIsFromMe: boolean
  messageCount: number
  hasUnindexedAttachments: boolean
}

interface ConversationStats {
  firstMessageDate: string | null
  longestStreakDays: number
  mostActiveMonth: string | null
  mostActiveDayOfWeek: string | null
  avgMessagesPerDay: number
  peakHour: number | null
  avgResponseTimeMinutes: number | null
  sharedGroupCount: number
  relationshipArc: string | null
  primaryContributor: { displayName: string; messageCount: number; percent: number } | null
  quietestMember: { displayName: string; messageCount: number } | null
  yourContributionPercent: number | null
  memberCount: number
  peakYear: { year: number; count: number } | null
  peakYearShareOfTotal: number | null
}

interface SignalEntry {
  chat_identifier: string
  signal_type: string
  period: string
  current_value: number
  baseline_value: number
  delta_pct: number
  is_significant: boolean
  direction: string
}

interface MessagesHomeProps {
  availableYears: number[]
  chatNameMap: Record<string, string>
  stats: Stats
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type RightTab = 'conversation' | 'photos' | 'insights'

// Deterministic color from name hash
function colorFromName(name: string): string {
  const colors = ['#2EC4A0','#E8604A','#7F77DD','#C8A96E','#5B9BAF','#D4845A','#8BB06A','#B577A0']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

function initialsFrom(name: string): string {
  if (name.startsWith('Group')) return 'G'
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function resolveDisplayName(identifier: string, chatNameMap: Record<string, string>, rawDisplayName: string): string {
  // Use chatNameMap first (already resolved from contacts)
  if (chatNameMap[identifier] && chatNameMap[identifier] !== identifier) return chatNameMap[identifier]
  // Group chats
  if (/^chat\d/i.test(identifier) || identifier.includes(';')) return 'Group conversation'
  // If rawDisplayName is a phone number or identifier, return as-is (will be resolved)
  if (rawDisplayName && rawDisplayName !== identifier && !rawDisplayName.startsWith('+')) return rawDisplayName
  return identifier
}

function formatListDate(sentAt: string): string {
  if (!sentAt) return ''
  const d = new Date(sentAt.replace(' ', 'T'))
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000)

  if (diffDays === 0) {
    const h = d.getHours()
    const m = d.getMinutes()
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  if (d.getFullYear() === now.getFullYear()) return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`
}

function formatHour(h: number): string { return `${h % 12 || 12}:00 ${h >= 12 ? 'PM' : 'AM'}` }

// ── Insights tab sub-component ──
function InsightsPanel({ chatIdentifier, contactName }: { chatIdentifier: string; contactName: string }): JSX.Element {
  const [convStats, setConvStats] = useState<ConversationStats | null>(null)
  const [signals, setSignals] = useState<SignalEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      window.api.getConversationStats(chatIdentifier, false),
      window.api.getSignals(chatIdentifier)
    ]).then(([stats, sigs]) => {
      if (cancelled) return
      setConvStats(stats as ConversationStats)
      setSignals((sigs as SignalEntry[]).slice(0, 3))
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chatIdentifier])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #2A2723', borderTop: '2px solid #C8A96E', borderRadius: '50%', animation: 'mhSpin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (!convStats) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ fontSize: 13, color: '#4A4540' }}>No stats available</div>
      </div>
    )
  }

  const statCards: { label: string; value: string }[] = [
    { label: 'Total messages', value: convStats.avgMessagesPerDay > 0 ? `${Math.round(convStats.avgMessagesPerDay * (convStats.longestStreakDays || 1))}` : '—' },
    { label: 'You send', value: convStats.yourContributionPercent !== null ? `${Math.round(convStats.yourContributionPercent)}%` : '—' },
    { label: 'Most active month', value: convStats.mostActiveMonth || '—' },
    { label: 'Avg reply time', value: convStats.avgResponseTimeMinutes !== null ? `${Math.round(convStats.avgResponseTimeMinutes)} min` : '—' },
    { label: 'Peak hour', value: convStats.peakHour !== null ? formatHour(convStats.peakHour) : '—' },
    { label: 'Started', value: convStats.firstMessageDate ? convStats.firstMessageDate.slice(0, 10) : '—' }
  ]

  const signalColors: Record<string, string> = { up: '#2EC4A0', down: '#E8604A', stable: '#C8A96E' }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: '#0A0907' }}>
      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        {statCards.map(card => (
          <div key={card.label} style={{ background: '#111009', border: '1px solid #1A1814', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: '#E8E4DE', marginBottom: 4 }}>{card.value}</div>
            <div style={{ fontSize: 10, color: '#5A5448', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Signals */}
      {signals.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, color: '#5A5448', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>Signals</div>
          {signals.map((sig, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: i < signals.length - 1 ? '1px solid #1A1814' : 'none' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: signalColors[sig.direction] || '#5A5448', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#D0CBC5' }}>{sig.signal_type.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: 10, color: '#4A4438' }}>{sig.direction === 'up' ? '↑' : sig.direction === 'down' ? '↓' : '→'} {Math.abs(Math.round(sig.delta_pct))}% vs baseline</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Relationship arc */}
      {convStats.relationshipArc && (
        <div style={{ background: '#111009', border: '1px solid #1A1814', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, color: '#5A5448', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Relationship arc</div>
          <div style={{ fontSize: 13, color: '#2EC4A0' }}>{convStats.relationshipArc}</div>
        </div>
      )}
    </div>
  )
}

export function MessagesHome({ availableYears, chatNameMap, stats }: MessagesHomeProps): JSX.Element {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [selectedChat, setSelectedChat] = useState<string | null>(null)
  const [periodYear, setPeriodYear] = useState<number | null>(null)
  const [periodMonth, setPeriodMonth] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<RightTab>('conversation')
  const initialSelectDone = useRef(false)

  const [activePeriod, setActivePeriod] = useState<{ year: number | null; month: number | null }>({ year: null, month: null })

  // Reset tab and period when conversation changes
  const handleSelectChat = useCallback((chatId: string) => {
    setSelectedChat(chatId)
    setActiveTab('conversation')
    setActivePeriod({ year: null, month: null })
  }, [])

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    setLoading(true)
    const result = await window.api.getConversationList(
      periodYear ?? undefined,
      periodMonth ?? undefined,
      searchQuery || undefined
    )
    // Resolve display names
    const resolved = result.map(c => ({
      ...c,
      displayName: resolveDisplayName(c.chatIdentifier, chatNameMap, c.displayName)
    }))
    setConversations(resolved)
    setLoading(false)

    // Auto-select first conversation on initial load
    if (!initialSelectDone.current && resolved.length > 0) {
      setSelectedChat(resolved[0].chatIdentifier)
      initialSelectDone.current = true
    }
  }, [periodYear, periodMonth, searchQuery, chatNameMap])

  useEffect(() => { fetchConversations() }, [fetchConversations])

  const selectedConv = useMemo(() =>
    conversations.find(c => c.chatIdentifier === selectedChat),
    [conversations, selectedChat]
  )

  const handleYearClick = useCallback((year: number) => {
    if (periodYear === year) { setPeriodYear(null); setPeriodMonth(null) }
    else { setPeriodYear(year); setPeriodMonth(null) }
  }, [periodYear])

  const handleMonthClick = useCallback((month: number) => { setPeriodMonth(month) }, [])

  // Tab styling helper
  const tabStyle = (tab: RightTab): React.CSSProperties => ({
    padding: '8px 16px', fontSize: 12, cursor: 'pointer', border: 'none',
    background: 'transparent', fontFamily: "'DM Sans'",
    color: activeTab === tab ? '#E8E4DE' : '#6A6560',
    fontWeight: activeTab === tab ? 500 : 400,
    borderBottom: activeTab === tab ? '2px solid #2EC4A0' : '2px solid transparent',
    marginBottom: -1
  })

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Left panel — conversation list (unchanged) */}
      <div style={{ width: 320, minWidth: 320, flexShrink: 0, height: '100%', background: '#0D0B08', borderRight: '1px solid #1A1814', display: 'flex', flexDirection: 'column' }}>
        {/* Wordmark */}
        <div style={{ height: 44, display: 'flex', alignItems: 'center', paddingLeft: 20, flexShrink: 0, borderBottom: '1px solid #1A1814', WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <span style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 18, letterSpacing: '0.22em' }}>
            <span style={{ fontWeight: 200, color: '#FFFFFF' }}>ST</span>
            <span style={{ fontWeight: 400, color: '#E8604A' }}>ASH</span>
          </span>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 14px 8px', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <Search style={{ width: 13, height: 13, color: '#4A4438', opacity: 0.6 }} />
            </div>
            <input type="text" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchQuery('') }}
              placeholder="Search conversations..."
              style={{
                width: '100%', border: '1px solid #1A1814', background: '#0A0907',
                borderRadius: 10, padding: '9px 12px 9px 30px', fontSize: 12,
                color: '#D0CBC5', outline: 'none', fontFamily: "'DM Sans'"
              }} />
          </div>
        </div>

        {/* Time filter */}
        <div style={{ padding: '4px 14px 10px', flexShrink: 0, borderBottom: '1px solid #1A1814' }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {availableYears.slice(0, 8).map(year => (
              <button key={year} onClick={() => handleYearClick(year)}
                style={{
                  padding: '3px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                  border: '1px solid', fontFamily: "'DM Sans'",
                  borderColor: periodYear === year ? '#C8A96E' : '#2A2620',
                  background: periodYear === year ? '#1A1610' : 'transparent',
                  color: periodYear === year ? '#C8A96E' : '#5A5448'
                }}>
                {year}
              </button>
            ))}
          </div>
          {periodYear && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {MONTH_LABELS.map((mo, idx) => (
                <button key={mo} onClick={() => handleMonthClick(idx + 1)}
                  style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: 9, cursor: 'pointer',
                    border: '1px solid', fontFamily: "'DM Sans'",
                    borderColor: periodMonth === idx + 1 ? '#C8A96E' : '#2A2620',
                    background: periodMonth === idx + 1 ? '#1A1610' : 'transparent',
                    color: periodMonth === idx + 1 ? '#C8A96E' : '#5A5448'
                  }}>
                  {mo}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ width: 20, height: 20, border: '2px solid #2A2723', borderTop: '2px solid #C8A96E', borderRadius: '50%', animation: 'mhSpin 0.7s linear infinite', margin: '0 auto' }} />
            </div>
          ) : conversations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 14px', fontSize: 12, color: '#4A4540' }}>
              No conversations found
            </div>
          ) : (
            conversations.map(conv => {
              const isActive = selectedChat === conv.chatIdentifier
              const isGroup = /^chat\d/i.test(conv.chatIdentifier) || conv.chatIdentifier.includes(';')
              const color = colorFromName(conv.displayName)
              const initials = initialsFrom(conv.displayName)

              return (
                <button key={conv.chatIdentifier}
                  onClick={() => handleSelectChat(conv.chatIdentifier)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: isActive ? '#161310' : 'transparent',
                    borderLeft: isActive ? '2px solid #C8A96E' : '2px solid transparent'
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#111009' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}>
                  {/* Avatar */}
                  <div style={{
                    width: 36, height: 36, minWidth: 36, borderRadius: '50%', background: isGroup ? '#3A3530' : color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 600, color: isGroup ? '#8A8480' : '#0A0A0A'
                  }}>
                    {isGroup ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8A8480" strokeWidth="1.2" strokeLinecap="round">
                        <circle cx="6" cy="5" r="2.5" /><circle cx="10" cy="5" r="2.5" /><path d="M2 14c0-2.2 1.8-4 4-4h4c2.2 0 4 1.8 4 4" />
                      </svg>
                    ) : initials}
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div style={{ fontSize: 13, color: isActive ? '#E8E4DE' : '#B5B0AA', fontWeight: isActive ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {conv.displayName}
                      </div>
                      <div style={{ fontSize: 10, color: '#4A4438', marginLeft: 8, flexShrink: 0 }}>
                        {formatListDate(conv.lastMessageDate)}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#4A4438', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.lastMessageIsFromMe ? 'You: ' : ''}{conv.lastMessageBody}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, padding: '8px 14px', borderTop: '1px solid #1A1814' }}>
          <div style={{ fontSize: 10, color: '#3A3530' }}>
            {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
            {periodYear ? ` in ${periodYear}${periodMonth ? ' ' + MONTH_LABELS[periodMonth - 1] : ''}` : ''}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0A0907' }}>
        {selectedChat && selectedConv ? (() => {
          // Compute dateRange string from activePeriod for Photos tab
          const photosDateRange = activePeriod.year
            ? activePeriod.month
              ? `${activePeriod.year}-${String(activePeriod.month).padStart(2, '0')}`
              : `${activePeriod.year}`
            : 'all'

          const periodLabel = activePeriod.year
            ? activePeriod.month
              ? `${MONTH_LABELS[activePeriod.month - 1]} ${activePeriod.year}`
              : `${activePeriod.year}`
            : null

          // Jump bar chip handlers (work on any tab)
          const handleJumpYearClick = (year: number) => {
            if (activePeriod.year === year) {
              setActivePeriod({ year: null, month: null })
            } else {
              setActivePeriod({ year, month: null })
            }
          }
          const handleJumpMonthClick = (month: number) => {
            setActivePeriod(prev => ({ ...prev, month }))
          }

          return (
            <>
              {/* Tab bar */}
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'flex-end', paddingLeft: 20, borderBottom: '1px solid #1E1C16', background: '#0A0907' }}>
                <button onClick={() => setActiveTab('conversation')} style={tabStyle('conversation')}>Conversation</button>
                <button onClick={() => setActiveTab('photos')} style={tabStyle('photos')}>Photos</button>
                <button onClick={() => setActiveTab('insights')} style={tabStyle('insights')}>Insights</button>
              </div>

              {/* Persistent jump bar — visible on all tabs */}
              <div style={{ flexShrink: 0, padding: '10px 20px 8px', borderBottom: '1px solid #1E1C16' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, color: '#4A4438', letterSpacing: '0.14em', textTransform: 'uppercase', marginRight: 4 }}>Jump to</span>
                  {availableYears.slice(0, 8).map(year => (
                    <button key={year} onClick={() => handleJumpYearClick(year)}
                      style={{
                        padding: '3px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                        border: '1px solid', fontFamily: "'DM Sans'",
                        borderColor: activePeriod.year === year ? '#C8A96E' : '#2A2620',
                        background: activePeriod.year === year ? '#1A1610' : 'transparent',
                        color: activePeriod.year === year ? '#C8A96E' : '#5A5448'
                      }}>
                      {year}
                    </button>
                  ))}
                </div>
                {activePeriod.year && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {MONTH_LABELS.map((mo, idx) => (
                      <button key={mo} onClick={() => handleJumpMonthClick(idx + 1)}
                        style={{
                          padding: '3px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                          border: '1px solid', fontFamily: "'DM Sans'",
                          borderColor: activePeriod.month === idx + 1 ? '#C8A96E' : '#2A2620',
                          background: activePeriod.month === idx + 1 ? '#1A1610' : 'transparent',
                          color: activePeriod.month === idx + 1 ? '#C8A96E' : '#5A5448'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#1A1610'; e.currentTarget.style.borderColor = '#C8A96E'; e.currentTarget.style.color = '#C8A96E' }}
                        onMouseLeave={e => {
                          if (activePeriod.month !== idx + 1) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#2A2620'; e.currentTarget.style.color = '#5A5448' }
                        }}>
                        {mo}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Period label for Photos/Insights tabs */}
              {activeTab !== 'conversation' && periodLabel && (
                <div style={{ flexShrink: 0, padding: '6px 20px', background: '#0D0B08', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#6A6560' }}>
                    Showing {activeTab === 'photos' ? 'photos' : 'insights'} from {periodLabel}
                  </span>
                  <button onClick={() => setActivePeriod({ year: null, month: null })}
                    style={{ fontSize: 10, color: '#C8A96E', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'", padding: 0 }}>
                    Clear
                  </button>
                </div>
              )}

              {/* Contact header — shown for Photos/Insights tabs */}
              {activeTab !== 'conversation' && (
                <div style={{ flexShrink: 0, padding: '12px 20px 10px', borderBottom: '1px solid #1E1C16' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', background: colorFromName(selectedConv.displayName),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 600, color: '#0A0A0A'
                    }}>
                      {initialsFrom(selectedConv.displayName)}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500, color: '#E8E4DE' }}>{selectedConv.displayName}</div>
                      <div style={{ fontSize: 11, color: '#6A6560' }}>
                        {selectedConv.messageCount.toLocaleString()} messages
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab content */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {activeTab === 'conversation' && (
                  <ConversationView
                    key={`${selectedChat}-${activePeriod.year}-${activePeriod.month}`}
                    chatIdentifier={selectedChat}
                    contactName={selectedConv.displayName}
                    contactColor={colorFromName(selectedConv.displayName)}
                    contactInitials={initialsFrom(selectedConv.displayName)}
                    availableYears={availableYears}
                    anchorYear={activePeriod.year ?? undefined}
                    anchorMonth={activePeriod.month ?? undefined}
                    hideHeader
                    onPeriodChange={(year, month) => setActivePeriod({ year, month })}
                  />
                )}
                {activeTab === 'photos' && (
                  <div style={{ flex: 1, minHeight: 0, background: '#F2EDE8' }}>
                    <AttachmentsView
                      key={`photos-${selectedChat}-${photosDateRange}`}
                      mainView={{ kind: 'person-attachments' as const, person: selectedChat }}
                      dateRange={photosDateRange}
                      stats={stats}
                      chatNameMap={chatNameMap}
                      onNavigate={() => {}}
                    />
                  </div>
                )}
                {activeTab === 'insights' && (
                  <InsightsPanel chatIdentifier={selectedChat} contactName={selectedConv.displayName} />
                )}
              </div>
            </>
          )
        })() : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#4A4540', marginBottom: 4 }}>Select a conversation</div>
              <div style={{ fontSize: 11, color: '#3A3530' }}>Choose from the list on the left</div>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes mhSpin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
