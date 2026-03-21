import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Crown } from 'lucide-react'
import { ProLock } from './ProLock'

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

interface Props { onClose: () => void; onOpenSettings?: () => void }

const TOTAL_SLIDES = 11
const MEMBER_COLORS = ['#60a5fa', '#a78bfa', '#fbbf24', '#f472b6', '#34d399', '#f87171', '#22d3ee', '#fb923c']

// ── Inline styles for cinematic slides ──
const S = {
  slide: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px 32px', textAlign: 'center' as const, position: 'relative' as const, overflow: 'hidden' as const },
  year: { fontFamily: 'system-ui, sans-serif', fontWeight: 200, fontSize: 140, lineHeight: 1, color: '#fff', letterSpacing: '-0.03em' },
  heroNum: { fontFamily: 'system-ui, sans-serif', fontWeight: 200, fontSize: 100, lineHeight: 1, color: '#fff' },
  heroName: { fontFamily: 'system-ui, sans-serif', fontWeight: 300, fontSize: 72, lineHeight: 1.1, color: '#2EC4A0', letterSpacing: '-0.02em' },
  headline: { fontFamily: 'system-ui, sans-serif', fontWeight: 300, fontSize: 36, lineHeight: 1.6, color: '#fff', maxWidth: 520 },
  label: { fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.25)' },
  muted: { fontSize: 15, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 },
  stat: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  tealLine: { width: 40, height: 1, background: '#2EC4A0', margin: '0 auto' },
}

export function WrappedView({ onClose, onOpenSettings }: Props): JSX.Element {
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
      <style>{`
        @keyframes wFadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wReveal { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes wPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.8; } }
        .anim-up { animation: wFadeUp 700ms ease-out both; }
        .anim-in { animation: wFadeIn 500ms ease-out both; }
        .anim-reveal { animation: wReveal 600ms ease-out both; }
        .d0 { animation-delay: 0ms; } .d1 { animation-delay: 150ms; } .d2 { animation-delay: 300ms; }
        .d3 { animation-delay: 450ms; } .d4 { animation-delay: 600ms; } .d5 { animation-delay: 800ms; }
      `}</style>

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
        <ProLock feature="wrapped_ai_insights" onOpenSettings={onOpenSettings}>
          <div key={animKey} style={{ height: '100%' }}>
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
        </ProLock>
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
    </div>
  )
}

// ── SLIDES ──

function SlideOpening({ data }: { data: WrappedData }): JSX.Element {
  const total = data.totalMessagesSent + data.totalMessagesReceived
  return (
    <div style={S.slide}>
      <div className="anim-up d0" style={S.label}>your year in messages</div>
      <div className="anim-reveal d1" style={{ ...S.year, marginTop: 16 }}>{data.year}</div>
      <div className="anim-up d2" style={{ ...S.stat, marginTop: 32, display: 'flex', gap: 24, justifyContent: 'center' }}>
        <span>{total.toLocaleString()} messages</span>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <span>{data.totalConversations} conversations</span>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
        <span>{data.activeDays} active days</span>
      </div>
      <div className="anim-in d4" style={{ ...S.tealLine, marginTop: 40 }} />
    </div>
  )
}

function SlideHeadline({ data }: { data: WrappedData }): JSX.Element {
  return (
    <div style={S.slide}>
      <div className="anim-up d1" style={S.headline}>{data.narrative.headline}</div>
      <div className="anim-up d3" style={{ ...S.muted, marginTop: 24, maxWidth: 440 }}>{data.narrative.topRelationshipLine}</div>
    </div>
  )
}

