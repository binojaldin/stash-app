import { useState, useEffect } from 'react'
import { ChevronDown, X, TrendingUp, TrendingDown, Minus, Sparkles, Star } from 'lucide-react'

interface WrappedData {
  year: number
  totalMessagesSent: number
  totalMessagesReceived: number
  totalAttachments: number
  totalConversations: number
  activeDays: number
  topRelationships: {
    handle: string
    displayName: string
    messagesSent: number
    messagesReceived: number
    totalMessages: number
    firstMessageDate: string
    longestStreakDays: number
    mostActiveMonth: string
  }[]
  monthlyActivity: {
    month: string
    messagesSent: number
    messagesReceived: number
    attachments: number
  }[]
  momentClusters: {
    month: string
    year: number
    attachmentCount: number
    topContact: string
    label: string
  }[]
  personality: {
    peakHour: number
    peakHourLabel: string
    avgResponseTimeMinutes: number
    longestConversationDay: string
    mostUsedEmoji: string | null
  }
  relationshipArcs: {
    handle: string
    displayName: string
    thisYearMessages: number
    lastYearMessages: number
    changePercent: number
    arc: 'new' | 'growing' | 'fading' | 'rekindled' | 'steady'
  }[]
  narrative: {
    headline: string
    topRelationshipLine: string
    mostActivePeriodLine: string
    personalityLine: string
    momentLine: string | null
  }
}

interface Props {
  onClose: () => void
}

const ARC_ICONS: Record<string, JSX.Element> = {
  new: <Sparkles className="w-3.5 h-3.5 text-teal-400" />,
  growing: <TrendingUp className="w-3.5 h-3.5 text-green-400" />,
  fading: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
  rekindled: <Star className="w-3.5 h-3.5 text-amber-400" />,
  steady: <Minus className="w-3.5 h-3.5 text-[#636363]" />
}

const ARC_LABELS: Record<string, string> = {
  new: 'New', growing: 'Growing', fading: 'Fading', rekindled: 'Rekindled', steady: 'Steady'
}

