import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import type { Stats, ChatNameEntry } from '../types'

type NetworkNode = { rawName: string; messageCount: number }
type NetworkEdge = { a: string; b: string; sharedGroups: number }
type NetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[] }

type MemoryItem = {
  id: number; filename: string; original_path: string; thumbnail_path: string | null;
  created_at: string; chat_name: string | null; is_image: number; is_available: number
}

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
  onDrillThrough?: (title: string, subtitle: string, freeStats: { label: string; value: string }[]) => void
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

function getVibeTag(c: ChatNameEntry): { label: string; color: string } | null {
  const total = c.messageCount
  if (total < 10) return null
  const sentPct = total > 0 ? c.sentCount / total : 0.5
  const recvPct = 1 - sentPct
  if (sentPct > 0.72 && total > 30) return { label: 'One-sided', color: '#9a948f' }
  if (recvPct > 0.72 && total > 30) return { label: 'They carry it', color: '#9a948f' }
  if (c.lateNightRatio > 40) return { label: 'Late night', color: '#7F77DD' }
  if (c.laughsReceived > 20 && c.laughsReceived / Math.max(total * 0.01, 1) > 2) return { label: 'Comedy', color: '#E8604A' }
  if (c.avgReplyMinutes > 0 && c.avgReplyMinutes < 5 && total > 100) return { label: 'Always on', color: '#2EC4A0' }
  if (c.avgReplyMinutes > 120 && total > 20) return { label: 'Slow burn', color: '#9a948f' }
  return null
}

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

// ─── ARCHETYPE 6: Spectrum card — where you fall on a scale ───
function SpectrumCard({ eyebrow, leftLabel, rightLabel, markerPct, markerLabel, descriptor, accent, span }: {
  eyebrow: string; leftLabel: string; rightLabel: string
  markerPct: number; markerLabel: string; descriptor: string
  accent: string; span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 16, fontFamily: "'DM Sans'" }}>{eyebrow}</div>
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: '#EAE5DF', marginBottom: 10 }}>
        <div style={{ position: 'absolute', left: 0, width: `${markerPct}%`, height: '100%', borderRadius: 3, background: `linear-gradient(90deg, #EAE5DF, ${accent})` }} />
        <div style={{ position: 'absolute', top: '50%', left: `${markerPct}%`, transform: 'translate(-50%, -50%)', width: 14, height: 14, borderRadius: '50%', background: accent, border: '2px solid #fff', boxShadow: `0 0 0 2px ${accent}40` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#b8b2ad', fontFamily: "'DM Sans'" }}>{leftLabel}</div>
        <div style={{ fontSize: 10, color: '#b8b2ad', fontFamily: "'DM Sans'" }}>{rightLabel}</div>
      </div>
      <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 15, color: accent, marginBottom: 4 }}>{markerLabel}</div>
      <div style={{ fontSize: 12, color: '#6f6a65', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{descriptor}</div>
    </div>
  )
}

// ─── ARCHETYPE 7: Leaderboard card — ranked list with bars ───
function LeaderboardCard({ eyebrow, items, accent, span }: {
  eyebrow: string; items: { name: string; value: string; pct: number }[]; accent: string; span: number
}): JSX.Element {
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 14, fontFamily: "'DM Sans'" }}>{eyebrow}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, i) => (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 10, color: i === 0 ? accent : '#c8c0ba', fontWeight: 600, width: 14, fontFamily: "'DM Sans'" }}>{i + 1}</div>
                <div style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? '#1A1A1A' : '#4a4542', fontFamily: "'DM Sans'" }}>{item.name}</div>
              </div>
              <div style={{ fontSize: 12, color: i === 0 ? accent : '#9a948f', fontFamily: "'DM Sans'" }}>{item.value}</div>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: '#EAE5DF', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${item.pct}%`, background: i === 0 ? accent : '#D4CFC9', borderRadius: 2, transition: 'width 0.4s' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TodayInHistoryCard({ memories, chatNameMap, onSelectConversation }: {
  memories: MemoryItem[]; chatNameMap: Record<string, string>; onSelectConversation: (rawName: string) => void
}): JSX.Element | null {
  const [index, setIndex] = useState(0)
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const current = memories[index]

  useEffect(() => {
    if (!current?.thumbnail_path) { setLoading(false); return }
    setLoading(true); setImgSrc(null)
    window.api.getFileUrl(current.thumbnail_path).then(url => { setImgSrc(url); setLoading(false) }).catch(() => setLoading(false))
  }, [current?.thumbnail_path])

  if (!current) return null

  const year = new Date(current.created_at).getFullYear()
  const yearsAgo = new Date().getFullYear() - year
  const displayName = current.chat_name
    ? (chatNameMap[current.chat_name] || current.chat_name).replace(/^#/, '').split(' ').slice(0, 2).join(' ')
    : 'a conversation'
  const monthDay = new Date(current.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  return (
    <div onClick={() => current.chat_name && onSelectConversation(current.chat_name)}
      style={{ gridColumn: 'span 12', borderRadius: 18, overflow: 'hidden', position: 'relative', cursor: 'pointer', minHeight: 260, background: '#1A1A1A', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
      {imgSrc && !loading ? (
        <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0, display: 'block' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1E2826 0%, #26211d 100%)' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.7) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 16, left: 16, background: '#E8604A', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#fff', fontFamily: "'DM Sans'" }}>{year}</div>
      {memories.length > 1 && (
        <div style={{ position: 'absolute', top: 18, right: 16, display: 'flex', gap: 5, alignItems: 'center' }}>
          {memories.map((_, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setIndex(i) }}
              style={{ width: i === index ? 16 : 6, height: 6, borderRadius: 3, border: 'none', cursor: 'pointer', background: i === index ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'all 0.2s', padding: 0 }} />
          ))}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 20px 18px', zIndex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 6, fontFamily: "'DM Sans'" }}>On this day</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 18, color: '#fff', lineHeight: 1.3, marginBottom: 4 }}>
          {yearsAgo === 1 ? 'One year ago today.' : `${yearsAgo} years ago today.`}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: "'DM Sans'" }}>{displayName} · {monthDay}, {year}</div>
      </div>
    </div>
  )
}

function LoquaciousnessCard({ myAvg, theirAvg, theirName, onShare, span }: {
  myAvg: number; theirAvg: number; theirName: string; onShare?: () => void; span: number
}): JSX.Element | null {
  if (myAvg === 0 || theirAvg === 0) return null
  const max = Math.max(myAvg, theirAvg)
  const myPct = Math.round((myAvg / max) * 100), theirPct = Math.round((theirAvg / max) * 100)
  const diff = myAvg / theirAvg
  const iVerbose = diff > 1.4, theyVerbose = diff < 0.7
  const headline = iVerbose ? "Doesn't use 9 words when 47 will do." : theyVerbose ? `${theirName} doesn't use 9 words when 47 will do.` : "Neither of you wastes words. Or saves them."
  const subtext = iVerbose ? 'But… you need the context.' : theyVerbose ? 'Every word earns its place.' : 'Balanced communicators.'
  return (
    <div style={{ gridColumn: `span ${span}`, borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', position: 'relative' }}>
      {onShare && (
        <button onClick={onShare} style={{ position: 'absolute', top: 12, right: 12, width: 26, height: 26, background: 'rgba(232,96,74,0.08)', border: '0.5px solid rgba(232,96,74,0.25)', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 1l3 3-3 3M10 4H4a3 3 0 000 6h1" stroke="#E8604A" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 14, fontFamily: "'DM Sans'" }}>Word for word</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 14 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ fontSize: 10, color: '#9a948f', fontFamily: "'DM Sans'" }}>You</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 52 }}>
            {[0.7, 0.9, 1].map((h, i) => <div key={i} style={{ width: 16, height: `${Math.round(h * (myPct / 100) * 52)}px`, background: '#E8604A', borderRadius: '3px 3px 0 0', opacity: 0.4 + i * 0.3 }} />)}
          </div>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 20, color: '#E8604A' }}>{myAvg}</div>
          <div style={{ fontSize: 10, color: '#9a948f', fontFamily: "'DM Sans'" }}>words / msg</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingBottom: 28 }}>
          <div style={{ width: 1, height: 48, background: '#EAE5DF' }} /><div style={{ fontSize: 9, color: '#c8c0ba', letterSpacing: '0.1em' }}>vs</div><div style={{ width: 1, height: 48, background: '#EAE5DF' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ fontSize: 10, color: '#9a948f', fontFamily: "'DM Sans'" }}>{theirName}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 52 }}>
            {[1, 0.9, 0.7].map((h, i) => <div key={i} style={{ width: 16, height: `${Math.round(h * (theirPct / 100) * 52)}px`, background: '#2EC4A0', borderRadius: '3px 3px 0 0', opacity: 0.4 + (2 - i) * 0.3 }} />)}
          </div>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 20, color: '#2EC4A0' }}>{theirAvg}</div>
          <div style={{ fontSize: 10, color: '#9a948f', fontFamily: "'DM Sans'" }}>words / msg</div>
        </div>
      </div>
      <div style={{ borderTop: '0.5px solid #EAE5DF', paddingTop: 12 }}>
        <div style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 500, fontFamily: "'DM Sans'", marginBottom: 2 }}>{headline}</div>
        <div style={{ fontSize: 12, color: '#9a948f', fontFamily: "'DM Sans'" }}>{subtext}</div>
      </div>
    </div>
  )
}