function SlideTopBond({ data }: { data: WrappedData }): JSX.Element {
  const top = data.topRelationships[0]
  if (!top) return <div style={S.slide}><div style={{ ...S.muted, fontSize: 20 }}>A quiet year.</div></div>
  return (
    <div style={S.slide}>
      <div className="anim-up d0" style={S.label}>your #1</div>
      <div className="anim-reveal d1" style={{ ...S.heroName, marginTop: 12 }}>{top.displayName}</div>
      <div className="anim-up d2" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 32, color: 'rgba(255,255,255,0.6)', marginTop: 12 }}>{top.totalMessages.toLocaleString()} messages</div>
      <div className="anim-up d3" style={{ ...S.stat, marginTop: 28, display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        {top.firstMessageDate && <span>First message: {new Date(top.firstMessageDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
        {top.longestStreakDays > 0 && <span>Streak: {top.longestStreakDays} days</span>}
        {top.sharedGroupCount > 0 && <span>{top.sharedGroupCount} shared group{top.sharedGroupCount > 1 ? 's' : ''}</span>}
      </div>
    </div>
  )
}

function SlideStreak({ data }: { data: WrappedData }): JSX.Element {
  const top = data.topRelationships[0]
  const streak = top?.longestStreakDays || 0
  if (streak === 0) return <div style={S.slide}><div className="anim-up d0" style={{ ...S.headline, fontSize: 28 }}>Every day counts.</div><div className="anim-up d1" style={S.muted}>Keep the conversation going.</div></div>
  const flavor = streak > 60 ? "That's not a conversation — that's a commitment." : streak > 30 ? 'Over a month straight. Something was happening.' : 'Short but sweet.'
  return (
    <div style={S.slide}>
      <div className="anim-reveal d0" style={{ ...S.heroNum, color: '#E8604A' }}>{streak}</div>
      <div className="anim-up d1" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 24, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>days in a row</div>
      <div className="anim-up d2" style={{ ...S.muted, marginTop: 20 }}>with {top!.displayName}</div>
      <div className="anim-up d3" style={{ ...S.stat, marginTop: 16, fontStyle: 'italic' }}>{flavor}</div>
    </div>
  )
}

function SlideArc({ data }: { data: WrappedData }): JSX.Element {
  // Pick the arc with biggest absolute change
  const sorted = [...data.relationshipArcs].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
  const arc = sorted[0]
  if (!arc) return <div style={S.slide}><div style={S.muted}>No significant changes this year.</div></div>
  const isPositive = arc.changePercent > 0
  const arcColors: Record<string, string> = { new: '#2EC4A0', growing: '#2EC4A0', fading: '#E8604A', rekindled: '#fbbf24', steady: '#666' }
  const arcLabels: Record<string, string> = { new: 'New', growing: 'Growing', fading: 'Fading', rekindled: 'Rekindled', steady: 'Steady' }
  return (
    <div style={S.slide}>
      <div className="anim-up d0" style={S.label}>relationship shift</div>
      <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 300, fontSize: 56, color: '#fff', marginTop: 12 }}>{arc.displayName}</div>
      <div className="anim-up d2" style={{ marginTop: 16 }}>
        <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: `${arcColors[arc.arc]}20`, color: arcColors[arc.arc] }}>{arcLabels[arc.arc]}</span>
      </div>
      <div className="anim-up d3" style={{ display: 'flex', alignItems: 'center', gap: 32, marginTop: 28 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ ...S.label, marginBottom: 4 }}>last year</div>
          <div style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 28, color: 'rgba(255,255,255,0.5)' }}>{arc.lastYearMessages.toLocaleString()}</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: 20 }}>&rarr;</div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ ...S.label, marginBottom: 4 }}>this year</div>
          <div style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 28, color: '#fff' }}>{arc.thisYearMessages.toLocaleString()}</div>
        </div>
      </div>
      <div className="anim-reveal d4" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 48, color: isPositive ? '#2EC4A0' : '#E8604A', marginTop: 20 }}>
        {isPositive ? '+' : ''}{arc.changePercent}%
      </div>
    </div>
  )
}