export function WrappedView({ onClose }: Props): JSX.Element {
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [data, setData] = useState<WrappedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getWrappedYears().then((y) => {
      setYears(y)
      if (y.length > 0) setSelectedYear(y[y.length - 1]) // latest year
    })
  }, [])

  useEffect(() => {
    if (!selectedYear) return
    setLoading(true)
    setError(null)
    setData(null)
    window.api.generateWrapped(selectedYear)
      .then((d) => { setData(d as WrappedData); setLoading(false) })
      .catch((err) => { setError(String(err)); setLoading(false) })
  }, [selectedYear])

  const maxMonthly = data ? Math.max(...data.monthlyActivity.map((m) => m.messagesSent + m.messagesReceived), 1) : 1

  return (
    <div className="fixed inset-0 z-40 bg-[#0a0a0a] overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-sm border-b border-[#1c1c1c]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-white">Wrapped</h1>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-[#1c1c1c] border border-[#262626] rounded-lg px-3 py-1.5 text-sm text-white outline-none"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#1c1c1c] flex items-center justify-center hover:bg-[#262626]">
            <X className="w-4 h-4 text-[#a3a3a3]" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#636363]">Generating your {selectedYear} wrapped...</p>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-[60vh]">
          <p className="text-sm text-red-400">Error: {error}</p>
        </div>
      )}

      {data && !loading && (
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
          {/* Narrative headline */}
          <div className="text-center space-y-3">
            <h2 className="text-3xl font-bold text-white">{data.narrative.headline}</h2>
            <p className="text-sm text-[#a3a3a3]">{data.narrative.topRelationshipLine}</p>
            <p className="text-sm text-[#636363]">{data.narrative.mostActivePeriodLine}</p>
            <p className="text-sm text-[#636363]">{data.narrative.personalityLine}</p>
            {data.narrative.momentLine && (
              <p className="text-sm text-teal-400">{data.narrative.momentLine}</p>
            )}
          </div>

          {/* Top-line stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard label="Messages sent" value={data.totalMessagesSent.toLocaleString()} />
            <StatCard label="Messages received" value={data.totalMessagesReceived.toLocaleString()} />
            <StatCard label="Attachments" value={data.totalAttachments.toLocaleString()} />
            <StatCard label="Conversations" value={data.totalConversations.toLocaleString()} />
            <StatCard label="Active days" value={data.activeDays.toLocaleString()} />
            <StatCard label="Most used emoji" value={data.personality.mostUsedEmoji || '—'} large />
          </div>

          {/* Monthly activity chart */}
          <Section title="Monthly activity">
            <div className="flex items-end gap-1 h-32">
              {data.monthlyActivity.map((m) => {
                const total = m.messagesSent + m.messagesReceived
                const height = Math.max((total / maxMonthly) * 100, 2)
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                      <div
                        className="w-full bg-teal-500/80 rounded-t-sm"
                        style={{ height: `${height}%` }}
                        title={`${m.month}: ${total.toLocaleString()} messages`}
                      />
                    </div>
                    <span className="text-[9px] text-[#636363]">{m.month.slice(0, 3)}</span>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* Top relationships */}
          <Section title="Top relationships">
            <div className="space-y-3">
              {data.topRelationships.map((r, i) => (
                <div key={r.handle} className="flex items-center gap-3 p-3 rounded-lg bg-[#141414] border border-[#1c1c1c]">
                  <span className="w-6 h-6 rounded-full bg-teal-600/20 text-teal-400 text-xs flex items-center justify-center font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{r.displayName}</p>
                    <p className="text-xs text-[#636363]">
                      {r.totalMessages.toLocaleString()} messages · {r.longestStreakDays}-day streak · Most active in {r.mostActiveMonth}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-[#a3a3a3]">{r.messagesSent.toLocaleString()} sent</p>
                    <p className="text-xs text-[#636363]">{r.messagesReceived.toLocaleString()} received</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Relationship arcs */}
          {data.relationshipArcs.length > 0 && (
            <Section title="Relationship arcs">
              <div className="space-y-2">
                {data.relationshipArcs.filter((r) => r.arc !== 'steady').slice(0, 10).map((r) => (
                  <div key={r.handle} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#141414] border border-[#1c1c1c]">
                    {ARC_ICONS[r.arc]}
                    <span className="text-sm text-white flex-1 truncate">{r.displayName}</span>
                    <span className="text-xs text-[#636363]">
                      {r.lastYearMessages.toLocaleString()} → {r.thisYearMessages.toLocaleString()}
                    </span>
                    <span className={`text-xs font-medium ${r.changePercent > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {r.changePercent > 0 ? '+' : ''}{r.changePercent}%
                    </span>
                    <span className="text-[10px] text-[#4a4a4a] w-16 text-right">{ARC_LABELS[r.arc]}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Moment clusters */}
          {data.momentClusters.length > 0 && (
            <Section title="Big moments">
              <div className="space-y-2">
                {data.momentClusters.map((m) => (
                  <div key={m.month} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#141414] border border-[#1c1c1c]">
                    <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-white">{m.month}</p>
                      <p className="text-xs text-[#636363]">{m.attachmentCount} attachments · {m.topContact}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Personality */}
          <Section title="Your texting personality">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Peak hour" value={`${data.personality.peakHour}:00`} sub={data.personality.peakHourLabel} />
              <StatCard label="Avg reply time" value={`${data.personality.avgResponseTimeMinutes}m`} />
              <StatCard label="Busiest day" value={data.personality.longestConversationDay} />
              <StatCard label="Favorite emoji" value={data.personality.mostUsedEmoji || '—'} large />
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[#636363] uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  )
}

function StatCard({ label, value, sub, large }: { label: string; value: string; sub?: string; large?: boolean }): JSX.Element {
  return (
    <div className="p-4 rounded-lg bg-[#141414] border border-[#1c1c1c]">
      <p className="text-[10px] text-[#636363] uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-bold text-white ${large ? 'text-2xl' : 'text-xl'}`}>{value}</p>
      {sub && <p className="text-xs text-[#636363] mt-0.5">{sub}</p>}
    </div>
  )
}