function ConstellationCard({ network, chatNameMap, onSelectConversation }: {
  network: NetworkData; chatNameMap: Record<string, string>; onSelectConversation: (rawName: string) => void
}): JSX.Element | null {
  const [hovered, setHovered] = useState<string | null>(null)
  if (network.nodes.length < 4) return null

  const W = 600, H = 380, CX = W / 2, CY = H / 2
  const sorted = network.nodes
  const rings = [
    { nodes: sorted.slice(0, 5), r: 85, dotSize: 7 },
    { nodes: sorted.slice(5, 14), r: 155, dotSize: 5 },
    { nodes: sorted.slice(14, 35), r: 215, dotSize: 3.5 },
  ]

  const positions = new Map<string, { x: number; y: number; size: number }>()
  for (const ring of rings) {
    ring.nodes.forEach((node, i) => {
      const angle = (i / Math.max(ring.nodes.length, 1)) * Math.PI * 2 - Math.PI / 2
      positions.set(node.rawName, { x: CX + Math.cos(angle) * ring.r, y: CY + Math.sin(angle) * ring.r, size: ring.dotSize })
    })
  }

  const edgeCounts = new Map<string, number>()
  for (const e of network.edges) {
    if (positions.has(e.a)) edgeCounts.set(e.a, (edgeCounts.get(e.a) || 0) + 1)
    if (positions.has(e.b)) edgeCounts.set(e.b, (edgeCounts.get(e.b) || 0) + 1)
  }
  const bridgeEntry = [...edgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const bridgeName = bridgeEntry?.[0]
  const visibleEdges = network.edges.filter(e => positions.has(e.a) && positions.has(e.b))

  const getName = (raw: string) => {
    const full = chatNameMap[raw] || raw
    const clean = full.replace(/^#/, '').replace(/^\+/, '').split(' ')[0]
    return clean.length > 9 ? clean.slice(0, 8) + '\u2026' : clean
  }

  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#0F0F0F', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 4px 24px rgba(0,0,0,0.2)', padding: '22px 24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(232,96,74,0.65)', marginBottom: 6, fontFamily: "'DM Sans'" }}>Your messaging network</div>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 15, color: '#fff', lineHeight: 1.4 }}>{network.nodes.length} people · {network.edges.length} shared connections.</div>
        </div>
        {bridgeName && positions.has(bridgeName) && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(232,96,74,0.45)', marginBottom: 3, fontFamily: "'DM Sans'" }}>Bridge contact</div>
            <div style={{ fontSize: 12, color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 500 }}>{getName(bridgeName)}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: "'DM Sans'" }}>appears in {edgeCounts.get(bridgeName)} of your groups</div>
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', margin: '4px 0' }}>
        {rings.map((ring, i) => <circle key={i} cx={CX} cy={CY} r={ring.r} fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={1} />)}
        {visibleEdges.map((edge, i) => {
          const a = positions.get(edge.a)!, b = positions.get(edge.b)!
          const isHot = hovered === edge.a || hovered === edge.b
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isHot ? 'rgba(232,96,74,0.55)' : 'rgba(255,255,255,0.07)'} strokeWidth={isHot ? 1.5 : 0.75} />
        })}
        <circle cx={CX} cy={CY} r={10} fill="#E8604A" />
        <circle cx={CX} cy={CY} r={17} fill="none" stroke="rgba(232,96,74,0.2)" strokeWidth={1.5} />
        <text x={CX} y={CY + 28} textAnchor="middle" style={{ fontSize: 8, fill: 'rgba(232,96,74,0.6)', fontFamily: 'DM Sans', letterSpacing: '0.12em' }}>YOU</text>
        {rings.flatMap(ring => ring.nodes.map(node => {
          const pos = positions.get(node.rawName)
          if (!pos) return null
          const isHov = hovered === node.rawName, isBridge = node.rawName === bridgeName
          const fill = isBridge ? '#E8604A' : isHov ? '#2EC4A0' : 'rgba(255,255,255,0.45)'
          const r = isHov ? pos.size + 2.5 : pos.size
          return (
            <g key={node.rawName} style={{ cursor: 'pointer' }} onMouseEnter={() => setHovered(node.rawName)} onMouseLeave={() => setHovered(null)} onClick={() => onSelectConversation(node.rawName)}>
              <circle cx={pos.x} cy={pos.y} r={Math.max(r, 12)} fill="transparent" />
              <circle cx={pos.x} cy={pos.y} r={r} fill={fill} />
              {pos.size >= 5 && <text x={pos.x} y={pos.y + r + 11} textAnchor="middle" style={{ fontSize: pos.size >= 7 ? 9 : 8, fill: isHov ? '#fff' : 'rgba(255,255,255,0.3)', fontFamily: 'DM Sans', pointerEvents: 'none' }}>{getName(node.rawName)}</text>}
              {isHov && pos.size < 5 && <text x={pos.x} y={pos.y - r - 4} textAnchor="middle" style={{ fontSize: 8, fill: '#fff', fontFamily: 'DM Sans', pointerEvents: 'none' }}>{getName(node.rawName)}</text>}
            </g>
          )
        }))}
      </svg>
      <div style={{ display: 'flex', gap: 18, paddingTop: 4 }}>
        {[{ color: 'rgba(255,255,255,0.07)', label: 'Shared group', isLine: true }, { color: '#E8604A', label: 'Bridge — most connected', isLine: false }, { color: 'rgba(255,255,255,0.4)', label: 'Inner ring = more messages', isLine: false }].map(({ color, label, isLine }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isLine ? <div style={{ width: 16, height: 1.5, background: 'rgba(255,255,255,0.25)' }} /> : <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: "'DM Sans'" }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DrillThroughPanel({ title, subtitle, freeStats, onClose }: {
  title: string; subtitle: string; freeStats: { label: string; value: string }[]; onClose: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'free' | 'pro'>('free')
  return (
    <div style={{ width: 340, background: '#FAFAF8', borderLeft: '1px solid #EAE5DF', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid #EAE5DF', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 5, fontFamily: "'DM Sans'" }}>Evidence</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#1A1A1A', lineHeight: 1.3, fontFamily: "'DM Sans'" }}>{title}</div>
            <div style={{ fontSize: 11, color: '#9a948f', marginTop: 3, fontFamily: "'DM Sans'" }}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, background: '#EAE5DF', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 12 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#6f6a65" strokeWidth="1.8" strokeLinecap="round"><path d="M1 1l8 8M9 1L1 9"/></svg>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 3, background: '#EAE5DF', borderRadius: 8, padding: 3, marginTop: 14 }}>
          {(['free', 'pro'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'", background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1A1A1A' : '#9a948f', fontWeight: tab === t ? 500 : 400 }}>{t === 'free' ? 'Overview' : 'Pro'}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'free' ? (
          <>
            {freeStats.map(({ label, value }) => (
              <div key={label} style={{ padding: '12px 14px', borderRadius: 10, background: '#F5F0EA', marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#9a948f', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'DM Sans'" }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#1A1A1A', fontFamily: "'DM Sans'" }}>{value}</div>
              </div>
            ))}
            <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: '#F0EBE6', border: '1px dashed rgba(232,96,74,0.3)' }}>
              <div style={{ fontSize: 11, color: '#E8604A', fontWeight: 500, marginBottom: 3, fontFamily: "'DM Sans'" }}>Unlock the moments</div>
              <div style={{ fontSize: 11, color: '#9a948f', lineHeight: 1.55, fontFamily: "'DM Sans'" }}>See the actual messages behind this insight. Stash Pro.</div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <div style={{ fontSize: 28, marginBottom: 14 }}>🔒</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A', marginBottom: 6, fontFamily: "'DM Sans'" }}>Stash Pro</div>
            <div style={{ fontSize: 12, color: '#6f6a65', lineHeight: 1.6, marginBottom: 20, fontFamily: "'DM Sans'" }}>The full timeline and actual messages behind every insight.</div>
            <div style={{ background: '#26211d', borderRadius: 10, padding: '12px 20px', display: 'inline-block' }}>
              <div style={{ fontSize: 12, color: '#E8604A', fontWeight: 500, fontFamily: "'DM Sans'" }}>$29 one-time</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, fontFamily: "'DM Sans'" }}>Coming soon</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Dashboard({ stats, chatNameMap, onSelectConversation, dateRange = 'all', scopedPerson, onClearScope, insightSurface = 'relationship', onSurfaceChange, isStatsLoading, onDrillThrough }: Props): JSX.Element {
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

  const [todayMemories, setTodayMemories] = useState<MemoryItem[]>([])
  const [networkData, setNetworkData] = useState<NetworkData | null>(null)

  type UsageData = { totalMessages: number; sentMessages: number; receivedMessages: number; messagesPerYear: { year: number; count: number }[]; busiestDay: { date: string; count: number } | null; activeConversations: number }
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  useEffect(() => {
    const bounds: { from?: string; to?: string } = {}
    if (dateRange === '7days') { const d = new Date(); d.setDate(d.getDate()-7); bounds.from = d.toISOString().split('T')[0] }
    else if (dateRange === '30days') { const d = new Date(); d.setDate(d.getDate()-30); bounds.from = d.toISOString().split('T')[0] }
    else if (dateRange === 'month') { bounds.from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0] }
    else if (dateRange === 'year') { bounds.from = `${new Date().getFullYear()}-01-01` }
    else if (/^\d{4}$/.test(dateRange || '')) { bounds.from = `${dateRange}-01-01`; bounds.to = `${dateRange}-12-31` }
    else if (/^\d{4}-\d{2}$/.test(dateRange || '')) { const [y,m] = (dateRange||'').split('-'); bounds.from = `${y}-${m}-01`; bounds.to = new Date(+y, +m, 0).toISOString().split('T')[0] }
    window.api.getUsageStats(bounds.from, bounds.to).then(setUsageData).catch(() => {})
  }, [dateRange])
  useEffect(() => { window.api.getTodayInHistory().then(setTodayMemories).catch(() => {}) }, [])
  useEffect(() => { window.api.getMessagingNetwork().then(setNetworkData).catch(() => {}) }, [])

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

  // ── Conversational surface state (must be before early returns) ──
  const [msgQuery, setMsgQuery] = useState('')
  const [msgResults, setMsgResults] = useState<{ id: number; body: string; chat_name: string; sender_handle: string | null; is_from_me: number; sent_at: string; snippet: string }[] | null>(null)
  const [msgSearching, setMsgSearching] = useState(false)
  const [msgIndexStatus, setMsgIndexStatus] = useState<{ total: number; indexed: number } | null>(null)
  const [vocabStats, setVocabStats] = useState<{ uniqueWords: number; totalWords: number; avgWordsPerMessage: number; theirAvgWordsPerMessage: number; topWords: { word: string; count: number }[] } | null>(null)
  const [wordOrigins, setWordOrigins] = useState<{ word: string; firstUsed: string; chatName: string; totalUses: number; firstMessage: string | null }[]>([])

  useEffect(() => {
    window.api.getMessageIndexStatus().then(setMsgIndexStatus).catch(() => {})
    window.api.getVocabStats(scopedPerson || undefined).then(setVocabStats).catch(() => {})
    window.api.getWordOrigins(scopedPerson || undefined).then(setWordOrigins).catch(() => {})
  }, [scopedPerson])

  const generateShareCard = async (title: string, bigNumber: string, unit: string, copy: string, personName?: string): Promise<void> => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200; canvas.height = 1200
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#0F0F0F'; ctx.fillRect(0, 0, 1200, 1200)
    ctx.fillStyle = 'rgba(232,96,74,0.5)'; ctx.font = '14px DM Sans'; ctx.letterSpacing = '3px'; ctx.fillText(`STASH · ${title.toUpperCase()}`, 80, 120)
    ctx.fillStyle = '#E8604A'; ctx.font = '200 120px system-ui'; ctx.fillText(bigNumber, 80, 300)
    ctx.fillStyle = 'rgba(232,96,74,0.6)'; ctx.font = '200 32px system-ui'; ctx.fillText(unit, 80, 360)
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '28px DM Sans'
    const words = copy.split(' '); let line = '', y = 460
    for (const w of words) { if (ctx.measureText(line + w).width > 900) { ctx.fillText(line.trim(), 80, y); y += 42; line = '' } line += w + ' ' }
    if (line.trim()) ctx.fillText(line.trim(), 80, y)
    if (personName) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '22px DM Sans'; ctx.fillText(personName, 80, y + 60) }
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.font = '18px DM Sans'; ctx.fillText('stashapp.co', 80, 1140)
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '18px DM Sans'; ctx.fillText('STASH', 1040, 1140)
    const dataUrl = canvas.toDataURL('image/png')
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    await window.api.saveShareCard(dataUrl, `stash-${slug}.png`)
  }

  const handleMsgSearch = async (): Promise<void> => {
    if (!msgQuery.trim() || msgSearching) return
    setMsgSearching(true)
    try { setMsgResults(await window.api.searchMessages(msgQuery.trim(), scopedPerson || undefined, 30)) }
    catch { setMsgResults([]) }
    finally { setMsgSearching(false) }
  }

  const isIndexed = msgIndexStatus && msgIndexStatus.indexed > 0
  const indexPct = msgIndexStatus && msgIndexStatus.total > 0 ? Math.round((msgIndexStatus.indexed / msgIndexStatus.total) * 100) : 0

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
                <div style={{ gridColumn: 'span 4', cursor: 'pointer', position: 'relative' }}
                  onClick={() => onDrillThrough?.(`${firstName}'s comedy record`, `${firstName} · all time`, [
                    { label: 'Made you laugh', value: `${pd.laughsReceived.toLocaleString()} times` },
                    { label: 'You made them laugh', value: `${pd.laughsGenerated.toLocaleString()} times` },
                    { label: 'Laugh rate', value: `${Math.round((pd.laughsReceived / Math.max(pd.messageCount, 1)) * 100)}% of messages got a laugh` },
                  ])}>
                  <WinnerCard award="Comedy advantage" name={pd.laughsReceived > pd.laughsGenerated ? 'You win' : `${firstName} wins`}
                    stat={`You got ${pd.laughsGenerated.toLocaleString()} laughs out of them`}
                    flavor={pd.laughsReceived > pd.laughsGenerated ? 'You win. They have no defense against you.' : 'They get you every time. Keep them close.'}
                    emoji="🎭" accentColor="#2EC4A0" span={12} />
                  <button onClick={(e) => { e.stopPropagation(); generateShareCard('Comedy record', pd.laughsReceived.toLocaleString(), 'laughs received', `${firstName} makes me laugh more than anyone.`, firstName) }}
                    style={{ position: 'absolute', top: 10, right: 36, width: 26, height: 26, background: 'rgba(232,96,74,0.08)', border: '0.5px solid rgba(232,96,74,0.25)', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 1l3 3-3 3M10 4H4a3 3 0 000 6h1" stroke="#E8604A" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <div style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, background: 'rgba(232,96,74,0.1)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <svg width="7" height="10" viewBox="0 0 7 10" fill="none"><path d="M1.5 1.5l4 3.5-4 3.5" stroke="#E8604A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>
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
                <div style={{ gridColumn: 'span 6', cursor: 'pointer', position: 'relative' }}
                  onClick={() => onDrillThrough?.('Shared archive', `${firstName} · all attachments`, [
                    { label: 'Total shared', value: `${pd.attachmentCount.toLocaleString()} files` },
                    { label: 'Your share of messages', value: `${Math.round((pd.sentCount / Math.max(pd.messageCount, 1)) * 100)}% sent by you` },
                    { label: 'Relationship since', value: convStats?.firstMessageDate ? new Date(convStats.firstMessageDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—' },
                  ])}>
                  <RelCard emoji="📸" title="The Archive" span={12}
                    metric={pd.attachmentCount.toLocaleString()}
                    sentence={`${pd.attachmentCount.toLocaleString()} things shared between you.`}
                    flavor="Photos, memes, evidence." />
                  <div style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, background: 'rgba(46,196,160,0.15)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <svg width="7" height="10" viewBox="0 0 7 10" fill="none"><path d="M1.5 1.5l4 3.5-4 3.5" stroke="#2EC4A0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>
              </>}
              {/* Enriched stats from getConversationStats */}
              {convStats?.relationshipArc && (
                <EditorialCard kicker={`${arcLabel[convStats.relationshipArc] || 'Steady'} ${arcEmoji[convStats.relationshipArc] || ''}`}
                  headline={arcSentence(convStats.relationshipArc, firstName)}
                  subtext={convStats.relationshipArc === 'fading' ? 'You used to talk more. Something shifted.' : convStats.relationshipArc === 'growing' ? 'Something is building here.' : convStats.relationshipArc === 'rekindled' ? 'You found your way back.' : ''}
                  accent="#2EC4A0" span={4} />
              )}
              {convStats && convStats.longestStreakDays > 0 && (
                <div style={{ gridColumn: 'span 4', cursor: 'pointer', position: 'relative' }}
                  onClick={() => onDrillThrough?.('Longest streak', `${firstName} · consecutive days`, [
                    { label: 'Record streak', value: `${convStats.longestStreakDays} days in a row` },
                    { label: 'Total messages', value: pd!.messageCount.toLocaleString() },
                    { label: 'Avg messages/day', value: `~${Math.round(pd!.messageCount / Math.max(convStats.longestStreakDays, 1))} on active days` },
                  ])}>
                  <PosterCard eyebrow="Longest streak" number={`${convStats.longestStreakDays}`} unit="days"
                    descriptor={convStats.longestStreakDays > 60 ? `${convStats.longestStreakDays} days straight. What were you two even talking about?` : 'Your longest run of consecutive daily messages.'}
                    accent="#2EC4A0" bg="#F8F4F0" span={12} />
                  <button onClick={(e) => { e.stopPropagation(); generateShareCard('Longest streak', convStats.longestStreakDays.toString(), 'days straight', `${convStats.longestStreakDays} consecutive days with ${firstName}.`, firstName) }}
                    style={{ position: 'absolute', top: 10, right: 36, width: 26, height: 26, background: 'rgba(46,196,160,0.1)', border: '0.5px solid rgba(46,196,160,0.3)', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 1l3 3-3 3M10 4H4a3 3 0 000 6h1" stroke="#2EC4A0" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <div style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, background: 'rgba(46,196,160,0.15)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <svg width="7" height="10" viewBox="0 0 7 10" fill="none"><path d="M1.5 1.5l4 3.5-4 3.5" stroke="#2EC4A0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>
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
              {vocabStats && vocabStats.theirAvgWordsPerMessage > 0 && (
                <LoquaciousnessCard myAvg={vocabStats.avgWordsPerMessage} theirAvg={vocabStats.theirAvgWordsPerMessage} theirName={firstName}
                  onShare={() => generateShareCard('Word for word', String(vocabStats.avgWordsPerMessage), 'words per message', vocabStats.avgWordsPerMessage > vocabStats.theirAvgWordsPerMessage ? "Doesn't use 9 words when 47 will do." : `${firstName} doesn't use 9 words when 47 will do.`, firstName)} span={6} />
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

        {/* TIER 1: IDENTITY */}
        {(() => {
          const groupMessages = groups.reduce((s, c) => s + c.messageCount, 0)
          const totalMsgs = chats.reduce((s, c) => s + c.messageCount, 0)
          const groupPct = totalMsgs > 0 ? Math.round((groupMessages / totalMsgs) * 100) : 0
          const isGroupPerson = groupPct > 50
          return (
            <PosterCard eyebrow="Your messaging identity"
              number={isGroupPerson ? `${groupPct}%` : `${100 - groupPct}%`}
              unit={isGroupPerson ? 'group chats' : 'one-on-one'}
              descriptor={isGroupPerson
                ? 'You live in the group chat. The noise is where you\'re comfortable.'
                : 'You prefer depth over breadth. One-on-one conversations dominate your messaging life.'}
              accent="#E8604A" bg="#26211d" span={7} />
          )
        })()}
        {(() => {
          const top3 = byMessages.slice(0, 3).reduce((s, c) => s + c.messageCount, 0)
          const total = chats.reduce((s, c) => s + c.messageCount, 0)
          const pct = total > 0 ? Math.round((top3 / total) * 100) : 0
          return (
            <PosterCard eyebrow="Your inner circle" number={`${pct}%`}
              descriptor={pct > 60 ? 'of your messages go to just 3 people. You run deep, not wide.'
                : pct > 40 ? 'to your top 3. A fairly concentrated social life.'
                : 'spread wide. You keep a lot of threads alive at once.'}
              accent="#E8604A" bg="#F8F4F0" span={5} />
          )
        })()}

        {/* TIER 2: DYNAMICS — spectrums */}
        <SpectrumCard eyebrow="Your conversational role" leftLabel="Pure responder" rightLabel="Always initiates"
          markerPct={initiationPct}
          markerLabel={initiationPct > 65 ? 'The Initiator' : initiationPct > 45 ? 'The Collaborator' : initiationPct > 25 ? 'The Responder' : 'The Receiver'}
          descriptor={initiationPct > 65 ? `You start ${initiationPct}% of conversations. You keep things alive — and you know it.`
            : initiationPct > 45 ? `${initiationPct}% initiation. You pull your weight without overdoing it.`
            : initiationPct > 25 ? `${initiationPct}% initiation. You tend to wait for others to reach out.`
            : `Only ${initiationPct}% initiation. People come to you.`}
          accent="#E8604A" span={4} />

        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const allReplyTimes = individuals.filter(c => c.avgReplyMinutes > 0)
          if (!allReplyTimes.length) return <div style={{ gridColumn: 'span 4' }} />
          const avgReply = Math.round(allReplyTimes.reduce((s, c) => s + c.avgReplyMinutes, 0) / allReplyTimes.length)
          const mp = Math.min(95, Math.max(5, 100 - Math.round((Math.min(avgReply, 120) / 120) * 90)))
          return (
            <SpectrumCard eyebrow="Your reply style" leftLabel="Takes their time" rightLabel="Always instant"
              markerPct={mp}
              markerLabel={avgReply < 3 ? 'Instant' : avgReply < 15 ? 'Quick' : avgReply < 45 ? 'Unhurried' : 'Deliberate'}
              descriptor={avgReply < 3 ? 'You reply almost immediately. You\'re never far from your phone.'
                : avgReply < 15 ? `~${avgReply} min average. Quick enough that people know you're paying attention.`
                : avgReply < 45 ? `~${avgReply} min average. Unhurried. You reply on your own terms.`
                : `~${avgReply} min average. You make people wait for it.`}
              accent="#E8604A" span={4} />
          )
        })()}

        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const totalMessages = chats.reduce((s, c) => s + c.messageCount, 0)
          const totalLateNight = individuals.reduce((s, c) => s + (c.messageCount * c.lateNightRatio / 100), 0)
          const globalLateNightPct = totalMessages > 0 ? Math.round((totalLateNight / totalMessages) * 100) : 0
          return (
            <SpectrumCard eyebrow="Your active hours" leftLabel="Early bird" rightLabel="Night owl"
              markerPct={Math.min(95, globalLateNightPct * 4)}
              markerLabel={globalLateNightPct > 25 ? 'Night Owl' : globalLateNightPct > 10 ? 'Balanced' : globalLateNightPct > 3 ? 'Daytime' : 'Early Bird'}
              descriptor={globalLateNightPct > 25 ? `${globalLateNightPct}% of your messages happen after 11pm. You come alive at night.`
                : globalLateNightPct > 10 ? `${globalLateNightPct}% late night messages. You keep mostly daytime hours — with exceptions.`
                : `Under ${globalLateNightPct + 5}% late night. You're a daytime communicator.`}
              accent="#7F77DD" span={4} />
          )
        })()}

        {/* TIER 2.5: TIMING */}
        {stats.globalPeakHour !== null && stats.globalPeakHour !== undefined && (() => {
          const hr = stats.globalPeakHour as number
          const displayHour = hr === 0 ? '12am' : hr < 12 ? `${hr}am` : hr === 12 ? '12pm' : `${hr - 12}pm`
          const isMorning = hr >= 6 && hr < 12, isAfternoon = hr >= 12 && hr < 17, isEvening = hr >= 17 && hr < 22, isNight = hr >= 22 || hr < 6
          const archetype = isMorning ? 'Morning Texter' : isAfternoon ? 'Afternoon Person' : isEvening ? 'Evening Communicator' : 'Night Owl'
          const descriptor = isMorning ? `${displayHour} is your peak texting hour. You get it done before the day gets loud.`
            : isAfternoon ? `${displayHour} is when you're most likely to reach out. Prime afternoon hours.`
            : isEvening ? `${displayHour} — after the day settles, you connect.`
            : `${displayHour} is your peak hour. You come alive when others wind down.`
          return <SpectrumCard eyebrow="Your peak texting hour" leftLabel="Midnight" rightLabel="11pm"
            markerPct={Math.round((hr / 23) * 100)} markerLabel={archetype} descriptor={descriptor}
            accent={isNight ? '#7F77DD' : '#E8604A'} span={6} />
        })()}

        {stats.globalPeakWeekday !== null && stats.globalPeakWeekday !== undefined && (() => {
          const dow = stats.globalPeakWeekday as number
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          const dayName = dayNames[dow]
          const isWeekend = dow === 0 || dow === 6, isFriday = dow === 5
          const archetype = isWeekend ? 'Weekend Texter' : isFriday ? 'End-of-Week Connector' : 'Weekday Communicator'
          const descriptor = isWeekend ? `${dayName} is your most active messaging day. You connect when you have space to breathe.`
            : isFriday ? `${dayName}s. The week winds down and the conversation picks up.`
            : `${dayName}s are your most active. You message most when the week is in motion.`
          return <SpectrumCard eyebrow="Your most active day" leftLabel="Sunday" rightLabel="Saturday"
            markerPct={Math.round((dow / 6) * 100)} markerLabel={archetype} descriptor={descriptor}
            accent="#E8604A" span={6} />
        })()}

        {/* TIER 3: COMEDY — leaderboard cards */}
        {isStatsLoading ? <WarmingCard span={6} /> : (() => {
          const laughers = byLaughsReceived.filter(c => c.laughsReceived > 0).slice(0, 3)
          if (!laughers.length) return null
          const maxL = laughers[0].laughsReceived
          return (
            <LeaderboardCard eyebrow="Who makes you laugh most"
              items={laughers.map(c => ({ name: resolveName(c.rawName, chatNameMap), value: `${c.laughsReceived.toLocaleString()} laughs`, pct: Math.round((c.laughsReceived / maxL) * 100) }))}
              accent="#E8604A" span={6} />
          )
        })()}

        {isStatsLoading ? <WarmingCard span={6} /> : (() => {
          const audience = byLaughsGenerated.filter(c => c.laughsGenerated > 0).slice(0, 3)
          if (!audience.length) return null
          const maxL = audience[0].laughsGenerated
          return (
            <LeaderboardCard eyebrow="Your best audience"
              items={audience.map(c => ({ name: resolveName(c.rawName, chatNameMap), value: `${c.laughsGenerated.toLocaleString()} laughs`, pct: Math.round((c.laughsGenerated / maxL) * 100) }))}
              accent="#2EC4A0" span={6} />
          )
        })()}

        {/* TIER 4: STORIES */}
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

        {byMessages[0] && (
          <EditorialCard kicker="Ride or die"
            headline={`${resolveName(byMessages[0].rawName, chatNameMap)} gets more of you than anyone else.`}
            subtext={`${byMessages[0].messageCount.toLocaleString()} messages. Your default person.`}
            accent="#E8604A" span={6} />
        )}

        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const fastest = [...individuals].filter(c => c.avgReplyMinutes > 0 && c.avgReplyMinutes < 60).sort((a, b) => a.avgReplyMinutes - b.avgReplyMinutes)[0]
          return fastest ? (
            <WinnerCard award="You reply fastest to" name={resolveName(fastest.rawName, chatNameMap)}
              stat={`~${fastest.avgReplyMinutes} min average`}
              flavor={fastest.avgReplyMinutes < 3 ? 'Basically always there for them.' : 'Quicker than you are with most.'}
              emoji="⚡" accentColor="#2EC4A0" span={4} />
          ) : null
        })()}

        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const topNightOwl = [...individuals].sort((a, b) => b.lateNightRatio - a.lateNightRatio)[0]
          return topNightOwl && topNightOwl.lateNightRatio > 10 ? (
            <WinnerCard award="Night owl connection" name={resolveName(topNightOwl.rawName, chatNameMap)}
              stat={`${topNightOwl.lateNightRatio}% of messages after 11pm`}
              flavor="Some relationships only come alive after midnight."
              emoji="🌙" accentColor="#7F77DD" span={4} />
          ) : null
        })()}

        {(() => {
          const m = [...individuals].filter(c => c.sentCount + c.receivedCount > 20)
            .map(c => ({ ...c, ratio: c.sentCount / Math.max(c.receivedCount, 1) }))
            .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))[0]
          return m && (m.ratio > 1.8 || m.ratio < 0.55) ? (
            <EditorialCard kicker="Most one-sided"
              headline={`${resolveName(m.rawName, chatNameMap)} — ${m.ratio > 1 ? `you send ${m.ratio.toFixed(1)}× more` : `they send ${(1/m.ratio).toFixed(1)}× more`}.`}
              subtext={m.ratio > 2 ? 'This one runs almost entirely on you.' : 'A noticeable imbalance.'}
              accent="#E8604A" span={4} />
          ) : null
        })()}

        {networkData && networkData.nodes.length >= 4 && (
          <ConstellationCard network={networkData} chatNameMap={chatNameMap} onSelectConversation={onSelectConversation} />
        )}

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

        {usageData && usageData.messagesPerYear.length > 1 && (() => {
          const years = usageData.messagesPerYear
          const maxCount = Math.max(...years.map(y => y.count))
          return (
            <div style={{ gridColumn: 'span 12', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 16, fontFamily: "'DM Sans'" }}>Messages sent · by year</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                {years.map(y => {
                  const pct = Math.round((y.count / maxCount) * 100)
                  const isMax = y.count === maxCount
                  return (
                    <div key={y.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 9, color: isMax ? '#7F77DD' : '#c8c0ba', fontFamily: "'DM Sans'", fontWeight: isMax ? 600 : 400 }}>{y.count >= 1000 ? `${Math.round(y.count/1000)}k` : y.count}</div>
                      <div style={{ width: '100%', height: `${Math.max(pct * 0.64, 4)}px`, background: isMax ? '#7F77DD' : '#EAE5DF', borderRadius: 3 }} />
                      <div style={{ fontSize: 9, color: '#9a948f', fontFamily: "'DM Sans'" }}>{String(y.year).slice(2)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {usageData && (
          <>
            {[
              { label: 'Total messages', value: usageData.totalMessages.toLocaleString(), sub: 'sent + received' },
              { label: 'You sent', value: usageData.sentMessages.toLocaleString(), sub: usageData.totalMessages > 0 ? `${Math.round((usageData.sentMessages / usageData.totalMessages) * 100)}% of all` : '' },
              { label: 'Busiest day', value: usageData.busiestDay ? usageData.busiestDay.count.toLocaleString() : '—', sub: usageData.busiestDay ? new Date(usageData.busiestDay.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '' },
              { label: 'Active now', value: usageData.activeConversations.toLocaleString(), sub: 'in last 30 days' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ gridColumn: 'span 3', borderRadius: 16, padding: '18px 20px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 8, fontFamily: "'DM Sans'" }}>{label}</div>
                <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 26, color: '#7F77DD' }}>{value}</div>
                <div style={{ fontSize: 11, color: '#9a948f', marginTop: 4, fontFamily: "'DM Sans'" }}>{sub}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )

  const conversationalSurface = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>
      <div style={{ gridColumn: 'span 12', background: '#1A1818', borderRadius: 18, padding: '24px 28px' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 10, fontFamily: "'DM Sans'" }}>Message search</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 22, color: '#fff', marginBottom: 6 }}>{isIndexed ? 'Search your messages.' : 'Indexing your messages…'}</div>
        {!isIndexed && msgIndexStatus && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 12, fontFamily: "'DM Sans'" }}>
            {msgIndexStatus.indexed.toLocaleString()} of {msgIndexStatus.total.toLocaleString()} indexed · {indexPct}%
            <div style={{ height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${indexPct}%`, background: '#2EC4A0', borderRadius: 1, transition: 'width 0.5s' }} />
            </div>
          </div>
        )}
        {isIndexed && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input type="text" value={msgQuery} onChange={e => setMsgQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleMsgSearch()}
              placeholder={scopedPerson ? `Search messages with ${resolveName(scopedPerson, chatNameMap)}…` : 'Search all messages…'}
              style={{ flex: 1, padding: '11px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: 13, outline: 'none', fontFamily: "'DM Sans'" }} />
            <button onClick={handleMsgSearch} disabled={msgSearching}
              style={{ padding: '11px 20px', borderRadius: 10, background: '#E8604A', border: 'none', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans'", opacity: msgSearching ? 0.6 : 1 }}>
              {msgSearching ? '…' : 'Search'}
            </button>
          </div>
        )}
        {isIndexed && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8, fontFamily: "'DM Sans'" }}>{msgIndexStatus!.indexed.toLocaleString()} messages indexed</div>}
      </div>

      {msgResults !== null && (
        <div style={{ gridColumn: 'span 12' }}>
          {msgResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#9a948f', fontSize: 13, fontFamily: "'DM Sans'" }}>No messages found for "{msgQuery}"</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 4, fontFamily: "'DM Sans'" }}>{msgResults.length} result{msgResults.length !== 1 ? 's' : ''} for "{msgQuery}"</div>
              {msgResults.map(r => (
                <div key={r.id} onClick={() => r.chat_name && onSelectConversation(r.chat_name)}
                  style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: r.is_from_me ? '#E8604A' : '#2EC4A0', fontWeight: 500, fontFamily: "'DM Sans'" }}>
                      {r.is_from_me ? 'You' : (r.sender_handle ? resolveName(r.sender_handle, chatNameMap) : 'Them')} · <span style={{ color: '#9a948f', fontWeight: 400 }}>{resolveName(r.chat_name, chatNameMap)}</span>
                    </span>
                    <span style={{ fontSize: 10, color: '#c8c0ba', fontFamily: "'DM Sans'" }}>{new Date(r.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#4a4542', lineHeight: 1.5, fontFamily: "'DM Sans'" }}
                    dangerouslySetInnerHTML={{ __html: r.snippet.replace(/<mark>/g, '<mark style="background:#FFF3CD;color:#1A1A1A;border-radius:2px;padding:0 2px">').replace(/<\/mark>/g, '</mark>') }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isIndexed && !msgResults && vocabStats && vocabStats.uniqueWords > 0 && (
        <>
          <PosterCard eyebrow="Your vocabulary" number={vocabStats.uniqueWords.toLocaleString()} unit="unique words"
            descriptor={vocabStats.avgWordsPerMessage > 15 ? `You average ${vocabStats.avgWordsPerMessage} words per message. Doesn't use 9 words when 47 will do.`
              : vocabStats.avgWordsPerMessage > 7 ? `${vocabStats.avgWordsPerMessage} words per message on average. Measured, clear, direct.`
              : `${vocabStats.avgWordsPerMessage} words per message. Every word earns its place.`}
            accent="#E8604A" bg="#26211d" span={6} />
          <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 14, fontFamily: "'DM Sans'" }}>
              {scopedPerson ? `Your words with ${resolveName(scopedPerson, chatNameMap)}` : 'Your most used words'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {vocabStats.topWords.slice(0, 12).map(({ word, count }, i) => {
                const maxCount = vocabStats.topWords[0]?.count || 1
                const opacity = 0.4 + (count / maxCount) * 0.6
                return <span key={word} style={{ fontSize: i < 3 ? 16 : i < 7 ? 13 : 11, color: `rgba(232,96,74,${opacity})`, fontFamily: "'DM Sans'", fontWeight: i < 3 ? 500 : 400 }}>{word}</span>
              })}
            </div>
          </div>
        </>
      )}

      {isIndexed && !msgResults && wordOrigins.length > 0 && (
        <div style={{ gridColumn: 'span 12' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 10, fontFamily: "'DM Sans'" }}>
            {scopedPerson ? 'Words that entered your vocabulary here' : 'A word was born'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {wordOrigins.map(({ word, firstUsed, chatName: cn, totalUses, firstMessage }) => {
              const dt = new Date(firstUsed)
              const dateStr = dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              const contactName = resolveName(cn, chatNameMap)
              return (
                <div key={word} onClick={() => onSelectConversation(cn)}
                  style={{ padding: '14px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 400, fontSize: 16, color: '#E8604A' }}>"{word}"</span>
                    <span style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>· first used {dateStr}</span>
                    <span style={{ fontSize: 11, color: '#c8c0ba', fontFamily: "'DM Sans'", marginLeft: 'auto' }}>{totalUses}× total</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'", marginBottom: firstMessage ? 8 : 0 }}>
                    In a conversation with <span style={{ color: '#1A1A1A', fontWeight: 500 }}>{contactName}</span>.
                  </div>
                  {firstMessage && (
                    <div style={{ fontSize: 12, color: '#9a948f', fontStyle: 'italic', fontFamily: "'DM Sans'", padding: '8px 10px', background: '#F8F4F0', borderRadius: 8 }}>"{firstMessage}"</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!isIndexed && (
        <div style={{ gridColumn: 'span 12', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 4, fontFamily: "'DM Sans'" }}>Available after indexing</div>
          {['Search any message you\'ve ever sent or received', 'Your vocabulary profile — unique words, avg length', 'Most used words — your personal word fingerprint', 'What do you actually talk about most?'].map(p => (
            <div key={p} style={{ background: 'rgba(0,0,0,0.03)', border: '1px dashed rgba(0,0,0,0.1)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#9a948f', fontFamily: "'DM Sans'" }}>{p}</div>
          ))}
        </div>
      )}
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

      {/* Today in History */}
      {todayMemories.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14, marginBottom: 14 }}>
          <TodayInHistoryCard memories={todayMemories} chatNameMap={chatNameMap} onSelectConversation={onSelectConversation} />
        </div>
      )}

      {/* Global relationship insight grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>

        {/* ZONE 1 — Identity: who you are as a communicator */}
        {(() => {
          const groupMessages = groups.reduce((s, c) => s + c.messageCount, 0)
          const totalMsgs = chats.reduce((s, c) => s + c.messageCount, 0)
          const groupPct = totalMsgs > 0 ? Math.round((groupMessages / totalMsgs) * 100) : 0
          const isGroupPerson = groupPct > 50
          return (
            <PosterCard eyebrow="Your social identity"
              number={isGroupPerson ? `${groupPct}%` : `${100 - groupPct}%`}
              unit={isGroupPerson ? 'group chats' : 'one-on-one'}
              descriptor={isGroupPerson
                ? 'You live in the group chat. The noise is where you belong.'
                : 'You prefer depth over breadth. One-on-one is your natural mode.'}
              accent="#2EC4A0" bg="#1E2826" span={7} />
          )
        })()}
        {(() => {
          const top3 = byMessages.slice(0, 3).reduce((s, c) => s + c.messageCount, 0)
          const total = chats.reduce((s, c) => s + c.messageCount, 0)
          const pct = total > 0 ? Math.round((top3 / total) * 100) : 0
          return (
            <PosterCard eyebrow="Your inner circle" number={`${pct}%`}
              descriptor={pct > 60 ? 'of your messages go to just 3 people. You run deep, not wide.'
                : pct > 40 ? 'to your top 3 contacts. Fairly concentrated.'
                : 'spread across many people. You keep a wide net.'}
              accent="#2EC4A0" bg="#F8F4F0" span={5} />
          )
        })()}

        {/* ZONE 2 — Named winners */}
        {isStatsLoading ? <WarmingCard span={4} /> : topFunny && topFunny.laughsReceived > 0 ? (
          <WinnerCard award="Makes you laugh most" name={resolveName(topFunny.rawName, chatNameMap)}
            stat={`${topFunny.laughsReceived.toLocaleString()} times — more than anyone`}
            flavor="Your funniest person."
            emoji="😂" accentColor="#2EC4A0" span={4} />
        ) : <div style={{ gridColumn: 'span 4' }} />}

        {topChat ? (
          <WinnerCard award="Most active relationship" name={resolveName(topChat.rawName, chatNameMap)}
            stat={`${topChat.messageCount.toLocaleString()} messages`}
            flavor="Your most consistent connection this period."
            emoji="💬" accentColor="#E8604A" span={4} />
        ) : <div style={{ gridColumn: 'span 4' }} />}

        <SplitCard eyebrow="Who reaches out first"
          leftValue={`${initiationPct}%`} leftLabel="You initiate"
          leftSub={initiationPct > 60 ? 'You keep things alive.' : initiationPct < 40 ? 'Others drive this.' : 'You share the load.'}
          rightValue={`${100 - initiationPct}%`} rightLabel="They initiate"
          rightSub={initiationPct > 60 ? 'They wait for you.' : initiationPct < 40 ? 'They reach out more.' : 'Pretty balanced.'}
          leftPct={initiationPct} accent="#E8604A" span={4} />

        {/* ZONE 3 — Emotional / editorial */}
        {(() => {
          const now = new Date()
          const gq = [...individuals].filter(c => c.messageCount > 50)
            .map(c => ({ ...c, daysSince: Math.floor((now.getTime() - new Date(c.lastMessageDate).getTime()) / 86400000) }))
            .filter(c => c.daysSince > 30)
            .sort((a, b) => b.daysSince - a.daysSince)[0]
          return gq ? (
            <EditorialCard kicker="Gone quiet"
              headline={`${resolveName(gq.rawName, chatNameMap)}. ${gq.daysSince} days of silence.`}
              subtext="You used to talk a lot. Something shifted — or life just got busy."
              accent="#E8604A" span={6} />
          ) : null
        })()}
        {(() => {
          const byImbalance = [...individuals].filter(c => c.sentCount + c.receivedCount > 20)
            .map(c => ({ ...c, ratio: c.sentCount / Math.max(c.receivedCount, 1) }))
            .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))
          const m = byImbalance[0]
          return m ? (
            <EditorialCard kicker="Most one-sided"
              headline={`${resolveName(m.rawName, chatNameMap)} — ${m.ratio > 1 ? `you send ${m.ratio.toFixed(1)}× more` : `they send ${(1/m.ratio).toFixed(1)}× more`}.`}
              subtext={m.ratio > 2 ? 'This one runs almost entirely on you.' : 'A slight imbalance — might be worth noticing.'}
              accent="#E8604A" span={6} />
          ) : null
        })()}

        {/* ZONE 4 — Supporting winners */}
        {isStatsLoading ? <WarmingCard span={4} /> : (() => {
          const topLateNight = [...individuals].filter(c => c.lateNightRatio > 0)
            .sort((a, b) => b.lateNightRatio - a.lateNightRatio)[0]
          return topLateNight ? (
            <WinnerCard award="Night owl connection" name={resolveName(topLateNight.rawName, chatNameMap)}
              stat={`${topLateNight.lateNightRatio}% of messages after 11pm`}
              flavor="Some relationships only come alive after midnight."
              emoji="🌙" accentColor="#7F77DD" span={4} />
          ) : null
        })()}

        {isStatsLoading ? <WarmingCard span={4} /> : topGroup ? (
          <WinnerCard award="Most active group" name={resolveName(topGroup.rawName, chatNameMap)}
            stat={`${topGroup.messageCount.toLocaleString()} messages`}
            flavor="Your busiest room."
            emoji="🔥" accentColor="#E8604A" span={4} />
        ) : null}

        {topAttach ? (
          <WinnerCard award="Most files shared" name={resolveName(topAttach.rawName, chatNameMap)}
            stat={`${topAttach.attachmentCount.toLocaleString()} attachments`}
            flavor="Photos, memes, evidence — all of it."
            emoji="📎" accentColor="#7F77DD" span={4} />
        ) : null}

        {/* ZONE 5 — Leaderboard tiles */}
        {isStatsLoading ? <WarmingCard span={6} /> : (
          <div style={{ ...tileBase, gridColumn: 'span 6' }}>
            <TileLabel text="Who makes you laugh most" />
            {byLaughsReceived.filter(c => c.laughsReceived > 0).slice(0, 3).map((c, i) => (
              <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)}
                sub={laughLabels[i] || ''} value={`${c.laughsReceived.toLocaleString()} laughs`} />
            ))}
            {byLaughsReceived.every(c => c.laughsReceived === 0) && (
              <div style={{ color: '#9a948f', fontSize: 13, padding: '12px 0' }}>No laugh data for this period</div>
            )}
          </div>
        )}

        {isStatsLoading ? <WarmingCard span={6} /> : (
          <div style={{ ...tileBase, gridColumn: 'span 6' }}>
            <TileLabel text="You're funniest to" />
            {byLaughsGenerated.filter(c => c.laughsGenerated > 0).slice(0, 3).map((c, i) => (
              <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)}
                sub={i === 0 ? 'Your best audience' : i === 1 ? 'Close second' : 'Third place'}
                value={`${c.laughsGenerated.toLocaleString()} laughs`} />
            ))}
            {byLaughsGenerated.every(c => c.laughsGenerated === 0) && (
              <div style={{ color: '#9a948f', fontSize: 13, padding: '12px 0' }}>No laugh data for this period</div>
            )}
          </div>
        )}

      </div>
      </>}
    </div>
    </div>
  )
}