function SlideMoment({ data }: { data: WrappedData }): JSX.Element {
  const moment = data.momentClusters[0]
  if (!moment) {
    const peak = data.monthlyActivity.reduce((b, m) => (m.messagesSent + m.messagesReceived) > (b.messagesSent + b.messagesReceived) ? m : b, data.monthlyActivity[0])
    return (
      <div style={{ ...S.slide, background: 'radial-gradient(ellipse at center, rgba(232,96,74,0.06) 0%, transparent 70%)' }}>
        <div className="anim-up d0" style={S.label}>peak moment</div>
        <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 80, color: '#fff', marginTop: 8 }}>{peak.month}</div>
        <div className="anim-up d2" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 24, color: '#E8604A', marginTop: 12 }}>{(peak.messagesSent + peak.messagesReceived).toLocaleString()} messages</div>
      </div>
    )
  }
  return (
    <div style={{ ...S.slide, background: 'radial-gradient(ellipse at center, rgba(232,96,74,0.06) 0%, transparent 70%)' }}>
      <div className="anim-up d0" style={S.label}>something big happened</div>
      <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 80, color: '#fff', marginTop: 8 }}>{moment.month}</div>
      <div className="anim-up d2" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 24, color: '#E8604A', marginTop: 12 }}>{moment.attachmentCount} moments shared</div>
      <div className="anim-up d3" style={{ ...S.muted, marginTop: 16 }}>with {moment.topContact}</div>
    </div>
  )
}

function SlideGroups({ data }: { data: WrappedData }): JSX.Element {
  const g = data.groupStats[0]
  if (!g) return <div style={S.slide}><div className="anim-up d0" style={{ fontFamily: 'system-ui', fontWeight: 300, fontSize: 28, color: '#fff' }}>No group chats</div><div className="anim-up d1" style={{ ...S.muted, marginTop: 12 }}>This year was all about 1:1.</div></div>
  return (
    <div style={S.slide}>
      <div className="anim-up d0" style={S.label}>your biggest group</div>
      <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 300, fontSize: 44, color: '#fff', marginTop: 12, maxWidth: 480 }}>{g.chatName}</div>
      <div className="anim-up d2" style={{ ...S.stat, marginTop: 12 }}>{g.totalMessages.toLocaleString()} messages · {g.memberCount} members</div>
      <div className="anim-up d3" style={{ width: 360, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', gap: 1, marginTop: 24, background: '#111' }}>
        {g.yourContribution.percentOfGroup > 0 && <div style={{ width: `${g.yourContribution.percentOfGroup}%`, background: '#2EC4A0', borderRadius: 3 }} />}
        {g.members.map((m, i) => <div key={m.handle} style={{ width: `${m.percentOfGroup}%`, background: MEMBER_COLORS[i % MEMBER_COLORS.length], borderRadius: 2 }} />)}
      </div>
      <div className="anim-up d4" style={{ color: '#2EC4A0', fontSize: 14, marginTop: 12 }}>You contributed {g.yourContribution.percentOfGroup}%</div>
      <div className="anim-in d5" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
        <Crown style={{ width: 12, height: 12, color: '#fbbf24' }} /> {g.primaryContributor.displayName}
      </div>
    </div>
  )
}

function SlidePersonality({ data }: { data: WrappedData }): JSX.Element {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  return (
    <div style={S.slide}>
      <div className="anim-up d0" style={{ fontSize: 18, color: 'rgba(255,255,255,0.3)' }}>You're {/^[aeiou]/i.test(data.personality.peakHourLabel) ? 'an' : 'a'}</div>
      <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 64, color: '#fff', marginTop: 4 }}>{data.personality.peakHourLabel}</div>
      <div className="anim-up d2" style={{ fontSize: 18, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>texter</div>
      {data.personality.avgResponseTimeMinutes > 0 && (
        <div className="anim-up d3" style={{ ...S.stat, marginTop: 24 }}>Average reply: {data.personality.avgResponseTimeMinutes} min</div>
      )}
      <div className="anim-in d4" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, marginTop: 32, height: 48 }}>
        {hours.map(h => {
          const isPeak = h === data.personality.peakHour
          const dist = Math.min(Math.abs(h - data.personality.peakHour), 24 - Math.abs(h - data.personality.peakHour))
          const height = Math.max(6, 48 - dist * 5)
          return <div key={h} style={{ width: 5, height, borderRadius: '2px 2px 0 0', background: isPeak ? '#2EC4A0' : '#1a1a1a', transition: 'all 0.3s' }} />
        })}
      </div>
      <div className="anim-in d5" style={{ display: 'flex', justifyContent: 'space-between', width: 180, margin: '6px auto 0', fontSize: 9, color: 'rgba(255,255,255,0.15)' }}>
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span>
      </div>
    </div>
  )
}

