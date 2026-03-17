import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import type { Stats, ChatNameEntry } from '../types'

interface ConversationStats {
  firstMessageDate: string | null; longestStreakDays: number; mostActiveMonth: string | null
  mostActiveDayOfWeek: string | null; avgMessagesPerDay: number; peakHour: number | null
  avgResponseTimeMinutes: number | null; sharedGroupCount: number
  relationshipArc: 'new' | 'growing' | 'fading' | 'rekindled' | 'steady' | null
  primaryContributor: { displayName: string; messageCount: number; percent: number } | null
  quietestMember: { displayName: string; messageCount: number } | null
  yourContributionPercent: number | null; memberCount: number
}

const arcEmoji: Record<string, string> = { new: '✨', growing: '📈', fading: '📉', rekindled: '🔄', steady: '⚖️' }
const arcLabel: Record<string, string> = { new: 'New connection', growing: 'Growing stronger', fading: 'Fading', rekindled: 'Rekindled', steady: 'Rock solid' }
const arcSentence = (arc: string, name: string): string => ({
  new: `${name} is new to your world. Early days.`,
  growing: `You and ${name} have been talking more than ever. Something's building.`,
  fading: `Less and less. You two used to talk more.`,
  rekindled: `You found your way back to each other.`,
  steady: `Consistent. Always there. The quiet ones are the keepers.`
}[arc] || '')
function formatHour(h: number): string { return `${h % 12 || 12}:00 ${h >= 12 ? 'PM' : 'AM'}` }

type InsightSurface = 'relationship' | 'personal' | 'usage' | 'conversational'

interface Props {
  stats: Stats
  chatNameMap: Record<string, string>
  onSelectConversation: (rawName: string) => void
  dateRange?: string
  scopedPerson?: string | null
  onClearScope?: () => void
  insightSurface?: InsightSurface
  onSurfaceChange?: (s: InsightSurface) => void
  isStatsLoading?: boolean
}

function heroTitle(range: string): string {
  const month = MONTH_NAMES[new Date().getMonth()]
  const year = new Date().getFullYear()
  if (/^\d{4}$/.test(range)) return `${range}.`
  if (/^\d{4}-\d{2}$/.test(range)) {
    const [y, m] = range.split('-').map(Number)
    return `${MONTH_NAMES[m - 1]} ${y}.`
  }
  switch (range) {
    case 'month': return `${month}.`
    case 'year': return `${year}.`
    case '7days': return 'Last 7 days.'
    case '30days': return 'Last 30 days.'
    default: return 'All time.'
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function resolveName(raw: string, map: Record<string, string>): string {
  const n = map[raw] || raw
  return n.startsWith('#') ? 'Group chat' : n
}

function TileLabel({ text }: { text: string }): JSX.Element {
  return <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6f6a65', marginBottom: 14 }}>{text}</div>
}

function Metric({ value, sub }: { value: string; sub: string }): JSX.Element {
  return (
    <>
      <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 32, letterSpacing: '0.01em', color: '#E8604A', marginBottom: 6 }}>{value}</div>
      <div style={{ color: '#6f6a65', fontSize: 14, lineHeight: 1.6 }}>{sub}</div>
    </>
  )
}

function CtaPill({ text, onClick }: { text: string; onClick?: () => void }): JSX.Element {
  return (
    <button onClick={onClick} style={{
      marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 10,
      borderRadius: 999, background: 'rgba(232,96,74,0.1)', color: '#E8604A',
      padding: '10px 14px', fontSize: 13, border: '1px solid rgba(232,96,74,0.18)', cursor: 'pointer'
    }}>{text}</button>
  )
}

function BarTrack({ pct }: { pct: number }): JSX.Element {
  return (
    <div style={{ height: 10, background: '#efe7e1', borderRadius: 999, marginTop: 12, overflow: 'hidden' }}>
      <div style={{ height: '100%', background: 'linear-gradient(90deg, #f08f7b, #E8604A)', borderRadius: 999, width: `${Math.min(pct, 100)}%`, transition: 'width 0.5s' }} />
    </div>
  )
}

function LeaderRow({ rank, name, sub, value }: { rank: number; name: string; sub: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      <span style={{ width: 24, fontSize: 14, color: '#6f6a65', fontWeight: 500 }}>{rank}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: '#272420', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 12, color: '#9a948f', marginTop: 3 }}>{sub}</div>
      </div>
      <div style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 16, color: '#E8604A', whiteSpace: 'nowrap', marginLeft: 12 }}>{value}</div>
    </div>
  )
}

function ComingSoonTile({ label, span }: { label: string; span: number }): JSX.Element {
  return (
    <div style={{ ...tileBase, gridColumn: `span ${span}`, opacity: 0.45, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
      <TileLabel text={label} />
      <Lock style={{ width: 20, height: 20, color: '#c8b8ad', marginBottom: 8 }} />
      <div style={{ color: '#c8b8ad', fontSize: 12 }}>Coming soon</div>
    </div>
  )
}

const tileBase: React.CSSProperties = {
  background: 'white',
  border: '1px solid rgba(0,0,0,0.06)',
  borderRadius: 22,
  padding: '20px 20px 18px',
  boxShadow: '0 10px 30px rgba(0,0,0,0.05)'
}

// ─── Warming placeholder ───
function WarmingCard({ span }: { span: number }): JSX.Element {
  return (
    <div style={{
      gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px',
      background: '#fff', border: '1px solid rgba(0,0,0,0.06)', minHeight: 120,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8,
      overflow: 'hidden', position: 'relative'
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(232,96,74,0.04) 50%, transparent 100%)',
        animation: 'shimmer 2s ease-in-out infinite', backgroundSize: '200% 100%'
      }} />
      <div style={{ width: '40%', height: 8, borderRadius: 4, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ width: '70%', height: 20, borderRadius: 4, background: 'rgba(0,0,0,0.06)' }} />
      <div style={{ width: '90%', height: 10, borderRadius: 4, background: 'rgba(0,0,0,0.04)' }} />
    </div>
  )
}

// ─── ARCHETYPE 1: Poster card — giant number, dramatic scale ───
function PosterCard({ eyebrow, number, unit, descriptor, accent, bg, span }: {
  eyebrow: string; number: string; unit?: string; descriptor: string; accent: string; bg: string; span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 18, padding: '28px 28px 24px', background: bg, position: 'relative', overflow: 'hidden', minHeight: 180 }}>
      <div style={{ position: 'absolute', right: -30, bottom: -30, width: 180, height: 180, borderRadius: '50%', background: `${accent}18`, pointerEvents: 'none' }} />
      <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: `${accent}aa`, marginBottom: 16, fontFamily: "'DM Sans'" }}>{eyebrow}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 52, lineHeight: 1, color: accent }}>{number}</div>
        {unit && <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 20, color: `${accent}88` }}>{unit}</div>}
      </div>
      <div style={{ fontSize: 13, color: bg === '#fff' || bg === '#F8F4F0' ? '#4a4542' : 'rgba(255,255,255,0.6)', lineHeight: 1.55, maxWidth: 260, fontFamily: "'DM Sans'" }}>{descriptor}</div>
    </div>
  )
}

