import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Crown } from 'lucide-react'

interface WrappedData {
  year: number
  totalMessagesSent: number
  totalMessagesReceived: number
  totalAttachments: number
  totalConversations: number
  activeDays: number
  topRelationships: {
    handle: string; displayName: string; messagesSent: number; messagesReceived: number
    totalMessages: number; firstMessageDate: string; longestStreakDays: number
    mostActiveMonth: string; sharedGroupCount: number
  }[]
  monthlyActivity: { month: string; messagesSent: number; messagesReceived: number; attachments: number }[]
  momentClusters: { month: string; year: number; attachmentCount: number; topContact: string; label: string }[]
  personality: { peakHour: number; peakHourLabel: string; avgResponseTimeMinutes: number; longestConversationDay: string; mostUsedEmoji: string | null }
  relationshipArcs: { handle: string; displayName: string; thisYearMessages: number; lastYearMessages: number; changePercent: number; arc: 'new' | 'growing' | 'fading' | 'rekindled' | 'steady' }[]
  groupStats: {
    chatName: string; totalMessages: number; activeDays: number; memberCount: number
    members: { handle: string; displayName: string; messageCount: number; percentOfGroup: number }[]
    primaryContributor: { handle: string; displayName: string; messageCount: number }
    quietestMember: { handle: string; displayName: string; messageCount: number }
    mostActiveMonth: string; mostActiveDay: string; avgMessagesPerDay: number
    yourContribution: { messageCount: number; percentOfGroup: number }
    firstMessageDate: string; longestStreakDays: number
  }[]
  narrative: { headline: string; topRelationshipLine: string; mostActivePeriodLine: string; personalityLine: string; momentLine: string | null }
}

interface Props { onClose: () => void }

const TOTAL_SLIDES = 11
const ARC_COLORS: Record<string, string> = { new: 'bg-teal-500 text-white', growing: 'bg-teal-500 text-white', fading: 'bg-red-500 text-white', rekindled: 'bg-amber-500 text-white', steady: 'bg-[#333] text-[#a3a3a3]' }
const ARC_LABELS: Record<string, string> = { new: 'New', growing: 'Growing', fading: 'Fading', rekindled: 'Rekindled', steady: 'Steady' }
const MEMBER_COLORS = ['bg-teal-400', 'bg-blue-400', 'bg-purple-400', 'bg-amber-400', 'bg-pink-400', 'bg-green-400', 'bg-red-400', 'bg-cyan-400']