function SlideMonthly({ data }: { data: WrappedData }): JSX.Element {
  const max = Math.max(...data.monthlyActivity.map(m => m.messagesSent + m.messagesReceived), 1)
  const peak = data.monthlyActivity.reduce((b, m) => (m.messagesSent + m.messagesReceived) > (b.messagesSent + b.messagesReceived) ? m : b, data.monthlyActivity[0])
  return (
    <div style={S.slide}>
      <div className="anim-up d0" style={S.label}>your loudest month</div>
      <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 72, color: '#fff', marginTop: 8 }}>{peak.month}</div>
      <div className="anim-up d2" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 20, color: '#2EC4A0', marginTop: 8 }}>{(peak.messagesSent + peak.messagesReceived).toLocaleString()} messages</div>
      <div className="anim-in d3" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, marginTop: 32, height: 120 }}>
        {data.monthlyActivity.map(m => {
          const total = m.messagesSent + m.messagesReceived
          const h = Math.max((total / max) * 100, 3)
          const isPeak = m.month === peak.month
          return (
            <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 28 }}>
              <div style={{ width: '100%', height: h, borderRadius: '3px 3px 0 0', background: isPeak ? '#fff' : '#1a1a1a' }} />
              <span style={{ fontSize: 9, color: isPeak ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)' }}>{m.month.slice(0, 3)}</span>
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
      <div style={S.slide}>
        <div className="anim-up d0" style={{ fontFamily: 'system-ui', fontWeight: 300, fontSize: 28, color: '#fff' }}>You texted across</div>
        <div className="anim-reveal d1" style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 80, color: '#2EC4A0', marginTop: 8 }}>{data.totalConversations}</div>
        <div className="anim-up d2" style={{ fontFamily: 'system-ui', fontWeight: 300, fontSize: 28, color: '#fff', marginTop: 4 }}>conversations</div>
        <div className="anim-up d3" style={{ ...S.muted, marginTop: 24, maxWidth: 400 }}>{data.narrative.personalityLine}</div>
      </div>
    )
  }
  return (
    <div style={S.slide}>
      <div className="anim-reveal d0" style={{ fontSize: 96, lineHeight: 1 }}>{data.personality.mostUsedEmoji}</div>
      <div className="anim-up d1" style={{ ...S.muted, fontSize: 16, marginTop: 20 }}>your most-used emoji this year</div>
      <div className="anim-up d2" style={{ ...S.stat, marginTop: 20, maxWidth: 400, fontStyle: 'italic' }}>{data.narrative.personalityLine}</div>
    </div>
  )
}

function SlideShare({ data }: { data: WrappedData }): JSX.Element {
  const top = data.topRelationships[0]
  const peak = data.monthlyActivity.reduce((b, m) => (m.messagesSent + m.messagesReceived) > (b.messagesSent + b.messagesReceived) ? m : b, data.monthlyActivity[0])
  return (
    <div style={S.slide}>
      <div className="anim-reveal d0" style={{
        background: '#111', borderRadius: 20, padding: '48px 40px', maxWidth: 400, width: '100%',
        border: '1px solid rgba(46,196,160,0.12)', boxShadow: '0 0 60px rgba(46,196,160,0.04)'
      }}>
        <div style={{ fontFamily: 'system-ui', fontWeight: 200, fontSize: 28, color: '#fff', marginBottom: 32 }}>Your {data.year}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {[
            { label: 'Messages', value: (data.totalMessagesSent + data.totalMessagesReceived).toLocaleString() },
            { label: 'Top contact', value: top?.displayName || '\u2014' },
            { label: 'Longest streak', value: `${top?.longestStreakDays || 0} days` },
            { label: 'Peak month', value: peak.month },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'left' }}>
              <div style={{ ...S.label, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: 'system-ui', fontWeight: 300, fontSize: 18, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ ...S.tealLine, marginTop: 28, width: 24 }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', marginTop: 16, letterSpacing: '0.15em' }}>STASH · WRAPPED</div>
      </div>
      <div className="anim-up d2" style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 20 }}>Share card coming soon</div>
    </div>
  )
}