// ─── ARCHETYPE 2: Split comparison — two sides in tension ───
function SplitCard({ eyebrow, leftValue, leftLabel, leftSub, rightValue, rightLabel, rightSub, leftPct, accent, span }: {
  eyebrow: string; leftValue: string; leftLabel: string; leftSub: string;
  rightValue: string; rightLabel: string; rightSub: string;
  leftPct: number; accent: string; span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 16, fontFamily: "'DM Sans'" }}>{eyebrow}</div>
      <div style={{ display: 'flex', gap: 1, borderRadius: 4, overflow: 'hidden', marginBottom: 16, height: 5 }}>
        <div style={{ flex: leftPct, background: accent }} />
        <div style={{ flex: 100 - leftPct, background: '#EAE5DF' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: accent, lineHeight: 1, marginBottom: 4 }}>{leftValue}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', marginBottom: 2, fontFamily: "'DM Sans'" }}>{leftLabel}</div>
          <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>{leftSub}</div>
        </div>
        <div style={{ borderLeft: '1px solid #EAE5DF', paddingLeft: 16 }}>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: '#C8C0BA', lineHeight: 1, marginBottom: 4 }}>{rightValue}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6f6a65', marginBottom: 2, fontFamily: "'DM Sans'" }}>{rightLabel}</div>
          <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>{rightSub}</div>
        </div>
      </div>
    </div>
  )
}

// ─── ARCHETYPE 3: Named winner — trophy/award feel ───
function WinnerCard({ award, name, stat, flavor, emoji, accentColor, span }: {
  award: string; name: string; stat: string; flavor: string; emoji: string; accentColor: string; span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', borderTop: `3px solid ${accentColor}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: `${accentColor}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: accentColor, marginBottom: 5, fontFamily: "'DM Sans'", fontWeight: 600 }}>{award}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1A1A1A', marginBottom: 3, lineHeight: 1.3, fontFamily: "'DM Sans'" }}>{name}</div>
          <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 2, fontFamily: "'DM Sans'" }}>{stat}</div>
          <div style={{ fontSize: 11, color: '#9a948f', fontStyle: 'italic', fontFamily: "'DM Sans'" }}>{flavor}</div>
        </div>
      </div>
    </div>
  )
}

// ─── ARCHETYPE 4: Story card — editorial, implies meaning ───
function EditorialCard({ kicker, headline, subtext, accent, span }: {
  kicker: string; headline: string; subtext: string; accent: string; span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '22px 24px', background: '#F8F4F0', border: '1px solid rgba(0,0,0,0.04)', borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: accent, marginBottom: 10, fontFamily: "'DM Sans'", fontWeight: 600 }}>{kicker}</div>
      <div style={{ fontSize: 16, fontWeight: 500, color: '#1A1A1A', lineHeight: 1.45, marginBottom: 8, fontFamily: "'DM Sans'" }}>{headline}</div>
      <div style={{ fontSize: 12, color: '#8a8480', lineHeight: 1.55, fontFamily: "'DM Sans'" }}>{subtext}</div>
    </div>
  )
}