export function WrappedView({ onClose }: Props): JSX.Element {
  const [years, setYears] = useState<number[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [data, setData] = useState<WrappedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slide, setSlide] = useState(0)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    window.api.getWrappedYears().then((y) => { setYears(y); if (y.length > 0) setSelectedYear(y[y.length - 1]) })
  }, [])

  useEffect(() => {
    if (!selectedYear) return
    setLoading(true); setError(null); setData(null); setSlide(0)
    window.api.generateWrapped(selectedYear)
      .then((d) => { setData(d as WrappedData); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [selectedYear])

  const go = useCallback((dir: number) => {
    setSlide((s) => { const next = s + dir; if (next < 0 || next >= TOTAL_SLIDES) return s; setAnimKey((k) => k + 1); return next })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, go])

  const changeYear = (y: number): void => { setSelectedYear(y) }

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ background: '#080808', zIndex: 200, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={() => go(1)}
    >
      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#1a1a1a] z-50">
        <div className="h-full bg-teal-500 transition-all duration-300 ease-out" style={{ width: `${(slide / (TOTAL_SLIDES - 1)) * 100}%` }} />
      </div>

      {/* Close */}
      <button onClick={(e) => { e.stopPropagation(); onClose() }} className="absolute top-4 right-5 z-50 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors">
        <X className="w-4 h-4 text-white" />
      </button>

      {/* Nav arrows */}
      {slide > 0 && (
        <button onClick={(e) => { e.stopPropagation(); go(-1) }} className="absolute left-4 top-1/2 -translate-y-1/2 z-50 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors opacity-0 hover:opacity-100">
          <ChevronLeft className="w-5 h-5 text-white/60" />
        </button>
      )}
      {slide < TOTAL_SLIDES - 1 && (
        <button onClick={(e) => { e.stopPropagation(); go(1) }} className="absolute right-4 top-1/2 -translate-y-1/2 z-50 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors opacity-0 hover:opacity-100">
          <ChevronRight className="w-5 h-5 text-white/60" />
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white text-sm">Generating your {selectedYear}...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={(e) => { e.stopPropagation(); setSelectedYear(selectedYear) }} className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20">Retry</button>
        </div>
      )}

      {/* Slides */}
      {data && !loading && !error && (
        <div key={animKey} className="h-full flex items-center justify-center" style={{ animation: 'wrappedFadeIn 300ms ease-out' }}>
          {slide === 0 && <SlideOpening data={data} />}
          {slide === 1 && <SlideHeadline data={data} />}
          {slide === 2 && <SlideTopBond data={data} />}
          {slide === 3 && <SlideStreak data={data} />}
          {slide === 4 && <SlideArc data={data} />}
          {slide === 5 && <SlideMoment data={data} />}
          {slide === 6 && <SlideGroups data={data} />}
          {slide === 7 && <SlidePersonality data={data} />}
          {slide === 8 && <SlideMonthly data={data} />}
          {slide === 9 && <SlideEmoji data={data} />}
          {slide === 10 && <SlideShare data={data} />}
        </div>
      )}

      {/* Bottom: year pills + slide counter */}
      <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-2 z-50" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1">
          {years.map((y) => (
            <button key={y} onClick={() => changeYear(y)} className={`px-2.5 py-0.5 rounded-full text-[10px] transition-colors ${selectedYear === y ? 'bg-teal-600 text-white' : 'text-[#4a4a4a] hover:text-[#888]'}`}>{y}</button>
          ))}
        </div>
        <p className="text-[10px] text-[#333]">{slide + 1} / {TOTAL_SLIDES}</p>
      </div>

      <style>{`
        @keyframes wrappedFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

// ── Slides ──

function SlideOpening({ data }: { data: WrappedData }): JSX.Element {
  const total = data.totalMessagesSent + data.totalMessagesReceived
  return (
    <div className="text-center">
      <p className="text-[#4a4a4a] text-sm tracking-widest uppercase mb-4">your year in messages</p>
      <p className="text-white font-bold leading-none" style={{ fontSize: '160px' }}>{data.year}</p>
      <div className="mt-8 flex items-center justify-center gap-12">
        <div><p className="text-white text-4xl font-bold">{total.toLocaleString()}</p><p className="text-[#636363] text-sm mt-1">messages</p></div>
        <div><p className="text-white text-4xl font-bold">{data.activeDays}</p><p className="text-[#636363] text-sm mt-1">active days</p></div>
      </div>
    </div>
  )
}

function SlideHeadline({ data }: { data: WrappedData }): JSX.Element {
  return (
    <div className="text-center max-w-[560px] px-6">
      <p className="text-white font-bold text-5xl leading-tight">{data.narrative.headline}</p>
      <p className="text-[#636363] text-base mt-6 leading-relaxed">{data.narrative.topRelationshipLine}</p>
    </div>
  )
}

function SlideTopBond({ data }: { data: WrappedData }): JSX.Element {
  const top = data.topRelationships[0]
  if (!top) return <div className="text-[#636363]">No relationships found</div>
  const total = top.messagesSent + top.messagesReceived
  const sentPct = total > 0 ? (top.messagesSent / total) * 100 : 50
  return (
    <div className="text-center">
      <p className="text-white font-bold leading-tight" style={{ fontSize: '56px' }}>{top.displayName}</p>
      <p className="text-teal-400 font-bold mt-4" style={{ fontSize: '32px' }}>{top.totalMessages.toLocaleString()} messages</p>
      <p className="text-[#636363] text-sm mt-3">{top.longestStreakDays}-day streak · Most active in {top.mostActiveMonth}</p>
      <div className="w-[400px] mx-auto mt-6 h-2 rounded-full overflow-hidden flex bg-[#1a1a1a]">
        <div className="bg-teal-500 rounded-l-full" style={{ width: `${sentPct}%` }} />
        <div className="bg-[#333] flex-1 rounded-r-full" />
      </div>
      <div className="flex justify-between w-[400px] mx-auto mt-2 text-[10px]">
        <span className="text-teal-400">{top.messagesSent.toLocaleString()} sent</span>
        <span className="text-[#636363]">{top.messagesReceived.toLocaleString()} received</span>
      </div>
    </div>
  )
}

function SlideStreak({ data }: { data: WrappedData }): JSX.Element {
  const top = data.topRelationships[0]
  if (!top || top.longestStreakDays === 0) return <div className="text-center"><p className="text-white text-5xl font-bold">Every day counts</p><p className="text-[#636363] mt-4">Keep the conversation going</p></div>
  return (
    <div className="text-center">
      <p className="text-white font-bold leading-none" style={{ fontSize: '120px' }}>{top.longestStreakDays}</p>
      <p className="text-[#636363] text-xl mt-2">days in a row</p>
      <p className="text-[#4a4a4a] text-base mt-4">with {top.displayName}</p>
      <div className="flex justify-center gap-1 mt-8">
        {data.monthlyActivity.map((m, i) => {
          const active = (m.messagesSent + m.messagesReceived) > 0
          return <div key={i} className={`w-6 h-6 rounded-sm ${active ? 'bg-teal-500/60' : 'bg-[#1a1a1a]'}`} title={m.month} />
        })}
      </div>
      <div className="flex justify-center gap-1 mt-1">
        {data.monthlyActivity.map((m, i) => <span key={i} className="w-6 text-[8px] text-[#333] text-center">{m.month.slice(0, 1)}</span>)}
      </div>
    </div>
  )
}

function SlideArc({ data }: { data: WrappedData }): JSX.Element {
  const arc = data.relationshipArcs[0]
  if (!arc) return <div className="text-center text-[#636363]">No significant changes this year</div>
  return (
    <div className="text-center">
      <p className="text-white font-bold" style={{ fontSize: '40px' }}>{arc.displayName}</p>
      <div className="mt-4"><span className={`inline-block px-4 py-1.5 rounded-full text-sm font-medium ${ARC_COLORS[arc.arc]}`}>{ARC_LABELS[arc.arc]}</span></div>
      <div className="flex items-center justify-center gap-6 mt-8">
        <div className="text-right"><p className="text-[#636363] text-xs">Last year</p><p className="text-white text-2xl font-bold">{arc.lastYearMessages.toLocaleString()}</p></div>
        <span className="text-[#333] text-2xl">&rarr;</span>
        <div className="text-left"><p className="text-[#636363] text-xs">This year</p><p className="text-white text-2xl font-bold">{arc.thisYearMessages.toLocaleString()}</p></div>
      </div>
      <p className={`text-4xl font-bold mt-6 ${arc.changePercent > 0 ? 'text-green-400' : 'text-red-400'}`}>
        {arc.changePercent > 0 ? '+' : ''}{arc.changePercent}%
      </p>
    </div>
  )
}

function SlideMoment({ data }: { data: WrappedData }): JSX.Element {
  const moment = data.momentClusters[0]
  if (!moment) {
    const peak = data.monthlyActivity.reduce((best, m) => (m.messagesSent + m.messagesReceived) > (best.messagesSent + best.messagesReceived) ? m : best, data.monthlyActivity[0])
    return (
      <div className="text-center">
        <p className="text-[#636363] text-sm mb-4">Your most active month</p>
        <p className="text-white font-bold" style={{ fontSize: '64px' }}>{peak.month}</p>
        <p className="text-teal-400 text-2xl mt-4">{(peak.messagesSent + peak.messagesReceived).toLocaleString()} messages</p>
      </div>
    )
  }
  return (
    <div className="text-center">
      <p className="text-[#636363] text-sm mb-4">Something big happened</p>
      <p className="text-white font-bold" style={{ fontSize: '64px' }}>{moment.month}</p>
      <p className="text-teal-400 text-2xl mt-4">{moment.attachmentCount} moments shared</p>
      <p className="text-[#4a4a4a] text-base mt-3">with {moment.topContact}</p>
    </div>
  )
}

function SlideGroups({ data }: { data: WrappedData }): JSX.Element {
  const g = data.groupStats[0]
  if (!g) return <div className="text-center"><p className="text-white text-4xl font-bold">No group chats</p><p className="text-[#636363] mt-4">This year was all about 1:1 conversations</p></div>
  return (
    <div className="text-center max-w-[440px]">
      <p className="text-white font-bold leading-tight" style={{ fontSize: '40px' }}>{g.chatName}</p>
      <p className="text-[#636363] text-lg mt-2">{g.totalMessages.toLocaleString()} messages · {g.memberCount} members</p>
      <div className="w-full h-3 rounded-full overflow-hidden flex gap-px mt-6 bg-[#1a1a1a]">
        {g.yourContribution.percentOfGroup > 0 && <div className="bg-teal-400 rounded-sm" style={{ width: `${g.yourContribution.percentOfGroup}%` }} />}
        {g.members.map((m, i) => <div key={m.handle} className={`${MEMBER_COLORS[(i + 1) % MEMBER_COLORS.length]} rounded-sm`} style={{ width: `${m.percentOfGroup}%` }} />)}
      </div>
      <p className="text-teal-400 text-sm mt-3">You contributed {g.yourContribution.percentOfGroup}%</p>
      <div className="flex items-center justify-center gap-1.5 mt-2 text-[#636363] text-xs">
        <Crown className="w-3 h-3 text-amber-400" /> {g.primaryContributor.displayName}
      </div>
    </div>
  )
}

function SlidePersonality({ data }: { data: WrappedData }): JSX.Element {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  return (
    <div className="text-center">
      <p className="text-[#636363] text-xl">You're a</p>
      <p className="text-white font-bold mt-1" style={{ fontSize: '56px' }}>{data.personality.peakHourLabel}</p>
      <p className="text-[#636363] text-xl mt-1">texter</p>
      {data.personality.avgResponseTimeMinutes > 0 && (
        <p className="text-[#4a4a4a] text-sm mt-6">Average reply time: {data.personality.avgResponseTimeMinutes} minutes</p>
      )}
      <div className="flex items-end justify-center gap-[3px] mt-8 h-12">
        {hours.map((h) => {
          const isPeak = h === data.personality.peakHour
          const dist = Math.abs(h - data.personality.peakHour)
          const wrapped = Math.min(dist, 24 - dist)
          const height = Math.max(8, 48 - wrapped * 6)
          return <div key={h} className={`w-[6px] rounded-t-sm transition-all ${isPeak ? 'bg-teal-400' : 'bg-[#222]'}`} style={{ height: `${height}px` }} />
        })}
      </div>
      <div className="flex justify-between w-[200px] mx-auto mt-1 text-[9px] text-[#333]">
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
      </div>
    </div>
  )
}

function SlideMonthly({ data }: { data: WrappedData }): JSX.Element {
  const max = Math.max(...data.monthlyActivity.map((m) => m.messagesSent + m.messagesReceived), 1)
  const peak = data.monthlyActivity.reduce((best, m) => (m.messagesSent + m.messagesReceived) > (best.messagesSent + best.messagesReceived) ? m : best, data.monthlyActivity[0])
  return (
    <div className="text-center">
      <p className="text-[#636363] text-sm mb-3">Your loudest month</p>
      <p className="text-white font-bold" style={{ fontSize: '64px' }}>{peak.month}</p>
      <p className="text-teal-400 text-lg mt-1">{(peak.messagesSent + peak.messagesReceived).toLocaleString()} messages</p>
      <div className="flex items-end justify-center gap-2 mt-8" style={{ height: '120px' }}>
        {data.monthlyActivity.map((m) => {
          const total = m.messagesSent + m.messagesReceived
          const h = Math.max((total / max) * 100, 3)
          const isPeak = m.month === peak.month
          return (
            <div key={m.month} className="flex flex-col items-center gap-1 w-7">
              <div className={`w-full rounded-t-sm ${isPeak ? 'bg-white' : 'bg-teal-500/60'}`} style={{ height: `${h}px` }} />
              <span className="text-[9px] text-[#444]">{m.month.slice(0, 3)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SlideEmoji({ data }: { data: WrappedData }): JSX.Element {
  if (!data.personality.mostUsedEmoji) {
    return (
      <div className="text-center">
        <p className="text-white text-4xl font-bold">You texted across</p>
        <p className="text-teal-400 font-bold mt-2" style={{ fontSize: '72px' }}>{data.totalConversations}</p>
        <p className="text-white text-4xl font-bold">conversations</p>
        <p className="text-[#636363] text-sm mt-6">{data.narrative.personalityLine}</p>
      </div>
    )
  }
  return (
    <div className="text-center">
      <p style={{ fontSize: '96px' }}>{data.personality.mostUsedEmoji}</p>
      <p className="text-[#636363] text-lg mt-4">your most-used emoji this year</p>
      <p className="text-[#4a4a4a] text-sm mt-6">{data.narrative.personalityLine}</p>
    </div>
  )
}

function SlideShare({ data }: { data: WrappedData }): JSX.Element {
  const top = data.topRelationships[0]
  const peak = data.monthlyActivity.reduce((best, m) => (m.messagesSent + m.messagesReceived) > (best.messagesSent + best.messagesReceived) ? m : best, data.monthlyActivity[0])
  return (
    <div className="text-center" style={{ background: '#111', borderRadius: '16px', padding: '48px', maxWidth: '420px' }}>
      <p className="text-white text-2xl font-bold mb-8">Your {data.year} wrapped</p>
      <div className="grid grid-cols-2 gap-6 text-left">
        <div><p className="text-[#636363] text-[10px] uppercase tracking-wider">Messages</p><p className="text-white text-xl font-bold">{(data.totalMessagesSent + data.totalMessagesReceived).toLocaleString()}</p></div>
        <div><p className="text-[#636363] text-[10px] uppercase tracking-wider">Top contact</p><p className="text-white text-xl font-bold truncate">{top?.displayName || '—'}</p></div>
        <div><p className="text-[#636363] text-[10px] uppercase tracking-wider">Longest streak</p><p className="text-white text-xl font-bold">{top?.longestStreakDays || 0} days</p></div>
        <div><p className="text-[#636363] text-[10px] uppercase tracking-wider">Peak month</p><p className="text-white text-xl font-bold">{peak.month}</p></div>
      </div>
      <p className="text-[#333] text-xs mt-8">Share card coming soon</p>
    </div>
  )
}