// ─── ARCHETYPE 5: Segmented band — categories as proportion ───
function BandCard({ title, subtitle, segments, span }: {
  title: string; subtitle: string;
  segments: { label: string; pct: number; count: string; color: string }[];
  span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ marginBottom: 4, fontFamily: "'DM Sans'" }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#6f6a65', marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', gap: 2, borderRadius: 6, overflow: 'hidden', margin: '14px 0', height: 10 }}>
        {segments.map(s => (
          <div key={s.label} style={{ flex: s.pct, background: s.color, minWidth: s.pct > 0 ? 4 : 0, transition: 'flex 0.4s' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${segments.length}, 1fr)`, gap: 10 }}>
        {segments.map(s => (
          <div key={s.label}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, marginBottom: 5 }} />
            <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 15, color: s.color, lineHeight: 1 }}>{s.pct}%</div>
            <div style={{ fontSize: 10, color: '#9a948f', marginTop: 3, fontFamily: "'DM Sans'" }}>{s.label}</div>
            <div style={{ fontSize: 10, color: '#b8b2ad', fontFamily: "'DM Sans'" }}>{s.count}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Dashboard({ stats, chatNameMap, onSelectConversation, dateRange = 'all', scopedPerson, onClearScope, insightSurface = 'relationship', onSurfaceChange, isStatsLoading }: Props): JSX.Element {
  const currentMonth = MONTH_NAMES[new Date().getMonth()]
  const heroText = heroTitle(dateRange)
  const chats = stats.chatNames as ChatNameEntry[]

  const individuals = chats.filter((c) => !c.isGroup && (c.sentCount + c.receivedCount) > 0)
  const groups = chats.filter((c) => c.isGroup)

  // Sorted lists — individuals only for person-level tiles
  const byLaughsGenerated = [...individuals].sort((a, b) => b.laughsGenerated - a.laughsGenerated)
  const byLaughsReceived = [...individuals].sort((a, b) => b.laughsReceived - a.laughsReceived)
  const byMessages = [...chats].sort((a, b) => b.messageCount - a.messageCount) // all for most active
  const byAttachments = [...chats].sort((a, b) => b.attachmentCount - a.attachmentCount)
  const byInitiation = [...individuals].sort((a, b) => b.initiationCount - a.initiationCount)
  const topGroup = [...groups].sort((a, b) => b.messageCount - a.messageCount)[0]

  const topFunny = byLaughsReceived[0]
  const topChat = byMessages[0]
  const topAttach = byAttachments[0]
  const topChatName = topChat ? resolveName(topChat.rawName, chatNameMap) : '—'

  // Initiation percentage (approximate)
  const totalSent = chats.reduce((s, c) => s + c.sentCount, 0)
  const totalInitiation = chats.reduce((s, c) => s + c.initiationCount, 0)
  const initiationPct = totalSent > 0 ? Math.min(Math.round((totalInitiation / totalSent) * 100), 100) : 0

  // Load per-conversation rich stats
  const [convStats, setConvStats] = useState<ConversationStats | null>(null)
  useEffect(() => {
    if (scopedPerson) {
      const pd2 = chats.find((c) => c.rawName === scopedPerson)
      window.api.getConversationStats(scopedPerson, pd2?.isGroup ?? false).then((s) => setConvStats(s as ConversationStats))
    } else setConvStats(null)
  }, [scopedPerson])

  // ── Relationship view ──
  if (scopedPerson) {
    const pn = resolveName(scopedPerson, chatNameMap)
    const pd = chats.find((c) => c.rawName === scopedPerson)
    const isGroupChat = pd?.isGroup ?? false
    const firstName = isGroupChat ? pn : pn.split(' ')[0]
    const dateLabel = dateRange === 'all' ? 'All time' : dateRange === 'month' ? 'This month' : dateRange === 'year' ? 'This year' : dateRange === '30days' ? 'Last 30 days' : 'Last 7 days'
    const initPct = pd ? Math.min(99, Math.round((pd.initiationCount / Math.max(pd.messageCount * 0.1, 1)) * 100)) : 0
    const sentPct = pd ? Math.round((pd.sentCount / Math.max(pd.messageCount, 1)) * 100) : 50

    const trophies: { emoji: string; label: string; sublabel: string }[] = []
    if (pd) {
      if (byMessages[0]?.rawName === pd.rawName)
        trophies.push({ emoji: '👑', label: '#1 Most Messaged', sublabel: 'Your most texted person' })
      if (byLaughsReceived[0]?.rawName === pd.rawName && pd.laughsReceived > 0)
        trophies.push({ emoji: '😂', label: 'Chief Comedian', sublabel: 'Makes you laugh most' })
      if (byLaughsGenerated[0]?.rawName === pd.rawName && pd.laughsGenerated > 0)
        trophies.push({ emoji: '🎭', label: 'Best Audience', sublabel: 'Laughs at everything you say' })
      if (byAttachments[0]?.rawName === pd.rawName && pd.attachmentCount > 0)
        trophies.push({ emoji: '📸', label: 'Photo Dumper', sublabel: 'Most files shared' })
      if (pd.initiationCount > 0) {
        const initPctVal = Math.round((pd.initiationCount / Math.max(pd.sentCount, 1)) * 100)
        if (initPctVal >= 70)
          trophies.push({ emoji: '⚡', label: 'Always Initiates', sublabel: 'You keep this alive' })
      }
      const topNightOwl = [...individuals].sort((a, b) => b.lateNightRatio - a.lateNightRatio)[0]
      if (topNightOwl?.rawName === pd.rawName && pd.lateNightRatio > 20)
        trophies.push({ emoji: '🌙', label: 'Night Owl', sublabel: 'Your latest-night connection' })
      const fastestResponder = [...individuals].filter(c => c.avgReplyMinutes > 0).sort((a, b) => a.avgReplyMinutes - b.avgReplyMinutes)[0]
      if (fastestResponder?.rawName === pd.rawName)
        trophies.push({ emoji: '⚡', label: 'Fastest Responder', sublabel: 'You reply fastest to them' })
      const daysSince = pd.lastMessageDate ? Math.floor((Date.now() - new Date(pd.lastMessageDate).getTime()) / 86400000) : 0
      if (pd.messageCount > 200 && daysSince > 60)
        trophies.push({ emoji: '👻', label: 'The Ghost', sublabel: `${daysSince} days of silence` })
      if (convStats?.firstMessageDate) {
        const earliestChat = [...individuals].filter(c => c.lastMessageDate).sort((a, b) =>
          new Date(a.lastMessageDate).getTime() - new Date(b.lastMessageDate).getTime()
        )[0]
        if (earliestChat?.rawName === pd.rawName)
          trophies.push({ emoji: '🏛', label: 'Longest Standing', sublabel: 'Known you the longest' })
      }
    }

    const RelCard = ({ emoji, title, metric, sentence, flavor, span }: { emoji: string; title: string; metric: string; sentence: string; flavor: string; span: number }): JSX.Element => (
      <div style={{ ...tileBase, gridColumn: `span ${span}` }}>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontWeight: 600 }}>{emoji} {title}</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: '#2EC4A0', marginBottom: 6, lineHeight: 1.2 }}>{metric}</div>
        <div style={{ fontSize: 14, color: '#1A1A1A', marginBottom: 4, fontWeight: 500 }}>{sentence}</div>
        <div style={{ fontSize: 12, color: '#9a948f', fontStyle: 'italic' }}>{flavor}</div>
      </div>
    )

    const SoonCard = ({ emoji, title, span }: { emoji: string; title: string; span: number }): JSX.Element => (
      <div style={{ ...tileBase, gridColumn: `span ${span}`, opacity: 0.5, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 140 }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>{emoji}</div>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#2EC4A0' }}>Coming soon</div>
      </div>
    )

    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 40px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
            <div><span style={{ fontSize: 18, color: '#1A1A1A', fontWeight: 500 }}>{pn}</span><span style={{ fontSize: 12, color: '#9a948f', marginLeft: 10 }}>{dateLabel}</span></div>
            <span style={{ color: '#9a948f', letterSpacing: '0.2em', fontSize: 20 }}>•••</span>
          </div>

          <div style={{ background: '#1E2826', borderRadius: 22, padding: 28, marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', right: -80, bottom: -120, width: 320, height: 320, background: 'radial-gradient(circle, rgba(46,196,160,0.18) 0%, transparent 62%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(46,196,160,0.7)', marginBottom: 12 }}>THE DYNAMIC</div>
              <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: 'white', letterSpacing: '0.02em', marginBottom: 10 }}>{isGroupChat ? `${pn}.` : `The ${firstName} Files.`}</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.68)', lineHeight: 1.7 }}>
                {pd ? `${pd.messageCount.toLocaleString()} messages exchanged. ${pd.attachmentCount.toLocaleString()} attachments shared.` : ''}
              </div>
              {pd?.lastMessageDate && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                  {(() => {
                    const days = Math.floor((new Date().getTime() - new Date(pd.lastMessageDate).getTime()) / 86400000)
                    if (days === 0) return 'Last message today'
                    if (days === 1) return 'Last message yesterday'
                    if (days < 30) return `Last message ${days} days ago`
                    if (days < 365) return `Last message ${Math.floor(days / 30)} months ago`
                    return `Last message ${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? 's' : ''} ago`
                  })()}
                </div>
              )}
            </div>
          </div>

          {!isStatsLoading && trophies.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 10 }}>Trophies</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {trophies.map(t => (
                  <div key={t.label} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: '#fff', border: '1px solid rgba(0,0,0,0.07)',
                    borderRadius: 12, padding: '8px 12px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
                  }}>
                    <span style={{ fontSize: 18 }}>{t.emoji}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.2 }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: '#9a948f', marginTop: 1 }}>{t.sublabel}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isGroupChat ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24 }}>
              <RelCard emoji="📎" title="The archive" span={4}
                metric={pd ? pd.attachmentCount.toLocaleString() : '—'}
                sentence="Things shared in this chat."
                flavor="Photos, screenshots, and files." />
              <RelCard emoji="💬" title="Messages" span={4}
                metric={pd ? pd.messageCount.toLocaleString() : '—'}
                sentence="Total messages in this group."
                flavor="Every conversation counts." />
              <RelCard emoji="⚡" title="You initiate" span={4}
                metric={`${initPct}%`}
                sentence={`You started ${initPct}% of conversations.`}
                flavor={initPct > 50 ? 'You keep this group alive.' : 'Others start most threads.'} />
              <RelCard emoji="📊" title="Message balance" span={6}
                metric={`${sentPct}%`}
                sentence={pd && pd.sentCount > pd.receivedCount ? 'You send more than you receive.' : 'You receive more than you send.'}
                flavor="Your share of the conversation." />
              {/* Enriched group stats */}
              {convStats?.primaryContributor && (
                <RelCard emoji="🏆" title="Most Active Member" span={4}
                  metric={convStats.primaryContributor.displayName}
                  sentence={`${convStats.primaryContributor.percent}% of messages in this chat.`}
                  flavor="" />
              )}
              {convStats?.yourContributionPercent !== null && convStats?.yourContributionPercent !== undefined && (
                <RelCard emoji="💬" title="Your Share" span={4}
                  metric={`${convStats.yourContributionPercent}%`}
                  sentence="of messages in this group are from you."
                  flavor={convStats.yourContributionPercent > 40 ? 'You carry this chat.' : convStats.yourContributionPercent < 10 ? 'Mostly a lurker.' : ''} />
              )}
              {convStats?.mostActiveDayOfWeek && (
                <RelCard emoji="📅" title="Peak Day" span={4}
                  metric={convStats.mostActiveDayOfWeek}
                  sentence="When this group is most active."
                  flavor="" />
              )}
              {convStats && convStats.longestStreakDays > 0 && (
                <RelCard emoji="🔥" title="Longest Streak" span={6}
                  metric={`${convStats.longestStreakDays} days`}
                  sentence="Longest run of consecutive daily activity."
                  flavor="" />
              )}
              <SoonCard emoji="😂" title="Meme density" span={6} />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>
              {pd && <>
                <WinnerCard award="Comedy advantage" name={pd.laughsReceived > pd.laughsGenerated ? 'You win' : `${firstName} wins`}
                  stat={`You got ${pd.laughsGenerated.toLocaleString()} laughs out of them`}
                  flavor={pd.laughsReceived > pd.laughsGenerated ? 'You win. They have no defense against you.' : 'They get you every time. Keep them close.'}
                  emoji="🎭" accentColor="#2EC4A0" span={4} />
                <WinnerCard award="Your comedian" name={firstName}
                  stat={`${pd.laughsReceived.toLocaleString()} times they've made you laugh`}
                  flavor={pd.laughsReceived > 500 ? "That's not funny, that's a gift." : 'They know exactly how to get you.'}
                  emoji="😂" accentColor="#2EC4A0" span={4} />
                <SplitCard eyebrow="Who reaches first"
                  leftValue={`${initPct}%`} leftLabel="You initiate"
                  leftSub={initPct > 60 ? 'You keep this alive.' : initPct < 30 ? 'You wait for them.' : 'You share it.'}
                  rightValue={`${100 - initPct}%`} rightLabel={firstName}
                  rightSub={initPct > 60 ? 'They show up when you call.' : initPct < 30 ? 'They drive this.' : 'Pretty even.'}
                  leftPct={initPct} accent="#2EC4A0" span={4} />
                <SplitCard eyebrow="Message balance"
                  leftValue={`${sentPct}%`} leftLabel="You"
                  leftSub={sentPct > 55 ? 'You talk more.' : sentPct < 45 ? 'You listen more.' : 'Even split.'}
                  rightValue={`${100 - sentPct}%`} rightLabel={firstName}
                  rightSub={sentPct > 55 ? 'They mostly listen.' : sentPct < 45 ? 'They carry it.' : 'Balanced.'}
                  leftPct={sentPct} accent="#2EC4A0" span={6} />
                <RelCard emoji="📸" title="The Archive" span={6}
                  metric={pd.attachmentCount.toLocaleString()}
                  sentence={`${pd.attachmentCount.toLocaleString()} things shared between you.`}
                  flavor="Photos, memes, evidence." />
              </>}
              {/* Enriched stats from getConversationStats */}
              {convStats?.relationshipArc && (
                <EditorialCard kicker={`${arcLabel[convStats.relationshipArc] || 'Steady'} ${arcEmoji[convStats.relationshipArc] || ''}`}
                  headline={arcSentence(convStats.relationshipArc, firstName)}
                  subtext={convStats.relationshipArc === 'fading' ? 'You used to talk more. Something shifted.' : convStats.relationshipArc === 'growing' ? 'Something is building here.' : convStats.relationshipArc === 'rekindled' ? 'You found your way back.' : ''}
                  accent="#2EC4A0" span={4} />
              )}
              {convStats && convStats.longestStreakDays > 0 && (
                <PosterCard eyebrow="Longest streak" number={`${convStats.longestStreakDays}`} unit="days"
                  descriptor={convStats.longestStreakDays > 60 ? `${convStats.longestStreakDays} days straight. What were you two even talking about?` : 'Your longest run of consecutive daily messages.'}
                  accent="#2EC4A0" bg="#F8F4F0" span={4} />
              )}
              {convStats?.peakHour !== null && convStats?.peakHour !== undefined && (
                <RelCard emoji="🕐" title="Your Peak Hour" span={4}
                  metric={formatHour(convStats.peakHour)}
                  sentence="When most of your messages happen."
                  flavor="" />
              )}
              {convStats?.firstMessageDate && (() => {
                const years = Math.floor((Date.now() - new Date(convStats.firstMessageDate!).getTime()) / (86400000 * 365))
                return <PosterCard eyebrow={`Since ${new Date(convStats.firstMessageDate!).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                  number={years > 0 ? `${years}` : '<1'} unit={years === 1 ? 'year' : 'years'}
                  descriptor={years >= 5 ? "That's not a contact, that's a constant." : years >= 2 ? `${years} years and counting.` : `Still early days with ${firstName}.`}
                  accent="#2EC4A0" bg="#F8F4F0" span={4} />
              })()}
              {convStats?.avgResponseTimeMinutes !== null && convStats?.avgResponseTimeMinutes !== undefined && (
                <EditorialCard kicker="Reply speed"
                  headline={convStats.avgResponseTimeMinutes < 2 ? "You're basically always there." : convStats.avgResponseTimeMinutes < 10 ? `${convStats.avgResponseTimeMinutes} min. Quick — they know you're paying attention.` : convStats.avgResponseTimeMinutes < 60 ? `${convStats.avgResponseTimeMinutes} min. Unhurried.` : `${convStats.avgResponseTimeMinutes} min. You make them wait for it.`}
                  subtext={`Your average reply time with ${firstName}.`}
                  accent="#2EC4A0" span={4} />
              )}
              {pd && pd.lateNightRatio > 0 ? (
                <EditorialCard kicker="Night owl connection"
                  headline={`${pd.lateNightRatio}% of your messages happen after 11pm.`}
                  subtext={pd.lateNightRatio > 40 ? 'This is a late-night relationship. Some things only come alive after midnight.' : 'Mostly daytime — but you have your late-night moments.'}
                  accent="#7F77DD" span={4} />
              ) : <SoonCard emoji="🌙" title="Night Owls" span={4} />}
              {convStats?.sharedGroupCount !== undefined && convStats.sharedGroupCount > 0 && (
                <RelCard emoji="👥" title="In common" span={4}
                  metric={`${convStats.sharedGroupCount} group${convStats.sharedGroupCount > 1 ? 's' : ''}`}
                  sentence={`You share ${convStats.sharedGroupCount} group chat${convStats.sharedGroupCount > 1 ? 's' : ''} with ${firstName}.`}
                  flavor={convStats.sharedGroupCount > 3 ? "You're everywhere together." : 'You have shared turf.'} />
              )}
              {convStats?.mostActiveMonth && (
                <RelCard emoji="📆" title="Peak month" span={4}
                  metric={convStats.mostActiveMonth}
                  sentence="Your most active month together."
                  flavor="Something was happening." />
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const laughLabels = ['Funniest friend', 'Closest behind', 'Group chat chaos']

  const earliestYear = chats.length > 0
    ? Math.min(...chats.filter(c => c.lastMessageDate).map(c => new Date(c.lastMessageDate).getFullYear()))
    : 2019

  const pillBar = !scopedPerson && onSurfaceChange && (
    <div style={{
      display: 'flex', gap: 2, marginBottom: 28, marginTop: 4,
      background: 'rgba(0,0,0,0.05)', borderRadius: 14, padding: 4
    }}>
      {([
        { id: 'relationship' as const, label: 'Relationship', color: '#2EC4A0', meta: `${individuals.length} contacts` },
        { id: 'personal' as const, label: 'Personal', color: '#E8604A', meta: '8 insights' },
        { id: 'usage' as const, label: 'Usage', color: '#7F77DD', meta: `since ${earliestYear}` },
        { id: 'conversational' as const, label: 'Conversational', color: '#888780', meta: 'AI · V2' },
      ]).map(({ id, label, color, meta }) => (
        <button key={id} onClick={() => onSurfaceChange(id)}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: 'none',
            background: insightSurface === id ? '#fff' : 'transparent',
            boxShadow: insightSurface === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.15s', fontFamily: "'DM Sans'"
          }}>
          <span style={{
            fontSize: 13, fontWeight: 500, lineHeight: 1.3,
            color: insightSurface === id ? color : '#8a8480'
          }}>{label}</span>
          <span style={{
            fontSize: 10, color: insightSurface === id ? '#9a948f' : '#b8b2ad',
            marginTop: 2
          }}>{meta}</span>
        </button>
      ))}
    </div>
  )

  // ── Personal Insights Surface ──
  const personalSurface = (
    <div>
      <div style={{ background: '#26211d', borderRadius: 18, padding: '28px 32px', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -80, top: -80, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,96,74,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(232,96,74,0.65)', marginBottom: 12, fontFamily: "'DM Sans'" }}>Personal insights</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 24, color: '#fff', marginBottom: 8, lineHeight: 1.3 }}>What your habits say about you.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, maxWidth: 420, fontFamily: "'DM Sans'" }}>Patterns in how, when, and who you communicate with — without reading a single message.</div>
        {dateRange !== 'all' && (
          <div style={{ fontSize: 11, color: 'rgba(232,96,74,0.45)', marginTop: 8, fontFamily: "'DM Sans'", letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {/^\d{4}$/.test(dateRange) ? dateRange
              : /^\d{4}-\d{2}$/.test(dateRange) ? (() => { const [y,m] = dateRange.split('-').map(Number); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1] + ' ' + y })()
              : dateRange === 'month' ? new Date().toLocaleString('en-US', {month:'long'})
              : dateRange === 'year' ? String(new Date().getFullYear())
              : dateRange === '30days' ? 'Last 30 days'
              : 'Last 7 days'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>
        {/* Row 1: Two asymmetric poster cards */}
        {(() => {
          const groupMessages = groups.reduce((s, c) => s + c.messageCount, 0)
          const totalMsgs = chats.reduce((s, c) => s + c.messageCount, 0)
          const groupPct = totalMsgs > 0 ? Math.round((groupMessages / totalMsgs) * 100) : 0
          const isGroupPerson = groupPct > 50
          return (
            <PosterCard
              eyebrow="Your messaging identity"
              number={isGroupPerson ? `${groupPct}%` : `${100 - groupPct}%`}
              unit={isGroupPerson ? 'groups' : 'one-on-one'}
              descriptor={isGroupPerson
                ? 'You live in the group chat. The noise is where you\'re comfortable.'
                : 'You prefer depth over breadth. One-on-one conversations dominate your messaging life.'}
              accent="#E8604A" bg="#26211d" span={7}
            />
          )
        })()}
        {(() => {
          const top3Messages = byMessages.slice(0, 3).reduce((s, c) => s + c.messageCount, 0)
          const totalMessages = chats.reduce((s, c) => s + c.messageCount, 0)
          const concentration = totalMessages > 0 ? Math.round((top3Messages / totalMessages) * 100) : 0
          return (
            <PosterCard
              eyebrow="Your inner circle"
              number={`${concentration}%`}
              descriptor={concentration > 60
                ? 'of your messages go to just 3 people. You run deep, not wide.'
                : concentration > 40
                ? 'to your top 3 contacts. Fairly concentrated.'
                : 'to your top 3. You spread it around more than most.'}
              accent="#E8604A" bg="#F8F4F0" span={5}
            />
          )
        })()}

        {/* Row 2: Split comparison + winner cards */}
        <SplitCard
          eyebrow="Conversation dynamics"
          leftValue={`${initiationPct}%`} leftLabel="You initiate"
          leftSub={initiationPct > 60 ? 'You keep things alive.' : initiationPct < 40 ? 'They reach out more.' : 'You share the load.'}
          rightValue={`${100 - initiationPct}%`} rightLabel="They initiate"
          rightSub={initiationPct > 60 ? 'They wait for you.' : initiationPct < 40 ? 'They drive this.' : 'Pretty even split.'}
          leftPct={initiationPct} accent="#E8604A" span={5}
        />
        {isStatsLoading ? <WarmingCard span={4} /> : (
          byLaughsGenerated[0] && byLaughsGenerated[0].laughsGenerated > 0 ? (
            <WinnerCard award="Best audience" name={resolveName(byLaughsGenerated[0].rawName, chatNameMap)}
              stat={`${byLaughsGenerated[0].laughsGenerated.toLocaleString()} laughs`}
              flavor="Laughs at everything you say — your best audience globally."
              emoji="😂" accentColor="#E8604A" span={4} />
          ) : <div style={{ gridColumn: 'span 4' }} />
        )}
        {isStatsLoading ? <WarmingCard span={3} /> : (
          byLaughsReceived[0] && byLaughsReceived[0].laughsReceived > 0 && (
            <WinnerCard award="Makes you laugh most" name={resolveName(byLaughsReceived[0].rawName, chatNameMap)}
              stat={`${byLaughsReceived[0].laughsReceived.toLocaleString()} times`}
              flavor="They get you more than anyone else."
              emoji="🤣" accentColor="#2EC4A0" span={3} />
          )
        )}

        {/* Row 3: Editorial story cards + winner */}
        {(() => {
          const gone = [...individuals].filter(c => c.messageCount > 50)
            .map(c => ({ ...c, days: Math.floor((Date.now() - new Date(c.lastMessageDate).getTime()) / 86400000) }))
            .filter(c => c.days > 30).sort((a, b) => b.days - a.days)[0]
          return gone ? (
            <EditorialCard kicker="Gone quiet"
              headline={`${resolveName(gone.rawName, chatNameMap)}. ${gone.days} days of silence.`}
              subtext="You used to talk a lot. Something shifted — or life just got busy."
              accent="#E8604A" span={6} />
          ) : null
        })()}
        {isStatsLoading ? <WarmingCard span={6} /> : (() => {
          const topNightOwl = [...individuals].sort((a, b) => b.lateNightRatio - a.lateNightRatio)[0]
          return topNightOwl && topNightOwl.lateNightRatio > 10 ? (
            <EditorialCard kicker="Night owl connection"
              headline={`${topNightOwl.lateNightRatio}% of your messages with ${resolveName(topNightOwl.rawName, chatNameMap)} happen after 11pm.`}
              subtext="Some relationships only really come alive after midnight."
              accent="#7F77DD" span={6} />
          ) : null
        })()}
        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const fastest = [...individuals].filter(c => c.avgReplyMinutes > 0 && c.avgReplyMinutes < 60).sort((a, b) => a.avgReplyMinutes - b.avgReplyMinutes)[0]
          return fastest ? (
            <WinnerCard award="You reply fastest to" name={resolveName(fastest.rawName, chatNameMap)}
              stat={`~${fastest.avgReplyMinutes} min average reply time`}
              flavor={fastest.avgReplyMinutes < 3 ? 'Basically always there for them.' : 'Quicker than you are with most.'}
              emoji="⚡" accentColor="#2EC4A0" span={4} />
          ) : null
        })()}
      </div>
    </div>
  )

  // ── Usage Insights Surface ──
  const usageSurface = (
    <div>
      <div style={{ background: '#1E1A2E', borderRadius: 18, padding: '28px 32px', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -80, bottom: -80, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle, rgba(127,119,221,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(127,119,221,0.65)', marginBottom: 12, fontFamily: "'DM Sans'" }}>Usage insights</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 24, color: '#fff', marginBottom: 8, lineHeight: 1.3 }}>Your messaging, by the numbers.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, maxWidth: 420, fontFamily: "'DM Sans'" }}>The full picture of your iMessage activity — volume, attachments, and patterns across time.</div>
        {dateRange !== 'all' && (
          <div style={{ fontSize: 11, color: 'rgba(127,119,221,0.45)', marginTop: 8, fontFamily: "'DM Sans'", letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {/^\d{4}$/.test(dateRange) ? dateRange
              : /^\d{4}-\d{2}$/.test(dateRange) ? (() => { const [y,m] = dateRange.split('-').map(Number); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1] + ' ' + y })()
              : dateRange === 'month' ? new Date().toLocaleString('en-US', {month:'long'})
              : dateRange === 'year' ? String(new Date().getFullYear())
              : dateRange === '30days' ? 'Last 30 days'
              : 'Last 7 days'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>
        <PosterCard eyebrow="Your archive" number={stats.total.toLocaleString()} unit="items"
          descriptor={`Across ${chats.length.toLocaleString()} conversations — ${groups.length} group chats, ${individuals.length} one-on-one.`}
          accent="#7F77DD" bg="#1E1A2E" span={12} />

        {(() => {
          const total = stats.total || 1
          const imgPct = Math.round((stats.images / total) * 100)
          const vidPct = Math.round((stats.videos / total) * 100)
          const docPct = Math.round((stats.documents / total) * 100)
          const audPct = Math.round((stats.audio / total) * 100)
          return (
            <BandCard title="What you share" subtitle="Breakdown of your indexed archive by type"
              segments={[
                { label: 'Images', pct: imgPct, count: stats.images.toLocaleString(), color: '#E8604A' },
                { label: 'Videos', pct: vidPct, count: stats.videos.toLocaleString(), color: '#2EC4A0' },
                { label: 'Docs', pct: docPct, count: stats.documents.toLocaleString(), color: '#7F77DD' },
                { label: 'Audio', pct: audPct, count: stats.audio.toLocaleString(), color: '#BA7517' },
              ]} span={12} />
          )
        })()}

        {byAttachments[0] && (
          <WinnerCard award="Most files shared" name={resolveName(byAttachments[0].rawName, chatNameMap)}
            stat={`${byAttachments[0].attachmentCount.toLocaleString()} attachments exchanged`}
            flavor="Your most media-heavy relationship." emoji="📎" accentColor="#7F77DD" span={4} />
        )}
        {isStatsLoading ? <WarmingCard span={4} /> : topGroup ? (
          <WinnerCard award="Most active group" name={resolveName(topGroup.rawName, chatNameMap)}
            stat={`${topGroup.messageCount.toLocaleString()} messages`}
            flavor="Your busiest room. The chaos lives here." emoji="🔥" accentColor="#E8604A" span={4} />
        ) : null}
        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const groupMessages = groups.reduce((s, c) => s + c.messageCount, 0)
          const totalMsgs = chats.reduce((s, c) => s + c.messageCount, 0)
          const groupPct = totalMsgs > 0 ? Math.round((groupMessages / totalMsgs) * 100) : 0
          return (
            <SplitCard eyebrow="Where your messages go"
              leftValue={`${groupPct}%`} leftLabel="Group chats" leftSub={`${groups.length} groups`}
              rightValue={`${100 - groupPct}%`} rightLabel="One-on-one" rightSub={`${individuals.length} contacts`}
              leftPct={groupPct} accent="#7F77DD" span={4} />
          )
        })()}

        <ComingSoonTile label="Activity heatmap — days × hours" span={6} />
        <ComingSoonTile label="Year-by-year timeline" span={6} />
      </div>
    </div>
  )

  // ── Conversational Insights Surface ──
  const conversationalSurface = (
    <div>
      <div style={{ background: '#1A1A1A', borderRadius: 18, padding: 24, marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(180,178,169,0.5)', marginBottom: 10 }}>Conversational insights · V2</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 22, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>What your conversations actually mean.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>Topics, summaries, recurring jokes, and memory extraction — powered by AI. Coming in V2 when message search is live.</div>
      </div>
      <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 12 }}>What's coming in V2</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['What do we talk about most?', 'What are our recurring jokes?', 'What important moments happened here?', 'Summarize this conversation', 'When are our conversations most positive?'].map(p => (
          <div key={p} style={{ background: 'rgba(0,0,0,0.03)', border: '1px dashed rgba(0,0,0,0.12)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#6f6a65', opacity: 0.6 }}>{p}</div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 40px', fontFamily: "'DM Sans', sans-serif" }}>
    <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#8a8480' }}>
          {isStatsLoading && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E8604A', display: 'inline-block', animation: 'shimmer 1.5s ease-in-out infinite', opacity: 0.7 }} />
          )}
          {isStatsLoading ? 'Warming up...' : (heroText.replace('.', '') + ' · surfaced automatically')}
        </span>
        <span style={{ color: '#9a948f', letterSpacing: '0.2em', fontSize: 20 }}>•••</span>
      </div>

      {/* Pill bar */}
      {pillBar}

      {/* Surface: Personal */}
      {insightSurface === 'personal' && personalSurface}

      {/* Surface: Usage */}
      {insightSurface === 'usage' && usageSurface}

      {/* Surface: Conversational */}
      {insightSurface === 'conversational' && conversationalSurface}

      {/* Surface: Relationship (default — existing dashboard) */}
      {insightSurface === 'relationship' && <>
      {/* Hero card */}
      <div style={{ background: '#26211d', borderRadius: 22, padding: 28, marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
        {/* Coral glow */}
        <div style={{ position: 'absolute', right: -80, bottom: -120, width: 320, height: 320, background: 'radial-gradient(circle, rgba(232,96,74,0.14) 0%, transparent 62%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)', marginBottom: 12 }}>Stash Wrap</div>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: 'white', letterSpacing: '0.02em', marginBottom: 10 }}>
            {heroText}
          </div>
          <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.68)', lineHeight: 1.7, marginBottom: 16 }}>
            {stats.total.toLocaleString()} attachments indexed across {chats.length} conversations.
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>
            {stats.total.toLocaleString()} attachments <span style={{ color: '#E8604A' }}>·</span> {topChatName}
          </div>
        </div>
      </div>

      {/* Insight tile grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24 }}>
        {/* Tile 1 — Funniest person */}
        {isStatsLoading ? <WarmingCard span={4} /> : (
          <div style={{ ...tileBase, gridColumn: 'span 4' }}>
            <TileLabel text="Funniest person" />
            {topFunny && topFunny.laughsReceived > 0 ? (
              <>
                <Metric value={resolveName(topFunny.rawName, chatNameMap)} sub={`${topFunny.laughsReceived.toLocaleString()} times they made you laugh`} />
                <CtaPill text="See why → Pro" />
              </>
            ) : <div style={{ color: '#9a948f', fontSize: 13 }}>No laugh data for this period</div>}
          </div>
        )}

        {/* Tile 2 — Initiation balance */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Initiation balance" />
          <Metric value={`${initiationPct}%`} sub={initiationPct > 60 ? 'You start most conversations. You keep things alive.' : initiationPct < 40 ? 'Others reach out to you more. You respond.' : 'Roughly balanced — you and your contacts share the load.'} />
          <BarTrack pct={initiationPct} />
        </div>

        {/* Tile 3 — Most active chat */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most active chat" />
          {topChat ? (
            <>
              <Metric value={resolveName(topChat.rawName, chatNameMap)} sub={`${topChat.messageCount.toLocaleString()} messages exchanged`} />
              <CtaPill text="Open conversation" onClick={() => onSelectConversation(topChat.rawName)} />
            </>
          ) : <div style={{ color: '#6f6a65' }}>No data yet</div>}
        </div>

        {/* Tile 4 — Who makes you laugh most (leaderboard) */}
        {isStatsLoading ? <WarmingCard span={8} /> : (
          <div style={{ ...tileBase, gridColumn: 'span 8' }}>
            <TileLabel text="Who makes you laugh most" />
            {byLaughsReceived.filter((c) => c.laughsReceived > 0).slice(0, 3).map((c, i) => (
              <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)} sub={laughLabels[i] || ''} value={`${c.laughsReceived.toLocaleString()} laughs`} />
            ))}
            {byLaughsReceived.every((c) => c.laughsReceived === 0) && <div style={{ color: '#9a948f', fontSize: 13, padding: '12px 0' }}>No laugh data for this period</div>}
            <CtaPill text="See exact messages → Pro" />
          </div>
        )}

        {/* Tile — You're funniest to */}
        <div style={{ ...tileBase, gridColumn: 'span 8' }}>
          <TileLabel text="You're funniest to" />
          {byLaughsGenerated.filter((c) => c.laughsGenerated > 0).slice(0, 3).map((c, i) => (
            <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)}
              sub={i === 0 ? 'Your best audience' : i === 1 ? 'Close second' : 'Third place'}
              value={`${c.laughsGenerated.toLocaleString()} laughs`} />
          ))}
          {byLaughsGenerated.every((c) => c.laughsGenerated === 0) && <div style={{ color: '#9a948f', fontSize: 13, padding: '12px 0' }}>No laugh data for this period</div>}
        </div>

        {/* Tile — Most one-sided */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most one-sided chat" />
          {(() => {
            const byImbalance = [...individuals].filter((c) => c.sentCount + c.receivedCount > 20)
              .map((c) => ({ ...c, ratio: c.sentCount / Math.max(c.receivedCount, 1) }))
              .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))
            const m = byImbalance[0]
            return m ? (
              <Metric value={resolveName(m.rawName, chatNameMap)}
                sub={m.ratio > 1 ? `You send ${m.ratio.toFixed(1)}× more than they reply` : `They send ${(1 / m.ratio).toFixed(1)}× more than you reply`} />
            ) : <div style={{ color: '#6f6a65' }}>Not enough data</div>
          })()}
        </div>

        {/* Tile 5 — Most attachments */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most attachments" />
          {topAttach ? (
            <Metric value={topAttach.attachmentCount.toLocaleString()} sub={`${resolveName(topAttach.rawName, chatNameMap)} sent the most photos, screenshots, and files.`} />
          ) : <div style={{ color: '#6f6a65' }}>No data yet</div>}
        </div>

        {/* Tile 6 — Night owl connection */}
        {(() => {
          const topLateNight = [...individuals]
            .filter(c => c.lateNightRatio > 0)
            .sort((a, b) => b.lateNightRatio - a.lateNightRatio)[0]
          return topLateNight ? (
            <div style={{ ...tileBase, gridColumn: 'span 4' }}>
              <TileLabel text="Night owl connection" />
              <Metric
                value={resolveName(topLateNight.rawName, chatNameMap)}
                sub={`${topLateNight.lateNightRatio}% of your messages happen after 11pm`}
              />
            </div>
          ) : <ComingSoonTile label="Night owl connection" span={4} />
        })()}

        {/* Tile 7 — Most active group */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most active group" />
          {topGroup ? (
            <Metric value={resolveName(topGroup.rawName, chatNameMap)} sub={`${topGroup.messageCount.toLocaleString()} messages exchanged`} />
          ) : <div style={{ color: '#6f6a65' }}>No group chats indexed</div>}
        </div>

        {/* Tile — Gone quiet */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Gone quiet" />
          {(() => {
            const now = new Date()
            const gq = [...individuals].filter((c) => c.messageCount > 50)
              .map((c) => ({ ...c, daysSince: Math.floor((now.getTime() - new Date(c.lastMessageDate).getTime()) / 86400000) }))
              .filter((c) => c.daysSince > 30)
              .sort((a, b) => b.daysSince - a.daysSince)[0]
            return gq ? (
              <Metric value={resolveName(gq.rawName, chatNameMap)}
                sub={`${gq.daysSince} days since your last message. You used to talk a lot.`} />
            ) : <div style={{ color: '#6f6a65' }}>Everyone's been in touch recently</div>
          })()}
        </div>

        {/* Tile — Fastest responder */}
        {(() => {
          const fastest = [...individuals]
            .filter(c => c.avgReplyMinutes > 0 && c.avgReplyMinutes < 60)
            .sort((a, b) => a.avgReplyMinutes - b.avgReplyMinutes)[0]
          return fastest ? (
            <div style={{ ...tileBase, gridColumn: 'span 4' }}>
              <TileLabel text="Fastest responder" />
              <Metric
                value={resolveName(fastest.rawName, chatNameMap)}
                sub={`Replies in ${fastest.avgReplyMinutes < 1 ? 'under a minute' : `~${fastest.avgReplyMinutes} minutes`} on average`}
              />
            </div>
          ) : <ComingSoonTile label="Fastest responder" span={4} />
        })()}

        {/* Tile 8 — Who you reach out to most (full width leaderboard) */}
        <div style={{ ...tileBase, gridColumn: 'span 12' }}>
          <TileLabel text="Who you reach out to most" />
          {byInitiation.slice(0, 3).map((c, i) => (
            <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)} sub={`${c.initiationCount.toLocaleString()} conversation starts`} value={c.initiationCount.toLocaleString()} />
          ))}
        </div>
      </div>
      </>}
    </div>
    </div>
  )
}
