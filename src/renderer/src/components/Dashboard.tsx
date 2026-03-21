import { useState, useEffect, useRef } from 'react'
import { Lock } from 'lucide-react'
import type { Stats, ChatNameEntry } from '../types'
import { ProLock } from './ProLock'

type NetworkNode = { rawName: string; messageCount: number }
type NetworkEdge = { a: string; b: string; sharedGroups: number }
type NetworkGroup = { chatId: string; displayName: string; members: string[]; messageCount: number }
type NetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[]; groups: NetworkGroup[] }

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
  peakYear: { year: number; count: number } | null
  peakYearShareOfTotal: number | null
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

const SURFACE_TOKENS = {
  relationship: { primary: '#2EC4A0', ambient: 'rgba(46,196,160,0.025)', glow: 'rgba(46,196,160,0.07)', faintText: 'rgba(46,196,160,0.035)', word: 'RELATIONSHIPS' },
  personal: { primary: '#E8604A', ambient: 'rgba(232,96,74,0.025)', glow: 'rgba(232,96,74,0.07)', faintText: 'rgba(232,96,74,0.035)', word: 'PERSONAL' },
  usage: { primary: '#7F77DD', ambient: 'rgba(127,119,221,0.025)', glow: 'rgba(127,119,221,0.07)', faintText: 'rgba(127,119,221,0.035)', word: 'USAGE' },
  conversational: { primary: '#888780', ambient: 'rgba(136,135,128,0.02)', glow: 'rgba(136,135,128,0.05)', faintText: 'rgba(136,135,128,0.025)', word: 'SEARCH' },
} as const

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
  onOpenSettings?: () => void
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

function SearchAttachmentRow({ att, onSelect }: { att: { id: number; filename: string; chat_name: string; contact_name: string; created_at: string; thumbnail_path: string | null; is_image: boolean; matchReason: string }; onSelect: () => void }): JSX.Element {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  useEffect(() => {
    if (att.is_image && att.thumbnail_path) {
      window.api.getFileUrl(att.thumbnail_path).then(url => { if (url) setThumbUrl(url) }).catch(() => {})
    }
  }, [att.thumbnail_path, att.is_image])
  return (
    <div onClick={onSelect}
      style={{ padding: '10px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
      {thumbUrl ? (
        <img src={thumbUrl} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#F8F4F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{att.is_image ? '\u{1F5BC}' : '\u{1F4CE}'}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#1A1A1A', fontFamily: "'DM Sans'", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.filename || 'Attachment'}</div>
        <div style={{ fontSize: 10, color: '#9a948f', fontFamily: "'DM Sans'" }}>{att.contact_name} · {new Date(att.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      </div>
      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.04)', color: '#9a948f', fontFamily: "'DM Sans'", flexShrink: 0 }}>{att.matchReason}</span>
    </div>
  )
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

type TimelineEvent = { timestamp: string; type: string; description: string; metric?: number }
type GravityYear = { year: number; dominant: { name: string; count: number; pct: number }; top5: { name: string; count: number; pct: number }[]; clusterContacts: string[]; clusterLabel: string | null }

function SocialGravityCard({ individualYears, groupYears, chatNameMap, onSelectYear, highlightedYears }: {
  individualYears: GravityYear[]; groupYears: GravityYear[]; chatNameMap: Record<string, string>; onSelectYear?: (year: string) => void; highlightedYears?: Set<number>
}): JSX.Element | null {
  const [hoveredYear, setHoveredYear] = useState<number | null>(null)
  const [mode, setMode] = useState<'people' | 'groups'>('people')
  const years = mode === 'people' ? individualYears : groupYears
  if (individualYears.length < 2 && groupYears.length < 2) return null

  const getName = (raw: string) => {
    const n = (chatNameMap[raw] || raw).replace(/^#/, '').replace(/^\+/, '')
    if (mode === 'groups') return n.length > 14 ? n.slice(0, 13) + '\u2026' : n
    const first = n.split(' ')[0]
    return first.length > 10 ? first.slice(0, 9) + '\u2026' : first
  }
  const getFullName = (raw: string) => (chatNameMap[raw] || raw).replace(/^#/, '')
  const maxPct = years.length > 0 ? Math.max(...years.map(y => y.dominant.pct)) : 1
  const subtitle = mode === 'people' ? 'Who dominated your attention, year by year.' : 'Which group dominated your attention, year by year.'

  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '22px 24px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 600 }}>Social gravity</div>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: 2 }}>
          {(['people', 'groups'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: '3px 10px', borderRadius: 4, fontSize: 9, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'", letterSpacing: '0.06em', textTransform: 'uppercase', background: mode === m ? '#fff' : 'transparent', color: mode === m ? '#E8604A' : '#9a948f', fontWeight: mode === m ? 600 : 400, boxShadow: mode === m ? '0 1px 2px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s' }}>{m}</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 18, fontFamily: "'DM Sans'" }}>{subtitle}</div>

      {/* Timeline */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, position: 'relative' }}>
        {/* Baseline */}
        <div style={{ position: 'absolute', bottom: 28, left: 0, right: 0, height: 1, background: '#EAE5DF' }} />

        {years.map((y, i) => {
          const barH = Math.max(8, Math.round((y.dominant.pct / Math.max(maxPct, 1)) * 48))
          const isHov = hoveredYear === y.year || (highlightedYears?.has(y.year) ?? false)
          return (
            <div key={y.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', cursor: 'pointer', minWidth: 0 }}
              onMouseEnter={() => setHoveredYear(y.year)} onMouseLeave={() => setHoveredYear(null)}
              onClick={() => onSelectYear?.(String(y.year))}>
              {/* Name */}
              <div style={{ fontSize: 9, color: isHov ? '#E8604A' : '#6f6a65', fontFamily: "'DM Sans'", fontWeight: isHov ? 600 : 400, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', textAlign: 'center', transition: 'color 0.15s' }}>
                {getName(y.dominant.name)}
              </div>
              {/* Pct */}
              <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 11, color: isHov ? '#E8604A' : '#c8c0ba', marginBottom: 4, transition: 'color 0.15s' }}>
                {y.dominant.pct}%
              </div>
              {/* Bar */}
              <div style={{ width: 6, height: barH, borderRadius: 3, background: isHov ? '#E8604A' : '#EAE5DF', transition: 'background 0.15s, height 0.2s', marginBottom: 4 }} />
              {/* Dot */}
              <div style={{ width: isHov ? 8 : 6, height: isHov ? 8 : 6, borderRadius: '50%', background: isHov ? '#E8604A' : '#c8c0ba', transition: 'all 0.15s', marginBottom: 4, flexShrink: 0 }} />
              {/* Year label */}
              <div style={{ fontSize: 9, color: isHov ? '#1A1A1A' : '#b8b2ad', fontFamily: "'DM Sans'", fontWeight: isHov ? 600 : 400, transition: 'color 0.15s' }}>
                {String(y.year).slice(2)}
              </div>

              {/* Tooltip */}
              {isHov && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                  marginBottom: 8, background: 'rgba(0,0,0,0.92)', borderRadius: 10, padding: '12px 14px',
                  width: 190, zIndex: 10, pointerEvents: 'none',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, marginBottom: 8, fontFamily: "'DM Sans'" }}>{y.year}</div>
                  {y.top5.map((c, j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                      <span style={{ fontSize: 11, color: j === 0 ? '#E8604A' : 'rgba(255,255,255,0.7)', fontFamily: "'DM Sans'", fontWeight: j === 0 ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8 }}>{getFullName(c.name)}</span>
                      <span style={{ fontSize: 10, color: j === 0 ? '#E8604A' : 'rgba(255,255,255,0.4)', fontFamily: "'DM Sans'", flexShrink: 0 }}>{c.pct}%</span>
                    </div>
                  ))}
                  {(y.clusterLabel || y.clusterContacts.length > 0) && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8, paddingTop: 8 }}>
                      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 4, fontFamily: "'DM Sans'" }}>Cluster</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: "'DM Sans'" }}>
                        {y.clusterLabel || y.clusterContacts.map(c => getName(c)).join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type LifeChapter = { startYear: number; endYear: number; dominantContact: string; supportingContacts: string[] }

function computeChapters(years: GravityYear[]): LifeChapter[] {
  if (years.length === 0) return []
  const chapters: LifeChapter[] = []
  let cur: { startYear: number; endYear: number; dominant: string; allTop5: Set<string> } = {
    startYear: years[0].year, endYear: years[0].year,
    dominant: years[0].dominant.name,
    allTop5: new Set(years[0].top5.map(c => c.name))
  }

  for (let i = 1; i < years.length; i++) {
    const y = years[i]
    const sameDominant = y.dominant.name === cur.dominant
    const overlap = y.top5.filter(c => cur.allTop5.has(c.name)).length
    if (sameDominant || overlap >= 2) {
      cur.endYear = y.year
      for (const c of y.top5) cur.allTop5.add(c.name)
    } else {
      chapters.push({ startYear: cur.startYear, endYear: cur.endYear, dominantContact: cur.dominant, supportingContacts: [...cur.allTop5].filter(n => n !== cur.dominant).slice(0, 4) })
      cur = { startYear: y.year, endYear: y.year, dominant: y.dominant.name, allTop5: new Set(y.top5.map(c => c.name)) }
    }
  }
  chapters.push({ startYear: cur.startYear, endYear: cur.endYear, dominantContact: cur.dominant, supportingContacts: [...cur.allTop5].filter(n => n !== cur.dominant).slice(0, 4) })
  return chapters
}

function LifeChaptersCard({ personChapters, groupChapters, chatNameMap, onHoverChapter }: {
  personChapters: LifeChapter[]; groupChapters: LifeChapter[]; chatNameMap: Record<string, string>; onHoverChapter?: (years: Set<number> | null) => void
}): JSX.Element | null {
  const [mode, setMode] = useState<'people' | 'groups'>('people')
  const chapters = mode === 'people' ? personChapters : groupChapters
  if (personChapters.length < 2 && groupChapters.length < 2) return null

  const getName = (raw: string) => {
    const n = (chatNameMap[raw] || raw).replace(/^#/, '').replace(/^\+/, '')
    if (mode === 'groups') return n.length > 18 ? n.slice(0, 17) + '\u2026' : n
    const first = n.split(' ')[0]
    return first.length > 12 ? first.slice(0, 11) + '\u2026' : first
  }
  const getFullName = (raw: string) => (chatNameMap[raw] || raw).replace(/^#/, '')

  const yearSet = (ch: LifeChapter): Set<number> => {
    const s = new Set<number>()
    for (let y = ch.startYear; y <= ch.endYear; y++) s.add(y)
    return s
  }

  const subtitle = mode === 'people' ? 'The people eras of your messaging life.' : 'The group chat eras of your messaging life.'

  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '22px 24px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 600 }}>Life chapters</div>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 6, padding: 2 }}>
          {(['people', 'groups'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: '3px 10px', borderRadius: 4, fontSize: 9, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'", letterSpacing: '0.06em', textTransform: 'uppercase', background: mode === m ? '#fff' : 'transparent', color: mode === m ? '#E8604A' : '#9a948f', fontWeight: mode === m ? 600 : 400, boxShadow: mode === m ? '0 1px 2px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s' }}>{m}</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 18, fontFamily: "'DM Sans'" }}>{subtitle}</div>

      {chapters.length < 2 ? (
        <div style={{ fontSize: 12, color: '#c8c0ba', fontFamily: "'DM Sans'", padding: '8px 0' }}>Not enough data for {mode} chapters yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {chapters.map((ch, i) => {
            const span = ch.startYear === ch.endYear ? String(ch.startYear) : `${ch.startYear}\u2013${ch.endYear}`
            const isLast = i === chapters.length - 1
            return (
              <div key={i} style={{ display: 'flex', gap: 16, position: 'relative', paddingBottom: isLast ? 0 : 20, cursor: 'default' }}
                onMouseEnter={() => onHoverChapter?.(yearSet(ch))}
                onMouseLeave={() => onHoverChapter?.(null)}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0, paddingTop: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#E8604A', flexShrink: 0 }} />
                  {!isLast && <div style={{ width: 1, flex: 1, background: 'rgba(232,96,74,0.15)', marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingTop: 0 }}>
                  <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 16, color: '#1A1A1A', lineHeight: 1.3, marginBottom: 2 }}>
                    {getFullName(ch.dominantContact)} Era
                  </div>
                  <div style={{ fontSize: 12, color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 500, marginBottom: 4 }}>{span}</div>
                  {ch.supportingContacts.length > 0 && (
                    <div style={{ fontSize: 12, color: '#9a948f', fontFamily: "'DM Sans'" }}>
                      with {ch.supportingContacts.slice(0, 3).map(c => getName(c)).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type MemoryMoment = { type: string; title: string; subtitle: string; dateLabel: string; chatName: string | null; metric: number | null }

const MEMORY_ICONS: Record<string, string> = {
  on_this_day: '\u{1F4C5}', first_message: '\u{1F382}', biggest_day: '\u{1F525}',
  biggest_month: '\u{1F4CA}', streak: '\u{26A1}', intensity_echo: '\u{1F4C8}',
  comeback: '\u{1F504}', fading: '\u{1F305}', streak_anniversary: '\u{1F3AF}',
  heat_peak: '\u{1F336}'
}

function MemoryCard({ moments, chatNameMap }: { moments: MemoryMoment[]; chatNameMap: Record<string, string> }): JSX.Element | null {
  if (moments.length === 0) return null
  const resolve = (raw: string | null) => {
    if (!raw) return null
    const n = (chatNameMap[raw] || raw).replace(/^#/, '')
    return n.startsWith('+') ? null : n
  }
  const heroTypes = new Set(['comeback', 'fading'])
  const statTypes = new Set(['biggest_day', 'biggest_month', 'streak'])
  const sentimentalTypes = new Set(['on_this_day', 'first_message', 'streak_anniversary'])
  const signalTypes = new Set(['heat_peak', 'intensity_echo'])

  // Dynamic subtitle
  const subtitle = moments.some(m => m.type === 'comeback') ? 'Someone came back.'
    : moments.some(m => m.type === 'fading') ? 'Some things change.'
    : moments.some(m => m.type === 'on_this_day') ? 'This day in your history.'
    : 'Moments that defined your year.'

  let firstNonHeroSeen = false

  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '22px 24px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 600 }}>Memory</div>
        <div style={{ fontSize: 10, color: '#c8c0ba', fontFamily: "'DM Sans'" }}>{moments.length} moment{moments.length !== 1 ? 's' : ''}</div>
      </div>
      <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 18, fontFamily: "'DM Sans'" }}>{subtitle}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 12 }}>
        {moments.map((m, i) => {
          const name = resolve(m.chatName)
          const icon = MEMORY_ICONS[m.type] || '\u{2728}'
          const isHero = heroTypes.has(m.type)
          let span = 4
          if (isHero) span = 6
          else if (!firstNonHeroSeen) { span = 6; firstNonHeroSeen = true }

          // HERO cards (comeback, fading)
          if (isHero) {
            const isDark = m.type === 'comeback'
            return (
              <div key={i} style={{ gridColumn: `span ${span}`, borderRadius: 16, background: isDark ? '#1E2826' : '#F5EDE5', padding: '24px 22px', position: 'relative', overflow: 'hidden', minHeight: 140 }}>
                <div style={{ position: 'absolute', right: 16, top: 16, fontSize: 36, opacity: 0.3 }}>{icon}</div>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: isDark ? '#2EC4A0' : '#9a948f', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>{m.title}</div>
                <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 22, color: isDark ? '#fff' : '#1A1A1A', lineHeight: 1.3, marginBottom: 8 }}>{m.subtitle}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.5)' : '#9a948f', fontFamily: "'DM Sans'" }}>{m.dateLabel}</div>
                  {name && <div style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#2EC4A0' : '#E8604A', fontFamily: "'DM Sans'" }}>{name}</div>}
                </div>
              </div>
            )
          }

          // STAT cards (biggest_day, biggest_month, streak)
          if (statTypes.has(m.type)) {
            return (
              <div key={i} style={{ gridColumn: `span ${span}`, borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '18px 18px' }}>
                <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>{icon} {m.title}</div>
                {m.metric != null && <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: '#E8604A', lineHeight: 1, marginBottom: 6 }}>{typeof m.metric === 'number' && m.metric > 100 ? m.metric.toLocaleString() : m.metric}</div>}
                <div style={{ fontSize: 13, color: '#1A1A1A', lineHeight: 1.5, marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans'" }}>{m.subtitle}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>{m.dateLabel}</div>
                  {name && <div style={{ fontSize: 11, color: '#E8604A', fontWeight: 500, fontFamily: "'DM Sans'" }}>{name}</div>}
                </div>
              </div>
            )
          }

          // SENTIMENTAL cards (on_this_day, first_message, streak_anniversary)
          if (sentimentalTypes.has(m.type)) {
            return (
              <div key={i} style={{ gridColumn: `span ${span}`, borderRadius: 14, background: 'linear-gradient(135deg, #F8F4F0 0%, #FFF8F2 100%)', border: '1px solid rgba(232,96,74,0.08)', padding: '18px 18px' }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>{icon}</div>
                <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 6, fontWeight: 600, fontFamily: "'DM Sans'" }}>{m.title}</div>
                <div style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.5, marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans'" }}>{m.subtitle}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>{m.dateLabel}</div>
                  {name && <div style={{ fontSize: 11, color: '#2EC4A0', fontWeight: 500, fontFamily: "'DM Sans'" }}>{name}</div>}
                </div>
              </div>
            )
          }

          // SIGNAL cards (heat_peak, intensity_echo)
          if (signalTypes.has(m.type)) {
            const isDark = m.type === 'heat_peak'
            return (
              <div key={i} style={{ gridColumn: `span ${span}`, borderRadius: 14, background: isDark ? 'linear-gradient(135deg, #2D1F1A 0%, #1E2826 100%)' : '#F8F4F0', padding: '18px 18px' }}>
                <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: isDark ? '#E8604A' : '#2EC4A0', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>{icon} {m.title}</div>
                <div style={{ fontSize: 14, color: isDark ? 'rgba(255,255,255,0.75)' : '#1A1A1A', lineHeight: 1.5, marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans'" }}>{m.subtitle}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.4)' : '#9a948f', fontFamily: "'DM Sans'" }}>{m.dateLabel}</div>
                  {name && <div style={{ fontSize: 11, color: isDark ? '#E8604A' : '#2EC4A0', fontWeight: 500, fontFamily: "'DM Sans'" }}>{name}</div>}
                </div>
              </div>
            )
          }

          // Fallback (unknown type)
          return (
            <div key={i} style={{ gridColumn: `span ${span}`, borderRadius: 14, background: '#F8F4F0', padding: '18px 18px' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 6, fontWeight: 600, fontFamily: "'DM Sans'" }}>{m.title}</div>
              <div style={{ fontSize: 13, color: '#1A1A1A', lineHeight: 1.5, marginBottom: 6, fontWeight: 500, fontFamily: "'DM Sans'" }}>{m.subtitle}</div>
              <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>{m.dateLabel}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type TopicChapter = { startYear: number; endYear: number; startMonth?: number; endMonth?: number; topicLabel: string; keywords: string[]; strengthScore: number }

function TopicErasCard({ chapters, aiEnhanced }: { chapters: TopicChapter[]; aiEnhanced?: boolean }): JSX.Element | null {
  if (chapters.length < 1) return null
  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '22px 24px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 600 }}>Topic eras</div>
        {aiEnhanced && <div style={{ fontSize: 8, color: '#9a948f', background: 'rgba(232,96,74,0.08)', borderRadius: 4, padding: '2px 6px', fontFamily: "'DM Sans'", letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI enhanced</div>}
      </div>
      <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 18, fontFamily: "'DM Sans'" }}>Phases of your life, based on what you talked about.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {chapters.map((ch, i) => {
          const span = ch.startYear === ch.endYear ? String(ch.startYear) : `${ch.startYear}\u2013${ch.endYear}`
          const isLast = i === chapters.length - 1
          return (
            <div key={i} style={{ display: 'flex', gap: 16, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0, paddingTop: 4 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#E8604A', flexShrink: 0 }} />
                {!isLast && <div style={{ width: 1, flex: 1, background: 'rgba(232,96,74,0.15)', marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 16, color: '#1A1A1A', lineHeight: 1.3 }}>
                    {ch.topicLabel.endsWith(' Era') ? ch.topicLabel : ch.topicLabel}
                  </div>
                  {aiEnhanced && !ch.topicLabel.endsWith(' Era') && <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(127,119,221,0.12)', color: '#7F77DD', fontFamily: "'DM Sans'", letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>AI</span>}
                </div>
                <div style={{ fontSize: 12, color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 500, marginBottom: 6 }}>
                  {ch.startMonth ? (() => { const QN = ['', 'Q1', 'Q1', 'Q1', 'Q2', 'Q2', 'Q2', 'Q3', 'Q3', 'Q3', 'Q4', 'Q4', 'Q4']; return `${QN[ch.startMonth] || ''} ${ch.startYear}${ch.endYear !== ch.startYear || ch.endMonth !== ch.startMonth ? ` \u2013 ${QN[ch.endMonth || 12] || ''} ${ch.endYear}` : ''}` })() : span}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {ch.keywords.map(kw => (
                    <span key={kw} style={{ fontSize: 10, color: '#2EC4A0', background: 'rgba(46,196,160,0.08)', borderRadius: 12, padding: '3px 10px', fontFamily: "'DM Sans'" }}>{kw}</span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RelationshipTimelineCard({ events, firstName }: { events: TimelineEvent[]; firstName: string }): JSX.Element | null {
  if (events.length < 2) return null

  const formatDate = (ts: string, type: string): string => {
    const d = new Date(ts + 'T12:00:00')
    if (type === 'recent_activity') return 'Today'
    if (type === 'peak_year') return String(d.getFullYear())
    if (type === 'busiest_month') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', padding: '24px 28px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 4, fontFamily: "'DM Sans'", fontWeight: 600 }}>Relationship timeline</div>
      <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 20, fontFamily: "'DM Sans'" }}>Key moments with {firstName}.</div>
      <div style={{ position: 'relative', paddingLeft: 28 }}>
        {/* Vertical line */}
        <div style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 1, background: 'rgba(46,196,160,0.15)' }} />
        {events.map((ev, i) => {
          const isLast = i === events.length - 1
          const isFirst = i === 0
          return (
            <div key={i} style={{ position: 'relative', paddingBottom: isLast ? 0 : 22 }}>
              {/* Node dot */}
              <div style={{
                position: 'absolute', left: -28, top: 2,
                width: (isFirst || isLast) ? 11 : 9,
                height: (isFirst || isLast) ? 11 : 9,
                borderRadius: '50%',
                background: (isFirst || isLast) ? '#2EC4A0' : 'rgba(46,196,160,0.25)',
                border: (isFirst || isLast) ? '2px solid rgba(46,196,160,0.2)' : 'none',
                marginLeft: (isFirst || isLast) ? -1 : 0,
              }} />
              {/* Date label */}
              <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 15, color: '#1A1A1A', lineHeight: 1.3, marginBottom: 3 }}>
                {formatDate(ev.timestamp, ev.type)}
              </div>
              {/* Description */}
              <div style={{ fontSize: 13, color: '#6f6a65', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>
                {ev.description}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ConstellationCard({ network, chatNameMap, onSelectConversation }: {
  network: NetworkData; chatNameMap: Record<string, string>; onSelectConversation: (rawName: string) => void
}): JSX.Element | null {
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [graphMode, setGraphMode] = useState<'people' | 'communities' | 'groups' | 'bridges'>('people')
  const [hintDismissed, setHintDismissed] = useState(false)
  const DEFAULT_VB = { x: 0, y: 0, w: 600, h: 380 }
  const [viewBox, setViewBox] = useState(DEFAULT_VB)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  if (network.nodes.length < 4) return null

  const W = 600, H = 380, CX = W / 2, CY = H / 2
  const sorted = network.nodes
  const enableDimming = sorted.length <= 120
  const maxMsgCount = Math.max(...sorted.map(n => n.messageCount), 1)
  const nodeRadius = (mc: number) => Math.min(15, Math.max(3, 3 + Math.sqrt(mc / maxMsgCount) * 12))

  const rings = [
    { nodes: sorted.slice(0, 5), r: 85 },
    { nodes: sorted.slice(5, 14), r: 155 },
    { nodes: sorted.slice(14, 35), r: 215 },
  ]

  const positions = new Map<string, { x: number; y: number; size: number }>()
  for (const ring of rings) {
    ring.nodes.forEach((node, i) => {
      const angle = (i / Math.max(ring.nodes.length, 1)) * Math.PI * 2 - Math.PI / 2
      positions.set(node.rawName, { x: CX + Math.cos(angle) * ring.r, y: CY + Math.sin(angle) * ring.r, size: nodeRadius(node.messageCount) })
    })
  }

  const msgCountMap = new Map(sorted.map(n => [n.rawName, n.messageCount]))
  const getName = (raw: string) => { const c = (chatNameMap[raw] || raw).replace(/^#/, '').replace(/^\+/, '').split(' ')[0]; return c.length > 9 ? c.slice(0, 8) + '\u2026' : c }
  const getFullName = (raw: string) => (chatNameMap[raw] || raw).replace(/^#/, '')

  // Community clustering — union-find on primary edges
  const clusterMap = new Map<string, number>()
  const clusterColors = ['rgba(232,96,74,0.09)', 'rgba(46,196,160,0.09)', 'rgba(127,119,221,0.09)', 'rgba(186,117,23,0.07)', 'rgba(255,255,255,0.05)']
  const clusterStrokeColors = ['rgba(232,96,74,0.25)', 'rgba(46,196,160,0.25)', 'rgba(127,119,221,0.25)', 'rgba(186,117,23,0.2)', 'rgba(255,255,255,0.1)']
  {
    const parent = new Map<string, string>()
    const find = (x: string): string => { if (!parent.has(x)) parent.set(x, x); if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!)); return parent.get(x)! }
    const union = (a: string, b: string) => { parent.set(find(a), find(b)) }
    for (const e of network.edges) {
      if (positions.has(e.a) && positions.has(e.b) && e.sharedGroups >= 2) union(e.a, e.b)
    }
    const roots = new Map<string, string[]>()
    for (const name of positions.keys()) {
      const root = find(name)
      if (!roots.has(root)) roots.set(root, [])
      roots.get(root)!.push(name)
    }
    let clIdx = 0
    for (const members of roots.values()) {
      if (members.length >= 2) { for (const m of members) clusterMap.set(m, clIdx); clIdx++ }
    }
  }

  // Cluster hulls + labels
  const clusterHulls: { cx: number; cy: number; rx: number; ry: number; color: string; strokeColor: string; label: string }[] = []
  {
    const groups = new Map<number, string[]>()
    for (const [name, idx] of clusterMap) { if (!groups.has(idx)) groups.set(idx, []); groups.get(idx)!.push(name) }
    for (const [idx, members] of groups) {
      if (members.length < 2) continue
      const pts = members.map(m => positions.get(m)!).filter(Boolean)
      const avgX = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const avgY = pts.reduce((s, p) => s + p.y, 0) / pts.length
      const maxDx = Math.max(...pts.map(p => Math.abs(p.x - avgX)), 20)
      const maxDy = Math.max(...pts.map(p => Math.abs(p.y - avgY)), 20)
      // Label: dominant node by message count
      const dominant = members.sort((a, b) => (msgCountMap.get(b) || 0) - (msgCountMap.get(a) || 0))[0]
      const label = dominant ? getName(dominant) : ''
      clusterHulls.push({ cx: avgX, cy: avgY, rx: maxDx + 35, ry: maxDy + 35, color: clusterColors[idx % clusterColors.length], strokeColor: clusterStrokeColors[idx % clusterStrokeColors.length], label })
    }
  }

  const edgeCounts = new Map<string, number>()
  for (const e of network.edges) {
    if (positions.has(e.a)) edgeCounts.set(e.a, (edgeCounts.get(e.a) || 0) + 1)
    if (positions.has(e.b)) edgeCounts.set(e.b, (edgeCounts.get(e.b) || 0) + 1)
  }
  const bridgeEntry = [...edgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const bridgeName = bridgeEntry?.[0]
  const visibleEdges = network.edges.filter(e => positions.has(e.a) && positions.has(e.b))
  const primaryThreshold = 2
  const filteredEdges = visibleEdges

  const activeNode = focused || hovered
  const connectedSet = new Set<string>()
  if (activeNode) {
    connectedSet.add(activeNode)
    for (const e of filteredEdges) {
      if (e.a === activeNode) connectedSet.add(e.b)
      if (e.b === activeNode) connectedSet.add(e.a)
    }
  }

  const handleNodeClick = (rawName: string) => { if (!isPanning) setFocused(focused === rawName ? null : rawName) }
  const handleBgClick = () => { if (focused && !isPanning) setFocused(null) }

  // Pan handlers
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    setIsPanning(false)
    setPanStart({ x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!(e.buttons & 1)) return
    const svg = svgRef.current; if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = viewBox.w / rect.width, scaleY = viewBox.h / rect.height
    const dx = (e.clientX - panStart.x) * scaleX, dy = (e.clientY - panStart.y) * scaleY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) setIsPanning(true)
    setViewBox({ ...viewBox, x: panStart.vx - dx, y: panStart.vy - dy })
  }
  const onPointerUp = () => { setTimeout(() => setIsPanning(false), 50) }
  // FIX 1: Cmd/Ctrl+wheel only, tighter bounds, slower zoom
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!e.metaKey && !e.ctrlKey) return // only zoom on Cmd/Ctrl+scroll or pinch
    e.preventDefault()
    const svg = svgRef.current; if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x
    const my = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y
    const factor = e.deltaY > 0 ? 1.08 : 0.92
    const nw = Math.max(300, Math.min(900, viewBox.w * factor))
    const nh = Math.max(190, Math.min(570, viewBox.h * factor))
    setViewBox({ x: mx - (mx - viewBox.x) * (nw / viewBox.w), y: my - (my - viewBox.y) * (nh / viewBox.h), w: nw, h: nh })
  }

  const isCommunities = graphMode === 'communities'
  const isGroups = graphMode === 'groups'
  const isBridges = graphMode === 'bridges'

  // Bridge contacts: nodes with edges to 3+ clusters
  const bridgeNodes = new Set<string>()
  for (const [name] of edgeCounts) {
    const clusters = new Set<number>()
    for (const e of filteredEdges) {
      if (e.a === name) { const c = clusterMap.get(e.b); if (c !== undefined) clusters.add(c) }
      if (e.b === name) { const c = clusterMap.get(e.a); if (c !== undefined) clusters.add(c) }
    }
    if (clusters.size >= 3) bridgeNodes.add(name)
  }

  // Groups for focused person
  const groupsForFocused = focused ? (network.groups || []).filter(g => g.members.includes(focused)) : []
  const focusedPos = focused ? positions.get(focused) : null

  return (
    <div style={{ gridColumn: 'span 12', borderRadius: 18, background: '#1A1815', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 4px 24px rgba(0,0,0,0.2)', padding: '22px 24px 16px', position: 'relative' }}>
      <style>{`@keyframes nodePulse{0%,100%{r:var(--nr)}50%{r:calc(var(--nr) + 1.5px)}} @keyframes focusRing{0%{stroke-dashoffset:0}100%{stroke-dashoffset:-20}} @keyframes focusGlow{0%,100%{opacity:0.35}50%{opacity:0.7}}`}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(232,96,74,0.65)', marginBottom: 6, fontFamily: "'DM Sans'" }}>Your messaging network</div>
          <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 15, color: '#fff', lineHeight: 1.4 }}>{network.nodes.length} people · {filteredEdges.length} connections.</div>
        </div>
        {bridgeName && positions.has(bridgeName) && !focused && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(232,96,74,0.7)', marginBottom: 3, fontFamily: "'DM Sans'" }}>Bridge contact</div>
            <div style={{ fontSize: 16, color: '#E8604A', fontFamily: "'DM Sans'", fontWeight: 600 }}>{getName(bridgeName)}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'DM Sans'" }}>{edgeCounts.get(bridgeName)} shared groups</div>
          </div>
        )}
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 7, padding: 2, marginBottom: 6, width: 'fit-content' }}>
        {([['people', 'People'], ['communities', 'Communities'], ['groups', 'Groups'], ['bridges', 'Bridges']] as const).map(([mode, label]) => (
          <button key={mode} onClick={() => setGraphMode(mode as typeof graphMode)}
            style={{ padding: '3px 10px', borderRadius: 5, fontSize: 9, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'", letterSpacing: '0.06em', textTransform: 'uppercase',
              background: graphMode === mode ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: graphMode === mode ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)', transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
        {/* Reset view button */}
        {(viewBox.w !== DEFAULT_VB.w || viewBox.x !== DEFAULT_VB.x) && (
          <button onClick={() => setViewBox(DEFAULT_VB)}
            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 9, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans'", color: 'rgba(255,255,255,0.3)', background: 'transparent', marginLeft: 4 }}>
            reset
          </button>
        )}
      </div>

      {/* FIX 3 + FIX 5: Graph + detail panel layout, taller container */}
      <div style={{ display: 'flex', gap: 0, minHeight: 420 }}>
        <svg ref={svgRef} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          style={{ flex: focused ? '0 0 75%' : '1', height: 'auto', minHeight: 400, display: 'block', cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none', transition: 'flex 0.2s' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onWheel={onWheel} onClick={handleBgClick}>

          <defs><filter id="clusterBlur"><feGaussianBlur stdDeviation="28" /></filter></defs>
          {clusterHulls.map((h, i) => (
            <g key={i}>
              <ellipse cx={h.cx} cy={h.cy} rx={h.rx} ry={h.ry}
                fill={isCommunities ? h.color.replace(/[\d.]+\)$/, m => `${parseFloat(m) * 2})`) : h.color}
                filter="url(#clusterBlur)" />
              {isCommunities && <ellipse cx={h.cx} cy={h.cy} rx={h.rx * 0.7} ry={h.ry * 0.7}
                fill="none" stroke={h.strokeColor} strokeWidth={0.5} strokeDasharray="4 3" />}
              {isCommunities && h.label && <text x={h.cx} y={h.cy - h.ry * 0.7 - 6} textAnchor="middle"
                style={{ fontSize: 7, fill: h.strokeColor, fontFamily: 'DM Sans', letterSpacing: '0.1em' }}>{h.label}</text>}
            </g>
          ))}

          {rings.map((ring, i) => <circle key={i} cx={CX} cy={CY} r={ring.r} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth={0.5} />)}

          {/* FIX 2: Edge termination at node boundary */}
          {filteredEdges.map((edge, i) => {
            const a = positions.get(edge.a)!, b = positions.get(edge.b)!
            const dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy)
            if (dist === 0) return null
            const ux = dx / dist, uy = dy / dist
            const rA = a.size + 1, rB = b.size + 1
            const x1 = a.x + ux * rA, y1 = a.y + uy * rA
            const x2 = b.x - ux * rB, y2 = b.y - uy * rB

            const isHot = activeNode === edge.a || activeNode === edge.b
            const isDimmed = enableDimming && activeNode && !isHot
            const isPrimary = edge.sharedGroups >= primaryThreshold
            const sw = Math.min(4, 0.6 + edge.sharedGroups * 0.5)

            // Communities mode: dim cross-cluster, brighten within-cluster
            let edgeOpacity = isDimmed ? 0.03 : 1
            if (isCommunities && !isHot && !isDimmed) {
              const cA = clusterMap.get(edge.a), cB = clusterMap.get(edge.b)
              edgeOpacity = (cA !== undefined && cA === cB) ? 1 : 0.08
            }

            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isHot ? 'rgba(255,255,255,0.25)' : (isCommunities && clusterMap.get(edge.a) === clusterMap.get(edge.b)) ? 'rgba(255,255,255,0.15)' : isPrimary ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'}
              strokeWidth={isHot ? sw + 0.4 : sw} strokeDasharray={isPrimary ? 'none' : '3 3'}
              opacity={edgeOpacity} style={{ transition: 'opacity 0.15s' }} />
          })}

          <circle cx={CX} cy={CY} r={6} fill="#E8604A" />
          <circle cx={CX} cy={CY} r={10} fill="none" stroke="rgba(232,96,74,0.15)" strokeWidth={0.8} />
          <text x={CX} y={CY + 20} textAnchor="middle" style={{ fontSize: 6, fill: 'rgba(232,96,74,0.45)', fontFamily: 'DM Sans', letterSpacing: '0.12em' }}>YOU</text>

          {rings.flatMap(ring => ring.nodes.map(node => {
            const pos = positions.get(node.rawName)
            if (!pos) return null
            const isHov = hovered === node.rawName, isFoc = focused === node.rawName
            const isBridge = node.rawName === bridgeName, isConnected = connectedSet.has(node.rawName)
            const isDimmed = enableDimming && activeNode && !isConnected
            const fill = isFoc ? '#2EC4A0' : (isBridges && bridgeNodes.has(node.rawName)) ? '#E8604A' : isBridge ? '#E8604A' : isHov ? '#2EC4A0' : 'rgba(210,200,190,0.35)'
            const r = (isHov || isFoc) ? pos.size + 1 : pos.size
            const showLabel = pos.size >= 5 || isHov || isFoc
            const sharedCount = edgeCounts.get(node.rawName) || 0
            return (
              <g key={node.rawName} style={{ cursor: 'pointer', transition: 'opacity 0.2s' }} opacity={isDimmed ? 0.08 : (isBridges && !bridgeNodes.has(node.rawName) && !isFoc && !isConnected) ? 0.12 : 1}
                onMouseEnter={() => setHovered(node.rawName)} onMouseLeave={() => setHovered(null)}
                onClick={(e) => { e.stopPropagation(); handleNodeClick(node.rawName) }}>
                <circle cx={pos.x} cy={pos.y} r={Math.max(r, 10)} fill="transparent" />
                {isFoc && <>
                  <circle cx={pos.x} cy={pos.y} r={r + 12} fill="none" stroke="rgba(46,196,160,0.18)" strokeWidth={5} style={{ animation: 'focusGlow 2s ease-in-out infinite' }} />
                  <circle cx={pos.x} cy={pos.y} r={r + 7} fill="none" stroke="rgba(46,196,160,0.7)" strokeWidth={0.8} strokeDasharray="3 2.5" style={{ animation: 'focusRing 1.5s linear infinite' }} />
                </>}
                <circle cx={pos.x} cy={pos.y} r={r} fill={fill}
                  style={isHov && !isFoc ? { animation: 'nodePulse 1.4s ease-in-out infinite', ['--nr' as string]: `${r}px` } : {}} />
                {showLabel && <text x={pos.x} y={pos.y + r + 9} textAnchor="middle"
                  style={{ fontSize: pos.size >= 10 ? 8 : 7, fill: (isHov || isFoc) ? '#fff' : 'rgba(255,255,255,0.55)', fontFamily: 'DM Sans', pointerEvents: 'none', fontWeight: (isHov || isFoc) ? 500 : 400, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>
                  {getName(node.rawName)}
                </text>}
                {/* Compact hover tooltip (only for non-focused nodes) */}
                {isHov && !isFoc && (
                  <g>
                    <rect x={pos.x - 60} y={pos.y - r - 26} width={120} height={20} rx={4}
                      fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
                    <text x={pos.x} y={pos.y - r - 13} textAnchor="middle" style={{ fontSize: 8, fill: 'rgba(255,255,255,0.7)', fontFamily: 'DM Sans' }}>
                      {(msgCountMap.get(node.rawName) || 0).toLocaleString()} msgs · {sharedCount} grp{sharedCount !== 1 ? 's' : ''}
                    </text>
                  </g>
                )}
              </g>
            )
          }))}

          {/* Group nodes in Shared Groups mode */}
          {isGroups && focused && positions.get(focused) && groupsForFocused.map((g, i) => {
            const fp = positions.get(focused)!
            const angle = (i / Math.max(groupsForFocused.length, 1)) * Math.PI * 2 - Math.PI / 2
            const gx = fp.x + Math.cos(angle) * 110
            const gy = fp.y + Math.sin(angle) * 110
            return (
              <g key={g.chatId}>
                <line x1={fp.x} y1={fp.y} x2={gx} y2={gy} stroke="rgba(46,196,160,0.4)" strokeWidth={1.2} />
                {g.members.filter(m => m !== focused && positions.has(m)).map(m => {
                  const mp = positions.get(m)!
                  return <line key={m} x1={gx} y1={gy} x2={mp.x} y2={mp.y} stroke="rgba(232,96,74,0.15)" strokeWidth={0.8} strokeDasharray="4 3" />
                })}
                <rect x={gx - 42} y={gy - 11} width={84} height={22} rx={4} fill="rgba(232,96,74,0.85)" stroke="rgba(232,96,74,0.4)" strokeWidth={0.5} />
                <text x={gx} y={gy + 4} textAnchor="middle" style={{ fontSize: 7, fill: '#fff', fontFamily: 'DM Sans', fontWeight: 500 }}>
                  {g.displayName.length > 12 ? g.displayName.slice(0, 11) + '\u2026' : g.displayName}
                </text>
              </g>
            )
          })}

          {/* Groups mode hint when nothing selected */}
          {isGroups && !focused && (
            <text x={CX} y={CY + 50} textAnchor="middle" style={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)', fontFamily: 'DM Sans' }}>Select a person to see their shared groups</text>
          )}
        </svg>

        {/* Right-rail detail panel for focused node */}
        {focused && (() => {
          const fEdgeCount = edgeCounts.get(focused) || 0
          const fMsgCount = msgCountMap.get(focused) || 0
          const fCluster = clusterMap.get(focused)
          const fIsBridge = focused === bridgeName
          const fIsBridgeNode = bridgeNodes.has(focused)
          return (
            <div style={{ flex: '0 0 25%', padding: '8px 0 8px 16px', borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
              <div>
                <div style={{ fontSize: 16, color: '#2EC4A0', fontFamily: "'DM Sans'", fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getFullName(focused)}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: "'DM Sans'" }}>{fMsgCount.toLocaleString()} messages</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'DM Sans'", marginTop: 2 }}>{fEdgeCount} shared group{fEdgeCount !== 1 ? 's' : ''}</div>
              </div>
              {(fIsBridge || fIsBridgeNode) && (
                <div style={{ padding: '6px 10px', background: 'rgba(232,96,74,0.08)', borderRadius: 6, fontSize: 10, color: '#E8604A', fontFamily: "'DM Sans'" }}>
                  {fIsBridge ? 'Your #1 bridge contact' : 'Bridge — connects multiple clusters'}
                </div>
              )}
              {/* Mode-specific content */}
              {isGroups && groupsForFocused.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 6, fontFamily: "'DM Sans'" }}>Shared groups</div>
                  {groupsForFocused.map(g => (
                    <div key={g.chatId} style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: "'DM Sans'", padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      {g.displayName.length > 20 ? g.displayName.slice(0, 19) + '\u2026' : g.displayName}
                      <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 6 }}>{g.members.length} members</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: 'rgba(232,96,74,0.6)', marginTop: 6, fontFamily: "'DM Sans'" }}>Appears in {groupsForFocused.length} group{groupsForFocused.length !== 1 ? 's' : ''}</div>
                </div>
              )}
              {isBridges && fIsBridgeNode && (
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 4, fontFamily: "'DM Sans'" }}>Bridge role</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: "'DM Sans'" }}>
                    {(() => { const clusters = new Set<number>(); for (const e of filteredEdges) { if (e.a === focused) { const c = clusterMap.get(e.b); if (c !== undefined) clusters.add(c) } if (e.b === focused) { const c = clusterMap.get(e.a); if (c !== undefined) clusters.add(c) } } return `Connects ${clusters.size} separate clusters` })()}
                  </div>
                </div>
              )}
              {!isGroups && !isBridges && fCluster !== undefined && (
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 4, fontFamily: "'DM Sans'" }}>Cluster</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: "'DM Sans'" }}>
                    {(() => { const members = [...clusterMap.entries()].filter(([, idx]) => idx === fCluster).map(([name]) => getName(name)); return members.slice(0, 4).join(', ') + (members.length > 4 ? ` +${members.length - 4}` : '') })()}
                  </div>
                </div>
              )}
              <button onClick={() => { onSelectConversation(focused); setFocused(null) }}
                style={{ marginTop: 'auto', padding: '8px 12px', borderRadius: 8, background: 'rgba(46,196,160,0.1)', border: '1px solid rgba(46,196,160,0.2)', color: '#2EC4A0', fontSize: 11, fontFamily: "'DM Sans'", fontWeight: 500, cursor: 'pointer' }}>
                View relationship &rarr;
              </button>
              <button onClick={() => setFocused(null)}
                style={{ padding: '6px 12px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: "'DM Sans'", cursor: 'pointer' }}>
                Deselect
              </button>
            </div>
          )
        })()}
      </div>

      <div style={{ display: 'flex', gap: 14, paddingTop: 4, flexWrap: 'wrap' }}>
        {[
          { visual: <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}><div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} /><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} /></div>, label: 'Size = messages' },
          { visual: <div style={{ width: 14, height: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 1 }} />, label: 'Edge = shared groups' },
          { visual: <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#E8604A' }} />, label: 'Bridge' },
          { visual: <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#2EC4A0' }} />, label: 'Selected' },
          ...(isGroups ? [{ visual: <div style={{ width: 12, height: 7, borderRadius: 2, background: 'rgba(232,96,74,0.85)' }} />, label: 'Group' }] : []),
        ].map(({ visual, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {visual}
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: "'DM Sans'" }}>{label}</div>
          </div>
        ))}
      </div>
      {!focused && !hintDismissed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'DM Sans'" }}>Click a person to explore their connections</span>
          <button onClick={() => setHintDismissed(true)} style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>OK</button>
        </div>
      )}
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

export function Dashboard({ stats, chatNameMap, onSelectConversation, dateRange = 'all', scopedPerson, onClearScope, insightSurface = 'relationship', onSurfaceChange, isStatsLoading, onDrillThrough, onOpenSettings }: Props): JSX.Element {
  const currentMonth = MONTH_NAMES[new Date().getMonth()]
  const heroText = heroTitle(dateRange)
  const chats = stats.chatNames as ChatNameEntry[]

  const individuals = chats.filter((c) => !c.isGroup && (c.sentCount + c.receivedCount) > 0)
  const groups = chats.filter((c) => c.isGroup)

  // Sorted lists — individuals only for person-level tiles
  // Rate-based rankings (per 100 messages, minimum thresholds)
  const byLaughsGenerated = [...individuals].filter(c => c.messageCount >= 200).sort((a, b) => (b.laughsGenerated / b.messageCount) - (a.laughsGenerated / a.messageCount))
  const byLaughsReceived = [...individuals].filter(c => c.messageCount >= 200).sort((a, b) => (b.laughsReceived / b.messageCount) - (a.laughsReceived / a.messageCount))
  const byMessages = [...chats].sort((a, b) => b.messageCount - a.messageCount) // total volume, not rate
  const byAttachments = [...chats].filter(c => c.messageCount >= 100).sort((a, b) => (b.attachmentCount / b.messageCount) - (a.attachmentCount / a.messageCount))
  const byInitiation = [...individuals].sort((a, b) => b.initiationCount - a.initiationCount)
  const topGroup = [...groups].sort((a, b) => b.messageCount - a.messageCount)[0]

  const [todayMemories, setTodayMemories] = useState<MemoryItem[]>([])
  const [networkData, setNetworkData] = useState<NetworkData | null>(null)
  const [closenessData, setClosenessData] = useState<{ chat_identifier: string; total_score: number; tier: string }[]>([])
  useEffect(() => { window.api.getClosenessScores().then(d => setClosenessData(d as { chat_identifier: string; total_score: number; tier: string }[])).catch(() => {}) }, [])
  type UsageData = { totalMessages: number; sentMessages: number; receivedMessages: number; messagesPerYear: { year: number; count: number }[]; busiestDay: { date: string; count: number } | null; busiestYear: { year: number; count: number } | null; activeConversations: number }
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [gravityIndiv, setGravityIndiv] = useState<GravityYear[]>([])
  const [gravityGroups, setGravityGroups] = useState<GravityYear[]>([])
  const [chapterHighlight, setChapterHighlight] = useState<Set<number> | null>(null)
  const [topicEras, setTopicEras] = useState<TopicChapter[]>([])
  const [memoryMoments, setMemoryMoments] = useState<MemoryMoment[]>([])
  const [aiEnrichedTopics, setAiEnrichedTopics] = useState(false)
  const [aiEnrichedMemory, setAiEnrichedMemory] = useState(false)

  // ── STAGED HYDRATION: fast first paint, then progressive loading ──
  const hydrateStart = useRef(Date.now())

  // Usage stats re-fetches on dateRange change (lightweight, always needed)
  useEffect(() => {
    const t0 = Date.now()
    const bounds: { from?: string; to?: string } = {}
    if (dateRange === '7days') { const d = new Date(); d.setDate(d.getDate()-7); bounds.from = d.toISOString().split('T')[0] }
    else if (dateRange === '30days') { const d = new Date(); d.setDate(d.getDate()-30); bounds.from = d.toISOString().split('T')[0] }
    else if (dateRange === 'month') { bounds.from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0] }
    else if (dateRange === 'year') { bounds.from = `${new Date().getFullYear()}-01-01` }
    else if (/^\d{4}$/.test(dateRange || '')) { bounds.from = `${dateRange}-01-01`; bounds.to = `${dateRange}-12-31` }
    else if (/^\d{4}-\d{2}$/.test(dateRange || '')) { const [y,m] = (dateRange||'').split('-'); bounds.from = `${y}-${m}-01`; bounds.to = new Date(+y, +m, 0).toISOString().split('T')[0] }
    window.api.getUsageStats(bounds.from, bounds.to).then(r => { setUsageData(r); console.log(`[PERF] getUsageStats: ${Date.now()-t0}ms`) }).catch(() => {})
  }, [dateRange])

  // Stage B: lightweight above-the-fold (next tick after mount)
  useEffect(() => {
    const t0 = Date.now()
    window.api.getTodayInHistory().then(r => { setTodayMemories(r); console.log(`[PERF] getTodayInHistory: ${Date.now()-t0}ms`) }).catch(() => {})
  }, [])

  // Stage C: heavy network/gravity (deferred 80ms to let shell paint)
  useEffect(() => {
    const timer = setTimeout(() => {
      const t0 = Date.now()
      Promise.all([
        window.api.getMessagingNetwork().then(r => { setNetworkData(r); console.log(`[PERF] getMessagingNetwork: ${Date.now()-t0}ms`) }),
        window.api.getSocialGravity().then(r => { setGravityIndiv(r.individualYears); setGravityGroups(r.groupYears); console.log(`[PERF] getSocialGravity: ${Date.now()-t0}ms`) }),
      ]).catch(() => {})
    }, 80)
    return () => clearTimeout(timer)
  }, [])

  // Stage D: heaviest deterministic sections (deferred 250ms)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const t0 = Date.now()
      // Topic Eras + Memory in parallel (deterministic first)
      const [erasResult, momentsResult] = await Promise.all([
        window.api.getTopicEras().then(r => { console.log(`[PERF] getTopicEras: ${Date.now()-t0}ms`); return r }).catch(() => ({ chapters: [] as TopicChapter[] })),
        window.api.getMemoryMoments().then(r => { console.log(`[PERF] getMemoryMoments: ${Date.now()-t0}ms`); return r }).catch(() => ({ moments: [] as MemoryMoment[] })),
      ])

      if (cancelled) return
      const baseEras = erasResult.chapters
      console.log('[UI] Topic Eras received from backend:', JSON.stringify(baseEras.map(e => ({ label: e.topicLabel, kw: e.keywords }))))
      setTopicEras(baseEras)
      setMemoryMoments(momentsResult.moments)
      console.log(`[PERF] Stage D deterministic: ${Date.now()-t0}ms`)

      // Stage E: AI enrichment (never blocks, runs after deterministic renders)
      try {
        const status = await window.api.getAIStatus()
        if (!status.configured) { console.log(`[PERF] Total hydrate: ${Date.now()-hydrateStart.current}ms (no AI)`); return }

        // Topic Eras AI enrichment
        if (baseEras.length > 0) {
          const t1 = Date.now()
          console.log('[PERF] Starting Topic Eras AI enrichment...')
          const { contexts } = await window.api.getTopicEraContext(baseEras.map(e => ({ startYear: e.startYear, endYear: e.endYear, topicLabel: e.topicLabel, keywords: e.keywords })))
          console.log(`[PERF] getTopicEraContext: ${Date.now()-t1}ms`)
          const t2 = Date.now()
          const enrichments = await window.api.enrichTopicErasV2(contexts)
          console.log(`[PERF] enrichTopicErasV2: ${Date.now()-t2}ms`)
          if (!cancelled && enrichments && enrichments.length > 0) {
            const enriched: TopicChapter[] = []
            for (let i = 0; i < baseEras.length; i++) {
              const e = enrichments[i]
              if (!e || e.suppress) continue
              enriched.push({ ...baseEras[i], topicLabel: e.enrichedLabel || baseEras[i].topicLabel })
            }
            if (enriched.length > 0 && enriched.length >= Math.floor(baseEras.length / 2)) {
              console.log('[UI] Topic Eras ENRICHED:', JSON.stringify(enriched.map(e => ({ label: e.topicLabel, kw: e.keywords }))))
              setTopicEras(enriched); setAiEnrichedTopics(true)
            }
          }
        }

        // Memory AI enrichment
        if (momentsResult.moments.length > 0) {
          const t3 = Date.now()
          const input = momentsResult.moments.map(m => ({ type: m.type, title: m.title, subtitle: m.subtitle, dateLabel: m.dateLabel, contactName: m.chatName, metric: m.metric }))
          const enrichments = await window.api.enrichMemoryMoments(input)
          console.log(`[PERF] enrichMemoryMoments: ${Date.now()-t3}ms`)
          if (!cancelled && enrichments && enrichments.length > 0) {
            setAiEnrichedMemory(true)
            setMemoryMoments(prev => prev.map((moment, i) => {
              const e = enrichments[i]
              if (!e) return moment
              return { ...moment, title: e.enrichedTitle || moment.title, subtitle: e.enrichedSubtitle || moment.subtitle }
            }))
          }
        }

        console.log(`[PERF] Total hydrate (with AI): ${Date.now()-hydrateStart.current}ms`)
      } catch (err) { console.error('[PERF] AI enrichment failed:', err) }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

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

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  useEffect(() => {
    if (scopedPerson) {
      window.api.getRelationshipTimeline(scopedPerson).then(r => setTimelineEvents(r.events)).catch(() => setTimelineEvents([]))
    } else setTimelineEvents([])
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

  type SearchResultData = {
    type: 'ranked_contacts' | 'messages' | 'aggregation' | 'timeline' | 'conversational'
    explanation: string
    ranked?: { contact: string; value: number; label: string }[]
    messages?: { body: string; chat_name: string; sent_at: string; is_from_me: number; snippet: string }[]
    aggregation?: { contact: string; count: number; samples: { body: string; sent_at: string; is_from_me: number }[] }[]
    timeline?: { period: string; value: number }[]
    answer?: string; sources?: string[]; followUp?: string | null
  }
  const [searchResult, setSearchResult] = useState<SearchResultData | null>(null)

  // Search V2 state
  type SearchResultV2Data = {
    plan: { people: string[]; topic: string | null; keywords: string[]; timeRange: { start: string | null; end: string | null; description: string } | null; modalities: string; originalQuery: string; confidence: number }
    sections: {
      messages: { body: string; chat_name: string; contact_name: string; is_from_me: boolean; sent_at: string; matchReason: string; relevanceScore: number }[]
      attachments: { id: number; filename: string; chat_name: string; contact_name: string; created_at: string; thumbnail_path: string | null; is_image: boolean; matchReason: string; ocrSnippet?: string }[]
      conversations: { chat_name: string; contact_name: string; messageCount: number; matchingMessages: number; dateRange: string; preview: string }[]
      summary: string | null
    }
    totalResults: number; searchTimeMs: number
  }
  const [searchResultV2, setSearchResultV2] = useState<SearchResultV2Data | null>(null)

  const SEARCH_EXAMPLES = [
    'Messages with Ash about the cabo trip',
    'Photos Tyler sent me last summer',
    'When did I first mention Stash?',
    'Screenshots from the apartment search',
    'Who did I talk to most in March 2024?',
    'Links shared about crypto',
    'What were we planning for New Years?',
  ]
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setPlaceholderIdx(i => (i + 1) % SEARCH_EXAMPLES.length), 4000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => { if (!msgQuery) { setSearchResult(null); setSearchResultV2(null); setMsgResults(null) } }, [msgQuery])

  const handleMsgSearch = async (): Promise<void> => {
    if (!msgQuery.trim() || msgSearching) return
    setMsgSearching(true)
    setSearchResult(null)
    setSearchResultV2(null)
    setMsgResults(null)

    const query = msgQuery.trim()

    // Try Search V2 first
    try {
      const result = await window.api.executeSearchV2(query, scopedPerson || undefined)
      if (result && result.totalResults > 0) {
        setSearchResultV2(result)
        setMsgSearching(false)
        return
      }
    } catch (err) { console.error('[Search] V2 failed:', err) }

    // Fallback: literal FTS
    try { setMsgResults(await window.api.searchMessages(query, scopedPerson || undefined, 30)) }
    catch { setMsgResults([]) }
    finally { setMsgSearching(false) }
  }

  const isIndexed = msgIndexStatus && msgIndexStatus.indexed > 0
  const indexPct = msgIndexStatus && msgIndexStatus.total > 0 ? Math.round((msgIndexStatus.indexed / msgIndexStatus.total) * 100) : 0

  const formatTier = (tier: string): string => tier === 'inner_circle' ? 'Inner Circle' : tier.charAt(0).toUpperCase() + tier.slice(1)
  const tierColor = (tier: string): string => tier === 'inner_circle' ? '#2EC4A0' : tier === 'close' ? 'rgba(46,196,160,0.6)' : tier === 'regular' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)'

  // ── Media intelligence (must be before early return) ──
  const [mediaData, setMediaData] = useState<{ topSenders: { chatName: string; count: number }[]; topReceivers: { chatName: string; count: number }[]; myMediaCount: number; theirMediaCount: number; totalMedia: number; imageCount: number; videoCount: number; documentCount: number; peakMediaMonth: { month: string; count: number } | null; mediaHeavy: { chatName: string; mediaCount: number; ratio: number }[] } | null>(null)
  const [globalMedia, setGlobalMedia] = useState<{ topSenders: { chatName: string; count: number }[]; topReceivers: { chatName: string; count: number }[]; mediaHeavy: { chatName: string; mediaCount: number; ratio: number }[] } | null>(null)
  useEffect(() => {
    if (scopedPerson) window.api.getMediaIntelligence(scopedPerson).then(d => setMediaData(d as typeof mediaData)).catch(() => {})
    else { setMediaData(null); window.api.getMediaIntelligence().then(d => setGlobalMedia(d as typeof globalMedia)).catch(() => {}) }
  }, [scopedPerson])

  // ── Monthly averages (must be before early return) ──
  const [monthlyData, setMonthlyData] = useState<{ months: { month: string; count: number; isAnomaly: boolean; anomalyType: 'spike' | 'drop' | null }[]; avgPerMonth: number; anomalies: { month: string; count: number; type: string; message: string }[] } | null>(null)
  const [globalMonthly, setGlobalMonthly] = useState<{ months: { month: string; count: number; isAnomaly: boolean; anomalyType: 'spike' | 'drop' | null }[]; avgPerMonth: number; anomalies: { month: string; count: number; type: string; message: string }[] } | null>(null)
  useEffect(() => {
    if (scopedPerson) window.api.getMonthlyAverages(scopedPerson).then(setMonthlyData).catch(() => {})
    else { setMonthlyData(null); window.api.getMonthlyAverages().then(setGlobalMonthly).catch(() => {}) }
  }, [scopedPerson])

  // ── Relationship dynamics (must be before early return) ──
  const [dynamics, setDynamics] = useState<{ myTotalWords: number; theirTotalWords: number; effortRatio: number; myQuestions: number; theirQuestions: number; myPositiveRate: number; theirPositiveRate: number; myNegativeRate: number; theirNegativeRate: number; myAvgReplyMinutes: number; theirAvgReplyMinutes: number; monthlyVolume: { month: string; count: number }[]; trajectoryDirection: string; myInitiations: number; totalDays: number; marathonDays: number; silentGaps: number; avgDailyWhenActive: number; lateNightMessages: number; totalLateNightAcrossAll: number; lateNightExclusivity: number; myMediaCount: number; theirMediaCount: number; heatByHour: { hour: number; avgHeat: number }[]; peakHeatHour: number } | null>(null)
  useEffect(() => {
    if (!scopedPerson) { setDynamics(null); return }
    window.api.getRelationshipDynamics(scopedPerson).then(setDynamics).catch(() => {})
  }, [scopedPerson])

  const [aiDynamics, setAiDynamics] = useState<{ conflictPattern: string | null; supportPattern: string | null; insideJokes: string[] | null; relationshipPhase: string | null; communicationStyleMatch: number | null; topicEvolution: { then: string; now: string } | null; vulnerabilityBalance: string | null } | null>(null)
  const [aiDynamicsLoading, setAiDynamicsLoading] = useState(false)
  useEffect(() => {
    if (!scopedPerson || !dynamics) { setAiDynamics(null); return }
    setAiDynamicsLoading(true)
    const pd2 = (stats.chatNames as { rawName: string; messageCount: number }[]).find(c => c.rawName === scopedPerson)
    window.api.analyzeRelationshipDynamics(scopedPerson, resolveName(scopedPerson, chatNameMap), {
      messageCount: pd2?.messageCount || 0, myWords: dynamics.myTotalWords, theirWords: dynamics.theirTotalWords,
      myQuestions: dynamics.myQuestions, theirQuestions: dynamics.theirQuestions,
      myPositiveRate: dynamics.myPositiveRate, theirPositiveRate: dynamics.theirPositiveRate
    }).then(r => { setAiDynamics(r); setAiDynamicsLoading(false) }).catch(() => setAiDynamicsLoading(false))
  }, [scopedPerson, dynamics?.myTotalWords])

  // ── Signals (must be before early return) ──
  const [activeAlerts, setActiveAlerts] = useState<{ chat_identifier: string; signal_type: string; message: string; severity: string; delta_pct: number }[]>([])
  const [contactSignals, setContactSignals] = useState<{ signal_type: string; period: string; current_value: number; baseline_value: number; delta_pct: number; direction: string }[]>([])
  // Fetch alerts with delay — signals engine runs 15s after boot
  useEffect(() => {
    window.api.getActiveAlerts().then(setActiveAlerts).catch(() => {})
    // Re-fetch after signals engine has had time to compute
    const timer = setTimeout(() => { window.api.getActiveAlerts().then(a => { console.log('[UI] Alerts re-fetched:', a.length); setActiveAlerts(a) }).catch(() => {}) }, 20000)
    return () => clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (!scopedPerson) { setContactSignals([]); return }
    window.api.getSignals(scopedPerson).then(s => setContactSignals(s as typeof contactSignals)).catch(() => {})
  }, [scopedPerson])

  // ── Behavioral patterns (must be before early return) ──
  const [behaviorPatterns, setBehaviorPatterns] = useState<{ rareWords: { word: string; count: number }[]; vocabularySize: number; avgWordLength: number; repeatedMessages: { body: string; recipients: number; count: number }[]; laughsGiven: number; laughsReceived: number; humorRatio: number; funniestHour: number; busiestHour: number; busiestDay: number; avgMessagesPerActiveDay: number; longestSilence: number; marathonCount: number; photoRatio: number; linkShareRate: number; avgAttachmentsPerDay: number; mostSharedDomain: string | null } | null>(null)
  useEffect(() => { window.api.getBehavioralPatterns().then(setBehaviorPatterns).catch(() => {}) }, [])

  // ── Nickname detection — disabled (detection quality too low, will rebuild with AI) ──
  // const [nicknames, setNicknames] = useState<{ name: string; count: number; isFromMe: boolean }[]>([])
  // useEffect(() => {
  //   if (!scopedPerson) { setNicknames([]); return }
  //   window.api.detectNicknames(scopedPerson, resolveName(scopedPerson, chatNameMap)).then(r => setNicknames(r.nicknames)).catch(() => {})
  // }, [scopedPerson])

  // ── Relationship hero AI state (must be before early return) ──
  const [heroPhoto, setHeroPhoto] = useState<{ id: number; thumbnail_path: string; created_at: string; filename: string } | null>(null)
  const [heroPhotoUrl, setHeroPhotoUrl] = useState<string | null>(null)
  const [relNarrative, setRelNarrative] = useState<{ headline: string; narrative: string } | null>(null)
  const [convoSummary, setConvoSummary] = useState<{ summary: string; topics: string[]; tone: string } | null>(null)
  const [photoCaption, setPhotoCaption] = useState<string | null>(null)

  useEffect(() => {
    if (!scopedPerson) { setHeroPhoto(null); setHeroPhotoUrl(null); setRelNarrative(null); setConvoSummary(null); setPhotoCaption(null); return }
    // Fetch photo
    window.api.getSignificantPhotos(scopedPerson).then(photos => {
      if (photos.length > 0) {
        setHeroPhoto(photos[0])
        window.api.getFileUrl(photos[0].thumbnail_path).then(url => setHeroPhotoUrl(url)).catch(() => {})
      } else { setHeroPhoto(null); setHeroPhotoUrl(null) }
    }).catch(() => {})
    // Fetch AI narrative (non-blocking)
    const contactName = resolveName(scopedPerson, chatNameMap)
    const pd2 = (stats.chatNames as { rawName: string; messageCount: number; sentCount: number; receivedCount: number; lastMessageDate: string; attachmentCount: number }[]).find(c => c.rawName === scopedPerson)
    const ce = closenessData.find(c => c.chat_identifier === scopedPerson)
    const cr = closenessData.findIndex(c => c.chat_identifier === scopedPerson)
    if (pd2) {
      window.api.generateRelationshipNarrative(scopedPerson, contactName, {
        messageCount: pd2.messageCount, sentCount: pd2.sentCount, receivedCount: pd2.receivedCount,
        firstMessageDate: null, lastMessageDate: pd2.lastMessageDate,
        peakYear: null, peakYearCount: null, longestStreak: 0,
        closenessScore: ce?.total_score || 0, closenessRank: cr >= 0 ? cr + 1 : null,
        tier: ce?.tier || 'unknown', laughCount: 0, avgHeat: 0, positiveRate: 0
      }).then(r => { if (r) setRelNarrative(r) }).catch(() => {})
    }
    window.api.summarizeConversation(scopedPerson, contactName).then(r => { if (r) setConvoSummary(r) }).catch(() => {})
  }, [scopedPerson])

  // ── Proactive Intelligence (must be before early return) ──
  const [proactiveItems, setProactiveItems] = useState<{ id: number; chat_identifier: string; item_type: string; description: string; source_message: string; due_date: string | null; status: string; priority: number; contact_name: string }[]>([])
  useEffect(() => {
    window.api.getProactiveItems().then(r => setProactiveItems(r.items)).catch(() => {})
    // Re-fetch after proactive scan has had time to run (35s boot + scan time)
    const timer = setTimeout(() => { window.api.getProactiveItems().then(r => setProactiveItems(r.items)).catch(() => {}) }, 35000)
    return () => clearTimeout(timer)
  }, [])
  const handleDismissProactive = (id: number): void => {
    window.api.dismissProactiveItem(id).then(() => setProactiveItems(prev => prev.filter(i => i.id !== id))).catch(() => {})
  }
  const handleCompleteProactive = (id: number): void => {
    window.api.completeProactiveItem(id).then(() => setProactiveItems(prev => prev.filter(i => i.id !== id))).catch(() => {})
  }

  // ── Relationship view ──
  if (scopedPerson) {
    const pn = resolveName(scopedPerson, chatNameMap)
    const pd = chats.find((c) => c.rawName === scopedPerson)
    const closenessEntry = closenessData.find(c => c.chat_identifier === scopedPerson)
    const closenessRankIdx = closenessData.findIndex(c => c.chat_identifier === scopedPerson)
    const closenessRank = closenessRankIdx >= 0 ? closenessRankIdx + 1 : null
    const isGroupChat = pd?.isGroup ?? false
    const firstName = isGroupChat ? pn : pn.split(' ')[0]
    const dateLabel = dateRange === 'all' ? 'All time' : dateRange === 'month' ? 'This month' : dateRange === 'year' ? 'This year' : dateRange === '30days' ? 'Last 30 days' : 'Last 7 days'
    const initPct = pd ? Math.min(99, Math.round((pd.initiationCount / Math.max(pd.sentCount, 1)) * 100)) : 0
    const sentPct = pd ? Math.round((pd.sentCount / Math.max(pd.messageCount, 1)) * 100) : 50

    const trophies: { emoji: string; label: string; sublabel: string }[] = []
    if (pd) {
      if (byMessages[0]?.rawName === pd.rawName)
        trophies.push({ emoji: '👑', label: '#1 Most Messaged', sublabel: 'Your most texted person' })
      if (byLaughsReceived[0]?.rawName === pd.rawName && pd.laughsReceived > 0)
        trophies.push({ emoji: '😂', label: 'Chief Comedian', sublabel: `Makes you laugh most (${Math.round(pd.laughsReceived / Math.max(pd.messageCount, 1) * 100)}% of messages)` })
      if (byLaughsGenerated[0]?.rawName === pd.rawName && pd.laughsGenerated > 0)
        trophies.push({ emoji: '🎭', label: 'Best Audience', sublabel: `Laughs at ${Math.round(pd.laughsGenerated / Math.max(pd.messageCount, 1) * 100)}% of your messages` })
      if (byAttachments[0]?.rawName === pd.rawName && pd.attachmentCount > 0)
        trophies.push({ emoji: '📸', label: 'Photo Dumper', sublabel: `${Math.round(pd.attachmentCount / Math.max(pd.messageCount, 1) * 100)}% of messages have media` })
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
      // ── NEW TROPHIES (pipeline + closeness data) ──

      // 9. Ride-or-Die: inner circle tier
      if (closenessEntry && closenessEntry.tier === 'inner_circle')
        trophies.push({ emoji: '💀', label: 'Ride-or-Die', sublabel: 'Inner circle. Through everything.' })

      // 10. Potty Mouth: heated relationship
      if (dynamics && (dynamics.myNegativeRate > 12 || dynamics.theirNegativeRate > 12))
        trophies.push({ emoji: '🤬', label: 'Potty Mouth', sublabel: 'Your most heated conversations happen here' })

      // 11. Frenemy: high volume + mixed sentiment
      if (dynamics && pd.messageCount > 500 && dynamics.myNegativeRate > 8 && dynamics.myPositiveRate > 10)
        trophies.push({ emoji: '⚔️', label: 'Frenemy', sublabel: 'Love to argue with this one' })

      // 12. Walking Thesaurus: diverse vocabulary
      if (vocabStats && vocabStats.uniqueWords > 500 && vocabStats.totalWords > 0 && (vocabStats.uniqueWords / vocabStats.totalWords) > 0.15)
        trophies.push({ emoji: '📖', label: 'Walking Thesaurus', sublabel: `${vocabStats.uniqueWords.toLocaleString()} unique words` })

      // 13. Longest Standing: 5+ years of history (from timeline)
      const firstTimelineEvent = timelineEvents.find(e => e.type === 'first_message')
      if (firstTimelineEvent) {
        const yearsHistory = new Date().getFullYear() - new Date(firstTimelineEvent.timestamp + 'T00:00:00').getFullYear()
        if (yearsHistory >= 5)
          trophies.push({ emoji: '🏛️', label: 'Longest Standing', sublabel: `${yearsHistory} years of history` })
      }

      // 14. The Comeback: had silent gaps but recently active
      if (dynamics && dynamics.silentGaps > 0 && pd.lastMessageDate &&
          (Date.now() - new Date(pd.lastMessageDate).getTime()) < 30 * 86400000 && pd.messageCount > 100)
        trophies.push({ emoji: '🔄', label: 'The Comeback', sublabel: 'Went quiet. Came back.' })
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 40px', fontFamily: "'DM Sans', sans-serif", position: 'relative' }}>
        <div style={{ position: 'sticky', top: 0, height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
          <div style={{ position: 'absolute', top: 0, left: -28, right: -28, height: '100vh', background: 'linear-gradient(180deg, rgba(46,196,160,0.025) 0%, transparent 50%)' }} />
          <div style={{ position: 'absolute', top: 0, left: -28, right: -28, height: 200, background: 'radial-gradient(ellipse 70% 100% at 50% -30%, rgba(46,196,160,0.06), transparent)' }} />
        </div>
        <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
            <div><span style={{ fontSize: 18, color: '#1A1A1A', fontWeight: 500 }}>{pn}</span><span style={{ fontSize: 12, color: '#9a948f', marginLeft: 10 }}>{dateLabel}</span></div>
            <span style={{ color: '#9a948f', letterSpacing: '0.2em', fontSize: 20 }}>•••</span>
          </div>

          {/* ── CINEMATIC HERO ── */}
          <div style={{ background: '#1E2826', borderRadius: 22, marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
            {/* Photo banner */}
            {heroPhotoUrl && (
              <div style={{ position: 'relative', height: 220, overflow: 'hidden' }}>
                <img src={heroPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 30%, rgba(30,40,38,0.95) 100%)' }} />
                {photoCaption && (
                  <div style={{ position: 'absolute', bottom: 12, left: 20, right: 20, fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: "'DM Sans'", fontStyle: 'italic' }}>{photoCaption}</div>
                )}
              </div>
            )}
            {/* Content */}
            <div style={{ padding: heroPhotoUrl ? '16px 28px 28px' : '28px', position: 'relative' }}>
              <div style={{ position: 'absolute', right: -80, bottom: -120, width: 320, height: 320, background: 'radial-gradient(circle, rgba(46,196,160,0.18) 0%, transparent 62%)', pointerEvents: 'none' }} />
              <div style={{ position: 'relative', zIndex: 1 }}>
                {/* AI headline or fallback */}
                <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 6, fontFamily: "'DM Sans'", fontWeight: 600 }}>
                  {relNarrative?.headline || (isGroupChat ? pn : `The ${firstName} Files`)}
                </div>
                {/* Contact name */}
                <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 32, color: 'white', letterSpacing: '0.01em', marginBottom: 8 }}>{pn}</div>
                {/* Tier + rank */}
                {closenessEntry && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', background: `${tierColor(closenessEntry.tier)}18`, color: tierColor(closenessEntry.tier), fontFamily: "'DM Sans'" }}>{formatTier(closenessEntry.tier)}</span>
                    {closenessRank && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'DM Sans'" }}>#{closenessRank} closest</span>}
                  </div>
                )}
                {/* Nicknames — disabled (detection quality too low, will rebuild with AI) */}
                {/* AI narrative or stats fallback */}
                {relNarrative ? (
                  <ProLock feature="ai_relationship_narrative" onOpenSettings={onOpenSettings}>
                    <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, maxWidth: 540, fontStyle: 'italic' }}>{relNarrative.narrative}</div>
                  </ProLock>
                ) : (
                  <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7 }}>
                    {pd ? `${pd.messageCount.toLocaleString()} messages exchanged.` : ''}
                    {pd && pd.attachmentCount > 0 ? ` ${pd.attachmentCount.toLocaleString()} attachments shared.` : ''}
                  </div>
                )}
                {/* Compact stats bar */}
                {pd && (
                  <div style={{ display: 'flex', gap: 20, marginTop: 16 }}>
                    {[
                      { value: pd.messageCount.toLocaleString(), label: 'Messages' },
                      { value: pd.attachmentCount > 0 ? pd.attachmentCount.toLocaleString() : null, label: 'Attachments' },
                      { value: convStats?.peakYear ? String(convStats.peakYear.year) : null, label: 'Peak year' },
                      { value: pd.lastMessageDate ? (() => { const d = Math.floor((Date.now() - new Date(pd.lastMessageDate).getTime()) / 86400000); return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d}d ago` })() : null, label: 'Last msg' },
                    ].filter(s => s.value).map(s => (
                      <div key={s.label}>
                        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 16, color: '#2EC4A0' }}>{s.value}</div>
                        <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── CONVERSATION SUMMARY CARD (AI) ── */}
          {convoSummary && (
            <ProLock feature="ai_summaries" onOpenSettings={onOpenSettings}>
              <div style={{ background: '#fff', borderRadius: 16, padding: '18px 22px', marginBottom: 16, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontFamily: "'DM Sans'", fontWeight: 600 }}>Conversation summary</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {convoSummary.topics.map(t => (
                    <span key={t} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'rgba(46,196,160,0.08)', color: '#2EC4A0', fontFamily: "'DM Sans'" }}>{t}</span>
                  ))}
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: 'rgba(127,119,221,0.08)', color: '#7F77DD', fontFamily: "'DM Sans'" }}>{convoSummary.tone}</span>
                </div>
                <div style={{ fontSize: 14, color: '#4a4542', lineHeight: 1.7, fontFamily: "'DM Sans'" }}>{convoSummary.summary}</div>
              </div>
            </ProLock>
          )}

          {!isStatsLoading && trophies.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#9a948f' }}>Trophies</div>
                <div style={{ fontSize: 10, color: '#c8c0ba' }}>{trophies.length}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {trophies.map(t => (
                  <div key={t.label} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: '#fff', border: '1px solid rgba(0,0,0,0.07)',
                    borderRadius: 12, padding: '8px 12px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    position: 'relative'
                  }}>
                    <span style={{ fontSize: 18 }}>{t.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', lineHeight: 1.2 }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: '#9a948f', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.sublabel}</div>
                    </div>
                    <div style={{ fontSize: 10, color: '#c8c0ba', cursor: 'pointer', opacity: 0.4 }}>\u2197</div>
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
              {timelineEvents.length >= 2 && (
                <RelationshipTimelineCard events={timelineEvents} firstName={firstName} />
              )}
              {pd && <>
                <div style={{ gridColumn: 'span 4', cursor: 'pointer', position: 'relative' }}
                  onClick={() => onDrillThrough?.(`${firstName}'s comedy record`, `${firstName} · all time`, [
                    { label: 'Your laugh rate', value: `${Math.round(pd.laughsGenerated / Math.max(pd.messageCount, 1) * 100)}% of messages` },
                    { label: 'Their laugh rate', value: `${Math.round(pd.laughsReceived / Math.max(pd.messageCount, 1) * 100)}% of messages` },
                    { label: 'Total laughs', value: `${(pd.laughsGenerated + pd.laughsReceived).toLocaleString()}` },
                  ])}>
                  <WinnerCard award="JesterMaxxer"
                    name={pd.laughsGenerated > pd.laughsReceived ? 'You' : pd.laughsReceived > pd.laughsGenerated ? firstName : 'Tied'}
                    stat={`You: ${Math.round(pd.laughsGenerated / Math.max(pd.messageCount, 1) * 100)}% · ${firstName}: ${Math.round(pd.laughsReceived / Math.max(pd.messageCount, 1) * 100)}%`}
                    flavor={pd.laughsGenerated > pd.laughsReceived * 1.5 ? `Not even close. ${firstName} doesn't stand a chance.`
                      : pd.laughsReceived > pd.laughsGenerated * 1.5 ? `${firstName} owns you. Accept it.`
                      : pd.laughsGenerated > pd.laughsReceived ? 'You edge it — but they put up a fight.'
                      : pd.laughsReceived > pd.laughsGenerated ? `${firstName} has the edge. Barely.`
                      : 'Perfectly matched humor. Rare.'}
                    emoji="🃏" accentColor="#2EC4A0" span={12} />
                  <button onClick={(e) => { e.stopPropagation(); generateShareCard('JesterMaxxer', `${Math.round(pd.laughsGenerated / Math.max(pd.messageCount, 1) * 100)}%`, 'laugh rate from you', `You make ${firstName} laugh ${Math.round(pd.laughsGenerated / Math.max(pd.messageCount, 1) * 100)}% of the time.`, firstName) }}
                    style={{ position: 'absolute', top: 10, right: 36, width: 26, height: 26, background: 'rgba(46,196,160,0.1)', border: '0.5px solid rgba(46,196,160,0.3)', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 1l3 3-3 3M10 4H4a3 3 0 000 6h1" stroke="#2EC4A0" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <div style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, background: 'rgba(46,196,160,0.15)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <svg width="7" height="10" viewBox="0 0 7 10" fill="none"><path d="M1.5 1.5l4 3.5-4 3.5" stroke="#2EC4A0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>
                <WinnerCard award="JesterMogged"
                  name={firstName}
                  stat={`${Math.round(pd.laughsReceived / Math.max(pd.messageCount, 1) * 100)}% laugh rate (${pd.laughsReceived.toLocaleString()} total)`}
                  flavor={pd.laughsReceived > 500 ? "You never stood a chance." : pd.laughsReceived > 100 ? `${firstName} has your number.` : 'They know exactly how to get you.'}
                  emoji="💀" accentColor="#2EC4A0" span={4} />
                <SplitCard eyebrow="Who reaches first"
                  leftValue={`${initPct}%`} leftLabel="You initiate"
                  leftSub={initPct > 50 ? 'You keep this alive.' : initPct < 30 ? 'You wait for them.' : 'You share it.'}
                  rightValue={`${100 - initPct}%`} rightLabel={firstName}
                  rightSub={initPct > 50 ? 'They show up when you call.' : initPct < 30 ? 'They drive this.' : 'Pretty even.'}
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
              {/* Conversation momentum — avgMessagesPerDay + most active day */}
              {convStats && convStats.avgMessagesPerDay > 0 && (
                <EditorialCard kicker="Conversation rhythm"
                  headline={convStats.avgMessagesPerDay > 20
                    ? `${convStats.avgMessagesPerDay} messages per active day. This is a high-frequency relationship.`
                    : convStats.avgMessagesPerDay > 5
                    ? `${convStats.avgMessagesPerDay} messages on days you talk. A steady cadence.`
                    : `${convStats.avgMessagesPerDay} messages per active day. Quality over quantity.`}
                  subtext={convStats.mostActiveDayOfWeek ? `Most active on ${convStats.mostActiveDayOfWeek}s.` : ''}
                  accent="#2EC4A0" span={4} />
              )}

              {convStats?.peakYear && convStats.peakYearShareOfTotal && convStats.peakYearShareOfTotal > 3 && (
                <EditorialCard kicker={`${convStats.peakYear.year} · share of attention`}
                  headline={convStats.peakYearShareOfTotal > 15
                    ? `In ${convStats.peakYear.year}, ${firstName} had ${convStats.peakYearShareOfTotal}% of your total messaging. That's not a conversation — that's a relationship.`
                    : `In ${convStats.peakYear.year}, this conversation accounted for ${convStats.peakYearShareOfTotal}% of everything you sent and received.`}
                  subtext={convStats.peakYearShareOfTotal > 25
                    ? 'More than a quarter of your entire messaging life that year.'
                    : convStats.peakYearShareOfTotal > 10
                    ? 'A significant share of your attention.'
                    : ''}
                  accent="#2EC4A0" span={6} />
              )}
              {/* ── DYNAMICS SECTION ── */}
              {dynamics && (() => {
                const dy = dynamics
                const cards: JSX.Element[] = []
                const SplitBar = ({ leftPct, leftLabel, rightLabel, leftColor, rightColor }: { leftPct: number; leftLabel: string; rightLabel: string; leftColor: string; rightColor: string }) => (
                  <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 24, marginBottom: 8 }}>
                    <div style={{ width: `${Math.max(leftPct, 5)}%`, background: leftColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 600 }}>{leftLabel}</div>
                    <div style={{ width: `${Math.max(100 - leftPct, 5)}%`, background: rightColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 600 }}>{rightLabel}</div>
                  </div>
                )

                // 1. Who carries it
                if (dy.effortRatio > 0.6 || dy.effortRatio < 0.4) {
                  const youPct = Math.round(dy.effortRatio * 100)
                  cards.push(
                    <div key="effort" style={{ gridColumn: 'span 6', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600 }}>Who carries it</div>
                      <SplitBar leftPct={youPct} leftLabel={`You ${youPct}%`} rightLabel={`${firstName} ${100 - youPct}%`} leftColor="#E8604A" rightColor="#2EC4A0" />
                      <div style={{ fontSize: 12, color: '#6f6a65' }}>{dy.effortRatio > 0.6 ? "You're doing most of the heavy lifting." : `${firstName} puts in more effort.`}</div>
                    </div>
                  )
                }

                // 2. Question asymmetry
                const qTotal = dy.myQuestions + dy.theirQuestions
                if (qTotal > 20 && (dy.myQuestions > dy.theirQuestions * 2 || dy.theirQuestions > dy.myQuestions * 2)) {
                  const ratio = dy.theirQuestions > dy.myQuestions ? (dy.theirQuestions / Math.max(dy.myQuestions, 1)).toFixed(1) : (dy.myQuestions / Math.max(dy.theirQuestions, 1)).toFixed(1)
                  cards.push(
                    <div key="questions" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontWeight: 600 }}>The Interviewer</div>
                      <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 4 }}>You: {dy.myQuestions} questions · {firstName}: {dy.theirQuestions}</div>
                      <div style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>{dy.theirQuestions > dy.myQuestions ? `${firstName} asks ${ratio}x more. You're the storyteller.` : `You ask ${ratio}x more questions.`}</div>
                    </div>
                  )
                }

                // 3. Response time
                if (dy.myAvgReplyMinutes > 0 && dy.theirAvgReplyMinutes > 0 && (dy.myAvgReplyMinutes > dy.theirAvgReplyMinutes * 2 || dy.theirAvgReplyMinutes > dy.myAvgReplyMinutes * 2)) {
                  const faster = dy.myAvgReplyMinutes < dy.theirAvgReplyMinutes ? 'You' : firstName
                  const ratio = dy.myAvgReplyMinutes < dy.theirAvgReplyMinutes ? (dy.theirAvgReplyMinutes / dy.myAvgReplyMinutes).toFixed(1) : (dy.myAvgReplyMinutes / dy.theirAvgReplyMinutes).toFixed(1)
                  cards.push(
                    <div key="reply" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontWeight: 600 }}>Who replies faster</div>
                      <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 4 }}>You: avg {dy.myAvgReplyMinutes} min · {firstName}: avg {dy.theirAvgReplyMinutes} min</div>
                      <div style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>{faster} respond{faster === 'You' ? '' : 's'} {ratio}x faster.</div>
                    </div>
                  )
                }

                // 5. Volume trajectory (always show if data)
                if (dy.monthlyVolume.length >= 3) {
                  const vols = [...dy.monthlyVolume].reverse()
                  const maxVol = Math.max(...vols.map(m => m.count), 1)
                  const arrow = dy.trajectoryDirection === 'growing' ? '📈' : dy.trajectoryDirection === 'declining' ? '📉' : '➡️'
                  const desc = dy.trajectoryDirection === 'growing' ? 'Growing — you two are talking more.' : dy.trajectoryDirection === 'declining' ? 'Declining — conversations are slowing.' : 'Steady pace.'
                  cards.push(
                    <div key="trajectory" style={{ gridColumn: 'span 6', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontWeight: 600 }}>{arrow} Trajectory</div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40, marginBottom: 8 }}>
                        {vols.map((m, i) => <div key={i} style={{ flex: 1, background: '#2EC4A0', borderRadius: 2, height: `${Math.max((m.count / maxVol) * 100, 4)}%`, minHeight: 2 }} />)}
                      </div>
                      <div style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>{desc}</div>
                    </div>
                  )
                }

                // 6. Burst pattern
                if (dy.marathonDays > 3 || dy.silentGaps > 3) {
                  cards.push(
                    <div key="burst" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600 }}>Your rhythm</div>
                      <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 4 }}>{dy.marathonDays} marathon day{dy.marathonDays !== 1 ? 's' : ''} · {dy.silentGaps} silent gap{dy.silentGaps !== 1 ? 's' : ''}</div>
                      <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 4 }}>Avg: {dy.avgDailyWhenActive} msgs/day when active</div>
                      <div style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>You talk in bursts. Intense then quiet.</div>
                    </div>
                  )
                }

                // 7. Late night exclusivity
                if (dy.lateNightExclusivity > 15) {
                  cards.push(
                    <div key="latenight" style={{ gridColumn: 'span 4', ...tileBase, background: '#1E2826', border: 'none' }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7F77DD', marginBottom: 8, fontWeight: 600 }}>After midnight</div>
                      <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 24, color: '#7F77DD', marginBottom: 6 }}>{dy.lateNightExclusivity}%</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>of your late-night texting goes to {firstName}.</div>
                    </div>
                  )
                }

                // 8. Media sharing
                const totalMedia = dy.myMediaCount + dy.theirMediaCount
                const mediaRatio = totalMedia > 0 ? Math.max(dy.myMediaCount, dy.theirMediaCount) / Math.max(Math.min(dy.myMediaCount, dy.theirMediaCount), 1) : 0
                if (totalMedia > 20 && mediaRatio > 1.5) {
                  const more = dy.theirMediaCount > dy.myMediaCount ? firstName : 'You'
                  cards.push(
                    <div key="media" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600 }}>Who sends more</div>
                      <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 4 }}>You: {dy.myMediaCount} · {firstName}: {dy.theirMediaCount}</div>
                      <div style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>{more} share{more === 'You' ? '' : 's'} {mediaRatio.toFixed(1)}x more media.</div>
                    </div>
                  )
                }

                // 9. Emotional temperature
                if (Math.abs(dy.myPositiveRate - dy.theirPositiveRate) > 5 || Math.abs(dy.myNegativeRate - dy.theirNegativeRate) > 5) {
                  const warmer = dy.myPositiveRate > dy.theirPositiveRate ? 'You' : firstName
                  cards.push(
                    <div key="emotion" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontWeight: 600 }}>Emotional temperature</div>
                      <div style={{ fontSize: 11, color: '#6f6a65', marginBottom: 2 }}>You: {dy.myPositiveRate}% positive · {dy.myNegativeRate}% negative</div>
                      <div style={{ fontSize: 11, color: '#6f6a65', marginBottom: 6 }}>{firstName}: {dy.theirPositiveRate}% positive · {dy.theirNegativeRate}% negative</div>
                      <div style={{ fontSize: 12, color: '#1A1A1A', fontWeight: 500 }}>{warmer}{warmer === 'You' ? "'re" : ' is'} the warmer one.</div>
                    </div>
                  )
                }

                // 10. Heat clock
                if (dy.heatByHour.length > 0 && dy.heatByHour.some(h => h.avgHeat > 2)) {
                  const hr = dy.peakHeatHour
                  const display = hr === 0 ? '12am' : hr < 12 ? `${hr}am` : hr === 12 ? '12pm' : `${hr - 12}pm`
                  cards.push(
                    <div key="heatclock" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600 }}>When it gets intense</div>
                      <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 24, color: '#E8604A', marginBottom: 6 }}>{display}</div>
                      <div style={{ fontSize: 12, color: '#6f6a65' }}>Your most intense exchanges happen {hr >= 21 || hr < 5 ? 'late at night' : hr < 12 ? 'in the morning' : 'in the afternoon'}.</div>
                    </div>
                  )
                }

                // ── AI-powered dynamics cards ──
                const aiBadge = <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(127,119,221,0.12)', color: '#7F77DD', fontFamily: "'DM Sans'", letterSpacing: '0.08em', textTransform: 'uppercase' as const, fontWeight: 600, marginLeft: 6 }}>AI</span>

                if (aiDynamics) {
                  if (aiDynamics.conflictPattern) cards.push(
                    <div key="ai-conflict" style={{ gridColumn: 'span 4', borderRadius: 14, background: 'linear-gradient(135deg, #2D1F1A 0%, #1E2826 100%)', padding: '18px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E8604A', fontWeight: 600, fontFamily: "'DM Sans'" }}>Conflict pattern</span>{aiBadge}</div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{aiDynamics.conflictPattern}</div>
                    </div>
                  )
                  if (aiDynamics.supportPattern) cards.push(
                    <div key="ai-support" style={{ gridColumn: 'span 4', borderRadius: 14, background: 'linear-gradient(135deg, #F8F4F0 0%, #FFF8F2 100%)', padding: '18px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, fontFamily: "'DM Sans'" }}>Support dynamic</span>{aiBadge}</div>
                      <div style={{ fontSize: 13, color: '#4a4542', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{aiDynamics.supportPattern}</div>
                    </div>
                  )
                  if (aiDynamics.insideJokes && aiDynamics.insideJokes.length > 0) cards.push(
                    <div key="ai-jokes" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, fontFamily: "'DM Sans'" }}>Your inside language</span>{aiBadge}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {aiDynamics.insideJokes.map((j, i) => <span key={i} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: 'rgba(46,196,160,0.08)', color: '#2EC4A0', fontFamily: "'DM Sans'" }}>"{j}"</span>)}
                      </div>
                    </div>
                  )
                  if (aiDynamics.relationshipPhase) cards.push(
                    <div key="ai-phase" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, fontFamily: "'DM Sans'" }}>Where you are now</span>{aiBadge}</div>
                      <div style={{ fontSize: 13, color: '#1A1A1A', lineHeight: 1.5, fontWeight: 500, fontFamily: "'DM Sans'" }}>{aiDynamics.relationshipPhase}</div>
                    </div>
                  )
                  if (aiDynamics.communicationStyleMatch != null) cards.push(
                    <div key="ai-style" style={{ gridColumn: 'span 4', ...tileBase }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, fontFamily: "'DM Sans'" }}>Style match</span>{aiBadge}</div>
                      <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: '#2EC4A0', marginBottom: 4 }}>{aiDynamics.communicationStyleMatch}%</div>
                      <div style={{ fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'" }}>{aiDynamics.communicationStyleMatch >= 75 ? 'You text alike — similar energy.' : aiDynamics.communicationStyleMatch >= 50 ? 'Different styles, but it works.' : 'Very different communication styles.'}</div>
                    </div>
                  )
                  if (aiDynamics.topicEvolution) cards.push(
                    <div key="ai-topics" style={{ gridColumn: 'span 6', ...tileBase }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, fontFamily: "'DM Sans'" }}>Then vs now</span>{aiBadge}</div>
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: '#F5F0EA' }}>
                          <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 4 }}>Then</div>
                          <div style={{ fontSize: 14, color: '#6f6a65', fontWeight: 500, fontFamily: "'DM Sans'" }}>{aiDynamics.topicEvolution.then}</div>
                        </div>
                        <div style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(46,196,160,0.06)' }}>
                          <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 4 }}>Now</div>
                          <div style={{ fontSize: 14, color: '#1A1A1A', fontWeight: 500, fontFamily: "'DM Sans'" }}>{aiDynamics.topicEvolution.now}</div>
                        </div>
                      </div>
                    </div>
                  )
                  if (aiDynamics.vulnerabilityBalance) cards.push(
                    <div key="ai-vuln" style={{ gridColumn: 'span 4', borderRadius: 14, background: 'linear-gradient(135deg, #F5F0EA 0%, #F8F4F0 100%)', padding: '18px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9a948f', fontWeight: 600, fontFamily: "'DM Sans'" }}>Who opens up</span>{aiBadge}</div>
                      <div style={{ fontSize: 13, color: '#4a4542', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{aiDynamics.vulnerabilityBalance}</div>
                    </div>
                  )
                }

                // Loading state for AI dynamics
                if (aiDynamicsLoading && cards.length > 0) cards.push(
                  <div key="ai-loading" style={{ gridColumn: 'span 12', padding: '8px 0' }}>
                    <div style={{ fontSize: 11, color: '#7F77DD', fontFamily: "'DM Sans'", opacity: 0.6 }}>Analyzing deeper patterns...</div>
                  </div>
                )

                if (cards.length === 0 && !aiDynamicsLoading) return null
                return (
                  <>
                    <div style={{ gridColumn: 'span 12', marginTop: 8 }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 4, fontFamily: "'DM Sans'", fontWeight: 600 }}>Dynamics</div>
                      <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 12, fontFamily: "'DM Sans'" }}>Patterns and power dynamics in this relationship.</div>
                    </div>
                    {cards}
                  </>
                )
              })()}

              {/* Per-contact signals */}
              {contactSignals.filter(s => s.direction !== 'stable' && s.period === '30d').length > 0 && (
                <div style={{ gridColumn: 'span 4', ...tileBase }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>Signals</div>
                  {contactSignals.filter(s => s.direction !== 'stable' && s.period === '30d').slice(0, 4).map((s, i) => {
                    const arrow = s.direction === 'up' ? '\u{1F4C8}' : '\u{1F4C9}'
                    const label = s.signal_type.charAt(0).toUpperCase() + s.signal_type.slice(1).replace('_', ' ')
                    return <div key={i} style={{ fontSize: 11, color: '#6f6a65', lineHeight: 1.8, fontFamily: "'DM Sans'" }}>{arrow} {label}: {s.delta_pct > 0 ? '+' : ''}{Math.round(s.delta_pct)}% vs 30d avg</div>
                  })}
                </div>
              )}

              {/* Monthly Rhythm card */}
              {monthlyData && monthlyData.months.length >= 6 && (() => {
                const recent = monthlyData.months.slice(-12)
                const maxCount = Math.max(...recent.map(m => m.count), 1)
                const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                return (
                  <div style={{ gridColumn: 'span 6', ...tileBase }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 4, fontWeight: 600, fontFamily: "'DM Sans'" }}>Monthly rhythm</div>
                    <div style={{ fontSize: 12, color: '#9a948f', marginBottom: 12, fontFamily: "'DM Sans'" }}>Avg: {monthlyData.avgPerMonth.toLocaleString()} msgs/month</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 50, marginBottom: 6 }}>
                      {recent.map((m, i) => {
                        const h = Math.max((m.count / maxCount) * 100, 3)
                        const color = m.isAnomaly ? (m.anomalyType === 'spike' ? '#E8604A' : '#9a948f') : '#2EC4A0'
                        return (
                          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                            <div style={{ width: '100%', height: `${h}%`, borderRadius: '2px 2px 0 0', background: color, minHeight: 2 }} />
                            <span style={{ fontSize: 7, color: 'rgba(0,0,0,0.25)' }}>{MONTHS[parseInt(m.month.split('-')[1]) - 1]?.slice(0, 1) || ''}</span>
                          </div>
                        )
                      })}
                    </div>
                    {monthlyData.anomalies.length > 0 && (
                      <div style={{ borderTop: '1px solid rgba(0,0,0,0.04)', paddingTop: 8, marginTop: 4 }}>
                        {monthlyData.anomalies.slice(0, 3).map((a, i) => (
                          <div key={i} style={{ fontSize: 11, color: '#6f6a65', lineHeight: 1.6, fontFamily: "'DM Sans'" }}>
                            {a.type === 'spike' ? '🔥' : '📉'} {a.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Media Shared card */}
              {mediaData && mediaData.totalMedia > 10 && (
                <div style={{ gridColumn: 'span 6', ...tileBase }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7F77DD', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>Media shared</div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                    <div><span style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 20, color: '#E8604A' }}>{mediaData.myMediaCount}</span><span style={{ fontSize: 10, color: '#9a948f', marginLeft: 4 }}>you sent</span></div>
                    <div><span style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 20, color: '#2EC4A0' }}>{mediaData.theirMediaCount}</span><span style={{ fontSize: 10, color: '#9a948f', marginLeft: 4 }}>{firstName} sent</span></div>
                  </div>
                  {(mediaData.myMediaCount + mediaData.theirMediaCount) > 0 && (
                    <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 20, marginBottom: 8 }}>
                      <div style={{ width: `${Math.max(5, Math.round(mediaData.myMediaCount / (mediaData.myMediaCount + mediaData.theirMediaCount) * 100))}%`, background: '#E8604A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600 }}>You</div>
                      <div style={{ flex: 1, background: '#2EC4A0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600 }}>{firstName}</div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'" }}>
                    {mediaData.imageCount > 0 ? `${mediaData.imageCount} photos` : ''}{mediaData.videoCount > 0 ? ` · ${mediaData.videoCount} videos` : ''}{mediaData.documentCount > 0 ? ` · ${mediaData.documentCount} docs` : ''}
                  </div>
                  {mediaData.peakMediaMonth && (
                    <div style={{ fontSize: 11, color: '#6f6a65', marginTop: 4, fontFamily: "'DM Sans'" }}>Peak: {(() => { const [y, m] = mediaData.peakMediaMonth.month.split('-').map(Number); const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${MN[m-1]} ${y}` })()} ({mediaData.peakMediaMonth.count} files)</div>
                  )}
                </div>
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

      <div style={{ width: 32, height: 2, borderRadius: 1, background: 'rgba(232,96,74,0.3)', marginTop: -8, marginBottom: 16 }} />

      <div data-surface="personal" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>

        {/* ── TIER 0: ARCHIVE IDENTITY — the big number ── */}
        {usageData && usageData.totalMessages > 0 && (
          <PosterCard eyebrow="Your archive"
            number={usageData.totalMessages > 1000000 ? `${(usageData.totalMessages / 1000000).toFixed(1)}M` : usageData.totalMessages.toLocaleString()}
            unit="messages"
            descriptor={usageData.totalMessages > 500000
              ? 'Over the people and groups that define your world. That\'s not a messaging app — that\'s a life story.'
              : usageData.totalMessages > 100000
              ? 'Across every conversation you\'ve ever had. A substantial record.'
              : 'Every conversation adds up.'}
            accent="#E8604A" bg="#26211d" span={12} />
        )}

        {/* ── TIER 1: MESSAGING NETWORK — the visual centerpiece ── */}
        {!networkData && <WarmingCard span={12} />}
        {networkData && networkData.nodes.length >= 4 && (
          <ConstellationCard network={networkData} chatNameMap={chatNameMap} onSelectConversation={onSelectConversation} />
        )}

        {/* Network interpretation cards */}
        {networkData && networkData.nodes.length >= 4 && (() => {
          // Connector: person in most shared groups
          const edgeCounts = new Map<string, number>()
          for (const e of networkData.edges) {
            edgeCounts.set(e.a, (edgeCounts.get(e.a) || 0) + 1)
            edgeCounts.set(e.b, (edgeCounts.get(e.b) || 0) + 1)
          }
          const connector = [...edgeCounts.entries()].sort((a, b) => b[1] - a[1])[0]
          // Tightest circle: top 3 by message count
          const top3Names = networkData.nodes.slice(0, 3).map(n => resolveName(n.rawName, chatNameMap).split(' ')[0])
          // Outer orbit: contacts with fewer messages than median
          const sortedCounts = networkData.nodes.map(n => n.messageCount).sort((a, b) => a - b)
          const median = sortedCounts[Math.floor(sortedCounts.length / 2)] || 0
          const outerCount = networkData.nodes.filter(n => n.messageCount < median).length
          return (
            <>
              {connector && (
                <WinnerCard award="Connector" name={resolveName(connector[0], chatNameMap)}
                  stat={`Appears in ${connector[1]} of your group chats`}
                  flavor="The person who ties your social circles together."
                  emoji="🔗" accentColor="#E8604A" span={4} />
              )}
              <EditorialCard kicker="Tightest circle"
                headline={top3Names.join(', ')}
                subtext="Your top 3 contacts by message volume. The inner ring of your network."
                accent="#E8604A" span={4} />
              <EditorialCard kicker="Outer orbit"
                headline={`${outerCount} contact${outerCount !== 1 ? 's' : ''}`}
                subtext="Below the median message count. Peripheral connections — but they're still in your network."
                accent="#9a948f" span={4} />
            </>
          )
        })()}

        {/* ── TIER 1.5: SOCIAL GRAVITY + LIFE CHAPTERS ── */}
        {gravityIndiv.length === 0 && gravityGroups.length === 0 && !networkData && <WarmingCard span={12} />}
        {(gravityIndiv.length >= 2 || gravityGroups.length >= 2) && (
          <SocialGravityCard individualYears={gravityIndiv} groupYears={gravityGroups} chatNameMap={chatNameMap} onSelectYear={(y) => onSurfaceChange?.('relationship')} highlightedYears={chapterHighlight ?? undefined} />
        )}
        {(gravityIndiv.length >= 2 || gravityGroups.length >= 2) && (
          <LifeChaptersCard personChapters={computeChapters(gravityIndiv)} groupChapters={computeChapters(gravityGroups)} chatNameMap={chatNameMap} onHoverChapter={setChapterHighlight} />
        )}
        {topicEras.length === 0 && memoryMoments.length === 0 && gravityIndiv.length > 0 && <WarmingCard span={6} />}
        {topicEras.length >= 1 && (
          aiEnrichedTopics ? (
            <ProLock feature="ai_topic_eras" onOpenSettings={onOpenSettings}>
              <TopicErasCard chapters={topicEras} aiEnhanced={aiEnrichedTopics} />
            </ProLock>
          ) : (
            <TopicErasCard chapters={topicEras} aiEnhanced={false} />
          )
        )}

        {/* ── TIER 1.7: MEMORY ── */}
        {memoryMoments.length >= 1 && (
          <ProLock feature="ai_memory_moments" onOpenSettings={onOpenSettings}>
            <MemoryCard moments={memoryMoments} chatNameMap={chatNameMap} />
          </ProLock>
        )}

        {/* ── TIER 1.8: BEHAVIORAL PATTERNS ── */}
        {behaviorPatterns && (behaviorPatterns.vocabularySize > 0 || behaviorPatterns.laughsGiven > 0) && (() => {
          const bp = behaviorPatterns
          const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
          const fmtHour = (h: number) => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
          return (
            <>
              <div style={{ gridColumn: 'span 12', marginTop: 8 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 4, fontFamily: "'DM Sans'", fontWeight: 600 }}>Behavioral patterns</div>
                <div style={{ fontSize: 13, color: '#9a948f', marginBottom: 12, fontFamily: "'DM Sans'" }}>What your habits say about you.</div>
              </div>

              {bp.vocabularySize > 0 && (
                <div style={{ gridColumn: 'span 6', ...tileBase }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>Your vocabulary</div>
                  <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 8, fontFamily: "'DM Sans'" }}>{bp.avgWordLength} avg word length · {bp.vocabularySize.toLocaleString()} unique words</div>
                  {bp.rareWords.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 6, fontFamily: "'DM Sans'" }}>Your signature words</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {bp.rareWords.slice(0, 8).map(w => <span key={w.word} style={{ fontSize: 10, color: '#2EC4A0', background: 'rgba(46,196,160,0.08)', borderRadius: 12, padding: '3px 10px', fontFamily: "'DM Sans'" }}>{w.word}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {bp.repeatedMessages.length > 0 && (
                <div style={{ gridColumn: 'span 6', ...tileBase }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>The copy-paster</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {bp.repeatedMessages.slice(0, 3).map((m, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'" }}>
                        <span style={{ color: '#9a948f', fontStyle: 'italic' }}>"{m.body}"</span>
                        <span style={{ color: '#E8604A', marginLeft: 6 }}>&rarr; {m.recipients} people</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {bp.laughsGiven > 0 && (
                <div style={{ gridColumn: 'span 4', ...tileBase }}>
                  <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>Humor profile</div>
                  <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 4, fontFamily: "'DM Sans'" }}>{bp.laughsGiven.toLocaleString()} laughs earned · {bp.laughsReceived.toLocaleString()} laughs given</div>
                  <div style={{ fontSize: 13, color: '#1A1A1A', fontWeight: 500, fontFamily: "'DM Sans'" }}>{bp.humorRatio > 1.3 ? "You're the comedian." : bp.humorRatio < 0.7 ? "You're the audience." : "Balanced humor."}</div>
                  <div style={{ fontSize: 11, color: '#9a948f', marginTop: 4, fontFamily: "'DM Sans'" }}>Funniest at {fmtHour(bp.funniestHour)}</div>
                </div>
              )}

              <div style={{ gridColumn: 'span 4', ...tileBase }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>Your rhythm</div>
                <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 2, fontFamily: "'DM Sans'" }}>Most active: {fmtHour(bp.busiestHour)} on {DAYS[bp.busiestDay]}s</div>
                <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 2, fontFamily: "'DM Sans'" }}>{bp.avgMessagesPerActiveDay} msgs/day when active</div>
                {bp.marathonCount > 0 && <div style={{ fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'" }}>{bp.marathonCount} marathon day{bp.marathonCount !== 1 ? 's' : ''} (200+)</div>}
                {bp.longestSilence > 0 && <div style={{ fontSize: 11, color: '#9a948f', marginTop: 4, fontFamily: "'DM Sans'" }}>Longest silence: {bp.longestSilence} days</div>}
              </div>

              <div style={{ gridColumn: 'span 4', ...tileBase }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontWeight: 600, fontFamily: "'DM Sans'" }}>Sharing style</div>
                <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 2, fontFamily: "'DM Sans'" }}>{bp.photoRatio}% photos · {bp.linkShareRate}% links</div>
                <div style={{ fontSize: 12, color: '#6f6a65', marginBottom: 2, fontFamily: "'DM Sans'" }}>{bp.avgAttachmentsPerDay} files/day</div>
                {bp.mostSharedDomain && <div style={{ fontSize: 11, color: '#E8604A', marginTop: 4, fontFamily: "'DM Sans'" }}>Most shared: {bp.mostSharedDomain}</div>}
              </div>
            </>
          )
        })()}

        {/* ── TIER 2: IDENTITY SPECTRUMS ── */}
        {(() => {
          const groupMessages = groups.reduce((s, c) => s + c.messageCount, 0)
          const totalMsgs = chats.reduce((s, c) => s + c.messageCount, 0)
          const groupPct = totalMsgs > 0 ? Math.round((groupMessages / totalMsgs) * 100) : 0
          return (
            <SpectrumCard eyebrow="Your messaging identity" leftLabel="One-on-one" rightLabel="Group chats"
              markerPct={groupPct}
              markerLabel={groupPct > 60 ? 'Group Native' : groupPct > 40 ? 'Balanced' : 'One-on-One Person'}
              descriptor={groupPct > 60
                ? `${groupPct}% of your messages happen in group chats. You thrive in the noise.`
                : groupPct > 40
                ? `${groupPct}% groups, ${100 - groupPct}% direct. You balance both worlds.`
                : `${100 - groupPct}% of your messages are one-on-one. You prefer depth over breadth.`}
              accent="#E8604A" span={6} />
          )
        })()}

        {/* Inner circle distribution */}
        {(() => {
          const top3 = byMessages.slice(0, 3).reduce((s, c) => s + c.messageCount, 0)
          const total = chats.reduce((s, c) => s + c.messageCount, 0)
          const pct = total > 0 ? Math.round((top3 / total) * 100) : 0
          const top3Names = byMessages.slice(0, 3).map(c => resolveName(c.rawName, chatNameMap).split(' ')[0])
          return (
            <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 14, fontFamily: "'DM Sans'" }}>Your inner circle</div>
              <div style={{ display: 'flex', gap: 1, borderRadius: 4, overflow: 'hidden', height: 8, marginBottom: 12 }}>
                <div style={{ flex: pct, background: '#E8604A', borderRadius: '4px 0 0 4px' }} />
                <div style={{ flex: 100 - pct, background: '#EAE5DF', borderRadius: '0 4px 4px 0' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 24, color: '#E8604A', lineHeight: 1 }}>{pct}%</div>
                  <div style={{ fontSize: 11, color: '#6f6a65', marginTop: 3, fontFamily: "'DM Sans'" }}>Top 3 contacts</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 24, color: '#C8C0BA', lineHeight: 1 }}>{100 - pct}%</div>
                  <div style={{ fontSize: 11, color: '#9a948f', marginTop: 3, fontFamily: "'DM Sans'" }}>Everyone else</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'", lineHeight: 1.5 }}>
                {top3Names.join(', ')} account for {pct}% of your messages.
                {pct > 60 ? ' You run deep, not wide.' : pct > 40 ? ' A fairly concentrated social life.' : ' You spread it around.'}
              </div>
            </div>
          )
        })()}

        {/* ── TIER 3: DYNAMICS — behavior spectrums ── */}
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

        {/* ── TIER 3.5: TIMING ── */}
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

        {/* ── TIER 4: COMEDY ── */}
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

        {/* ── TIER 5: STORIES ── */}
        {byMessages[0] && (
          <EditorialCard kicker="Ride or die"
            headline={`${resolveName(byMessages[0].rawName, chatNameMap)} gets more of you than anyone else.`}
            subtext={`${byMessages[0].messageCount.toLocaleString()} messages. Your default person.`}
            accent="#E8604A" span={6} />
        )}

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

      <div style={{ width: 32, height: 2, borderRadius: 1, background: 'rgba(127,119,221,0.3)', marginTop: -8, marginBottom: 16 }} />

      <div data-surface="usage" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>
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
            stat={`${Math.round(byAttachments[0].attachmentCount / Math.max(byAttachments[0].messageCount, 1) * 100)}% media rate (${byAttachments[0].attachmentCount.toLocaleString()} files)`}
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
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 16, fontFamily: "'DM Sans'" }}>Message volume · by year</div>
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

        {usageData && usageData.totalMessages > 0 && (
          <SplitCard eyebrow="Your message volume"
            leftValue={usageData.sentMessages.toLocaleString()} leftLabel="You sent"
            leftSub={`${Math.round((usageData.sentMessages / Math.max(usageData.totalMessages, 1)) * 100)}% of all messages`}
            rightValue={usageData.receivedMessages.toLocaleString()} rightLabel="You received"
            rightSub={`${Math.round((usageData.receivedMessages / Math.max(usageData.totalMessages, 1)) * 100)}% of all messages`}
            leftPct={Math.round((usageData.sentMessages / Math.max(usageData.totalMessages, 1)) * 100)}
            accent="#7F77DD" span={6} />
        )}
        {usageData && usageData.busiestYear && (
          <EditorialCard kicker="Busiest year"
            headline={`${usageData.busiestYear.year}. ${usageData.busiestYear.count.toLocaleString()} messages exchanged.`}
            subtext={usageData.messagesPerYear.length > 1 ? 'More than any other year in your archive.' : 'Your messaging peak.'}
            accent="#7F77DD" span={6} />
        )}
        {usageData && (
          <>
            {[
              { label: 'Total messages', value: usageData.totalMessages.toLocaleString(), sub: 'sent + received' },
              { label: 'Busiest day', value: usageData.busiestDay ? usageData.busiestDay.count.toLocaleString() : '—', sub: usageData.busiestDay ? new Date(usageData.busiestDay.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '' },
              { label: 'Active now', value: usageData.activeConversations.toLocaleString(), sub: 'conversations in last 30 days' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ gridColumn: 'span 4', borderRadius: 16, padding: '18px 20px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
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
              placeholder={scopedPerson ? `Search messages with ${resolveName(scopedPerson, chatNameMap)}…` : SEARCH_EXAMPLES[placeholderIdx]}
              style={{ flex: 1, padding: '11px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: 13, outline: 'none', fontFamily: "'DM Sans'" }} />
            <button onClick={handleMsgSearch} disabled={msgSearching}
              style={{ padding: '11px 20px', borderRadius: 10, background: '#E8604A', border: 'none', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: "'DM Sans'", opacity: msgSearching ? 0.6 : 1 }}>
              {msgSearching ? '…' : 'Search'}
            </button>
          </div>
        )}
        {isIndexed && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8, fontFamily: "'DM Sans'" }}>{msgIndexStatus!.indexed.toLocaleString()} messages indexed</div>}
      </div>

      {/* Structured search results */}
      {searchResult !== null && (
        <div style={{ gridColumn: 'span 12' }}>
          <div style={{ fontSize: 12, color: '#E8604A', marginBottom: 10, fontFamily: "'DM Sans'", fontWeight: 500 }}>{searchResult.explanation}</div>

          {/* Ranked contacts (signal_rank results) */}
          {searchResult.type === 'ranked_contacts' && searchResult.ranked && (
            searchResult.ranked.length === 0
              ? <div style={{ textAlign: 'center', padding: 24, color: '#9a948f', fontSize: 13, fontFamily: "'DM Sans'" }}>No signal data yet. Analysis may still be running.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(() => { const maxVal = Math.max(...searchResult.ranked!.map(r => r.value), 1); return searchResult.ranked!.map((r, i) => (
                    <div key={r.contact} onClick={() => onSelectConversation(r.contact)}
                      style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: i === 0 ? '#E8604A' : '#c8c0ba', fontWeight: 600, width: 18, fontFamily: "'DM Sans'" }}>{i + 1}</span>
                          <span style={{ fontSize: 14, fontWeight: i === 0 ? 600 : 400, color: '#1A1A1A', fontFamily: "'DM Sans'" }}>{resolveName(r.contact, chatNameMap)}</span>
                        </div>
                        <span style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 15, color: i === 0 ? '#E8604A' : '#9a948f' }}>{r.value} <span style={{ fontSize: 10, fontWeight: 400 }}>{r.label}</span></span>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: '#EAE5DF', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round((r.value / maxVal) * 100)}%`, background: i === 0 ? '#E8604A' : '#D4CFC9', borderRadius: 2 }} />
                      </div>
                    </div>
                  )) })()}
                </div>
          )}

          {/* Aggregation (phrase_count results) */}
          {searchResult.type === 'aggregation' && searchResult.aggregation && (
            searchResult.aggregation.length === 0
              ? <div style={{ textAlign: 'center', padding: 24, color: '#9a948f', fontSize: 13, fontFamily: "'DM Sans'" }}>No results found.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {searchResult.aggregation.map(r => (
                    <div key={r.contact} onClick={() => onSelectConversation(r.contact)}
                      style={{ padding: '14px 18px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#1A1A1A', fontFamily: "'DM Sans'" }}>{resolveName(r.contact, chatNameMap)}</span>
                        <span style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 16, color: '#E8604A' }}>{r.count}x</span>
                      </div>
                      {r.samples.slice(0, 2).map((s, j) => (
                        <div key={j} style={{ fontSize: 12, color: '#6f6a65', lineHeight: 1.5, fontFamily: "'DM Sans'", padding: '3px 0', borderTop: j > 0 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                          <span style={{ color: s.is_from_me ? '#E8604A' : '#2EC4A0', fontSize: 10, fontWeight: 500, marginRight: 6 }}>{s.is_from_me ? 'You' : 'Them'}</span>
                          {s.body}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
          )}

          {/* Messages (phrase_first / literal results) */}
          {searchResult.type === 'messages' && searchResult.messages && (
            searchResult.messages.length === 0
              ? <div style={{ textAlign: 'center', padding: 24, color: '#9a948f', fontSize: 13, fontFamily: "'DM Sans'" }}>No messages found.</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {searchResult.messages.map((r, i) => (
                    <div key={i} onClick={() => r.chat_name && onSelectConversation(r.chat_name)}
                      style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: r.is_from_me ? '#E8604A' : '#2EC4A0', fontWeight: 500, fontFamily: "'DM Sans'" }}>
                          {r.is_from_me ? 'You' : 'Them'} · <span style={{ color: '#9a948f', fontWeight: 400 }}>{resolveName(r.chat_name, chatNameMap)}</span>
                        </span>
                        <span style={{ fontSize: 10, color: '#c8c0ba', fontFamily: "'DM Sans'" }}>{new Date(r.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#4a4542', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{r.snippet || r.body?.slice(0, 200)}</div>
                    </div>
                  ))}
                </div>
          )}

          {/* Conversational AI answer */}
          {searchResult.type === 'conversational' && searchResult.answer && (
            <div style={{ padding: '20px 24px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(127,119,221,0.12)', color: '#7F77DD', fontFamily: "'DM Sans'", letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>AI</span>
              </div>
              <div style={{ fontSize: 15, color: '#1A1A1A', lineHeight: 1.7, fontFamily: "'DM Sans'", marginBottom: 12 }}>{searchResult.answer}</div>
              {searchResult.sources && searchResult.sources.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {searchResult.sources.map((s, i) => (
                    <span key={i} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'rgba(46,196,160,0.1)', color: '#2EC4A0', fontFamily: "'DM Sans'" }}>{s}</span>
                  ))}
                </div>
              )}
              {searchResult.followUp && (
                <button onClick={(e) => { e.stopPropagation(); setMsgQuery(searchResult.followUp!); setTimeout(() => handleMsgSearch(), 100) }}
                  style={{ fontSize: 12, color: '#7F77DD', background: 'rgba(127,119,221,0.08)', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: "'DM Sans'" }}>
                  Try: {searchResult.followUp}
                </button>
              )}
            </div>
          )}

          {/* Timeline (behavior_query results) */}
          {searchResult.type === 'timeline' && searchResult.timeline && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {searchResult.timeline.map(t => {
                const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                const label = MONTHS[parseInt(t.period)] || DAYS[parseInt(t.period)] || t.period
                const maxVal = Math.max(...searchResult.timeline!.map(x => x.value), 1)
                return (
                  <div key={t.period} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                    <span style={{ width: 36, fontSize: 12, color: '#6f6a65', fontFamily: "'DM Sans'", textAlign: 'right' }}>{label}</span>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#EAE5DF', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.round((t.value / maxVal) * 100)}%`, background: '#E8604A', borderRadius: 3 }} />
                    </div>
                    <span style={{ width: 50, fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'", textAlign: 'right' }}>{t.value.toLocaleString()}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Search V2 results */}
      {searchResultV2 && (
        <div style={{ gridColumn: 'span 12' }}>
          {/* Plan chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {searchResultV2.plan.people.map(p => (
              <span key={p} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 12, background: 'rgba(46,196,160,0.1)', color: '#2EC4A0', fontFamily: "'DM Sans'" }}>Person: {p}</span>
            ))}
            {searchResultV2.plan.topic && (
              <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 12, background: 'rgba(232,96,74,0.1)', color: '#E8604A', fontFamily: "'DM Sans'" }}>Topic: {searchResultV2.plan.topic}</span>
            )}
            {searchResultV2.plan.timeRange && (
              <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 12, background: 'rgba(127,119,221,0.1)', color: '#7F77DD', fontFamily: "'DM Sans'" }}>Time: {searchResultV2.plan.timeRange.description}</span>
            )}
            {searchResultV2.plan.modalities !== 'both' && (
              <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 12, background: 'rgba(186,117,23,0.1)', color: '#BA7517', fontFamily: "'DM Sans'" }}>{searchResultV2.plan.modalities === 'messages' ? 'Messages only' : 'Attachments only'}</span>
            )}
            <span style={{ fontSize: 10, color: '#c8c0ba', fontFamily: "'DM Sans'", alignSelf: 'center' }}>{searchResultV2.searchTimeMs}ms · {searchResultV2.totalResults} results</span>
          </div>

          {/* AI Summary */}
          {searchResultV2.sections.summary && (
            <div style={{ padding: '16px 20px', borderRadius: 14, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(127,119,221,0.12)', color: '#7F77DD', fontFamily: "'DM Sans'", letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>AI</span>
              </div>
              <div style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.7, fontFamily: "'DM Sans'" }}>{searchResultV2.sections.summary}</div>
            </div>
          )}

          {/* Conversations section */}
          {searchResultV2.sections.conversations.length > 0 && (() => {
            const isRanking = searchResultV2.plan.answerMode === 'ranking'
            const maxMsg = Math.max(...searchResultV2.sections.conversations.map(c => c.matchingMessages), 1)
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontFamily: "'DM Sans'", fontWeight: 600 }}>
                  {isRanking ? `Top conversations · ${searchResultV2.sections.conversations[0]?.dateRange || 'all time'}` : `Conversations (${searchResultV2.sections.conversations.length})`}
                </div>
                {searchResultV2.sections.conversations.map((c, i) => (
                  <div key={i} onClick={() => onSelectConversation(c.chat_name)}
                    style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', marginBottom: 6 }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isRanking ? 6 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isRanking && <span style={{ fontSize: 12, color: i === 0 ? '#E8604A' : '#c8c0ba', fontWeight: 600, width: 18, fontFamily: "'DM Sans'" }}>{i + 1}</span>}
                        <span style={{ fontSize: 14, fontWeight: i === 0 && isRanking ? 600 : 400, color: '#1A1A1A', fontFamily: "'DM Sans'" }}>{c.contact_name}</span>
                      </div>
                      <span style={{ fontFamily: isRanking ? "'Unbounded', sans-serif" : "'DM Sans'", fontWeight: isRanking ? 200 : 400, fontSize: isRanking ? 15 : 12, color: i === 0 && isRanking ? '#E8604A' : '#9a948f' }}>
                        {c.matchingMessages.toLocaleString()} {isRanking ? '' : 'matches'}
                      </span>
                    </div>
                    {isRanking && (
                      <div style={{ height: 3, borderRadius: 2, background: '#EAE5DF', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round((c.matchingMessages / maxMsg) * 100)}%`, background: i === 0 ? '#E8604A' : '#D4CFC9', borderRadius: 2 }} />
                      </div>
                    )}
                    {!isRanking && <div style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'", marginTop: 2 }}>{c.messageCount.toLocaleString()} messages · {c.dateRange}</div>}
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Messages section */}
          {searchResultV2.sections.messages.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 8, fontFamily: "'DM Sans'", fontWeight: 600 }}>Messages ({searchResultV2.sections.messages.length})</div>
              {searchResultV2.sections.messages.slice(0, 15).map((r, i) => (
                <div key={i} onClick={() => onSelectConversation(r.chat_name)}
                  style={{ padding: '12px 16px', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', marginBottom: 6 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8F4F0')} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: r.is_from_me ? '#E8604A' : '#2EC4A0', fontWeight: 500, fontFamily: "'DM Sans'" }}>
                      {r.is_from_me ? 'You' : r.contact_name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.04)', color: '#9a948f', fontFamily: "'DM Sans'" }}>{r.matchReason}</span>
                      <span style={{ fontSize: 10, color: '#c8c0ba', fontFamily: "'DM Sans'" }}>{new Date(r.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#4a4542', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{r.body}</div>
                </div>
              ))}
            </div>
          )}

          {/* Attachments section */}
          {searchResultV2.sections.attachments.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7F77DD', marginBottom: 8, fontFamily: "'DM Sans'", fontWeight: 600 }}>Attachments ({searchResultV2.sections.attachments.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {searchResultV2.sections.attachments.slice(0, 12).map((a, i) => (
                  <SearchAttachmentRow key={i} att={a} onSelect={() => onSelectConversation(a.chat_name)} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {searchResultV2.totalResults === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: '#9a948f', fontSize: 13, fontFamily: "'DM Sans'" }}>
              <div style={{ marginBottom: 8 }}>No results found for &ldquo;{searchResultV2.plan.originalQuery}&rdquo;</div>
              {searchResultV2.plan.timeRange && <div style={{ fontSize: 12 }}>Try widening the date range</div>}
              {searchResultV2.plan.people.length > 0 && <div style={{ fontSize: 12 }}>Try searching all conversations</div>}
            </div>
          )}
        </div>
      )}

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
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 40px', fontFamily: "'DM Sans', sans-serif", position: 'relative' }}>
    <style>{`
      @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      [data-surface] > div { transition: box-shadow 0.4s ease; }
      [data-surface="personal"] > div { box-shadow: 0 2px 14px rgba(232,96,74,0.05), 0 10px 30px rgba(0,0,0,0.04) !important; }
      [data-surface="usage"] > div { box-shadow: 0 2px 14px rgba(127,119,221,0.05), 0 10px 30px rgba(0,0,0,0.04) !important; }
      [data-surface="relationship"] > div { box-shadow: 0 2px 14px rgba(46,196,160,0.05), 0 10px 30px rgba(0,0,0,0.04) !important; }
    `}</style>

    {/* Ambient tint + glow */}
    <div style={{ position: 'sticky', top: 0, height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
      {(['relationship', 'personal', 'usage', 'conversational'] as const).map(s => (
        <div key={s} style={{ position: 'absolute', top: 0, left: -28, right: -28, height: '100vh', background: `linear-gradient(180deg, ${SURFACE_TOKENS[s].ambient} 0%, transparent 50%)`, opacity: insightSurface === s ? 1 : 0, transition: 'opacity 0.5s ease' }} />
      ))}
      {(['relationship', 'personal', 'usage', 'conversational'] as const).map(s => (
        <div key={`g-${s}`} style={{ position: 'absolute', top: 0, left: -28, right: -28, height: 200, background: `radial-gradient(ellipse 70% 100% at 50% -30%, ${SURFACE_TOKENS[s].glow}, transparent)`, opacity: insightSurface === s ? 1 : 0, transition: 'opacity 0.5s ease' }} />
      ))}
    </div>

    {/* Background word */}
    <div style={{ position: 'sticky', top: '28%', height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
      {(['relationship', 'personal', 'usage', 'conversational'] as const).map(s => (
        <div key={s} style={{ position: 'absolute', top: 0, left: 0, right: 0, fontSize: 130, fontWeight: 200, letterSpacing: '0.1em', color: SURFACE_TOKENS[s].faintText, fontFamily: "'Unbounded', sans-serif", textAlign: 'center', lineHeight: 1, userSelect: 'none' as const, whiteSpace: 'nowrap' as const, overflow: 'hidden' as const, opacity: insightSurface === s ? 1 : 0, transition: 'opacity 0.5s ease' }}>
          {SURFACE_TOKENS[s].word}
        </div>
      ))}
    </div>

    <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%', position: 'relative', zIndex: 1 }}>
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

      <div style={{ width: 32, height: 2, borderRadius: 1, background: 'rgba(46,196,160,0.3)', marginTop: -8, marginBottom: 16 }} />

      {/* Today in History */}
      {todayMemories.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14, marginBottom: 14 }}>
          <TodayInHistoryCard memories={todayMemories} chatNameMap={chatNameMap} onSelectConversation={onSelectConversation} />
        </div>
      )}

      {/* Global relationship insight grid */}
      <div data-surface="relationship" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14 }}>

        {/* ZONE 0 — Inner Circle */}
        {closenessData.length > 0 && (() => {
          const inner = closenessData.filter(c => c.tier === 'inner_circle').length
          const close = closenessData.filter(c => c.tier === 'close').length
          const regular = closenessData.filter(c => c.tier === 'regular').length
          const top5 = closenessData.slice(0, 5)
          return (
            <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 12, fontFamily: "'DM Sans'", fontWeight: 600 }}>Your inner circle</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {top5.map((c, i) => (
                  <div key={c.chat_identifier} onClick={() => onSelectConversation(c.chat_identifier)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0', borderBottom: i < top5.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                    <span style={{ width: 18, fontSize: 11, color: i === 0 ? '#2EC4A0' : '#c8c0ba', fontWeight: 600, fontFamily: "'DM Sans'" }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, color: '#1A1A1A', fontWeight: i === 0 ? 600 : 400, fontFamily: "'DM Sans'", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resolveName(c.chat_identifier, chatNameMap)}</span>
                    <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: `${tierColor(c.tier)}15`, color: tierColor(c.tier), fontFamily: "'DM Sans'", fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{formatTier(c.tier)}</span>
                    <span style={{ fontSize: 11, color: '#9a948f', fontFamily: "'DM Sans'", minWidth: 28, textAlign: 'right' }}>{Math.round(c.total_score)}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#9a948f', marginTop: 10, fontFamily: "'DM Sans'" }}>
                {inner > 0 ? `${inner} inner circle` : ''}{inner > 0 && close > 0 ? ' · ' : ''}{close > 0 ? `${close} close` : ''}{(inner > 0 || close > 0) && regular > 0 ? ' · ' : ''}{regular > 0 ? `${regular} regular` : ''}
              </div>
            </div>
          )
        })()}

        {/* ZONE 0.5 — Messaging Pulse */}
        {globalMonthly && globalMonthly.months.length >= 6 && (() => {
          const recent = globalMonthly.months.slice(-12)
          const maxCount = Math.max(...recent.map(m => m.count), 1)
          const topAnomaly = globalMonthly.anomalies.find(a => a.type === 'spike')
          return (
            <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 4, fontFamily: "'DM Sans'", fontWeight: 600 }}>Messaging pulse</div>
              <div style={{ fontSize: 12, color: '#9a948f', marginBottom: 10, fontFamily: "'DM Sans'" }}>Avg: {globalMonthly.avgPerMonth.toLocaleString()} msgs/month</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40, marginBottom: 6 }}>
                {recent.map((m, i) => {
                  const h = Math.max((m.count / maxCount) * 100, 3)
                  const color = m.isAnomaly ? (m.anomalyType === 'spike' ? '#E8604A' : '#c8c0ba') : '#EAE5DF'
                  return <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: '2px 2px 0 0', background: color, minHeight: 2 }} />
                })}
              </div>
              {topAnomaly && <div style={{ fontSize: 11, color: '#6f6a65', fontFamily: "'DM Sans'" }}>🔥 {topAnomaly.message}</div>}
            </div>
          )
        })()}

        {/* ZONE 0.55 — Signals Feed */}
        {activeAlerts.length > 0 && (
          <ProLock feature="ai_summaries" onOpenSettings={onOpenSettings}>
            <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 4, fontFamily: "'DM Sans'", fontWeight: 600 }}>Signals</div>
              <div style={{ fontSize: 12, color: '#9a948f', marginBottom: 10, fontFamily: "'DM Sans'" }}>What's changing in your relationships.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeAlerts.slice(0, 6).map((a, i) => {
                  const dotColor = a.severity === 'significant' ? '#E8604A' : a.severity === 'notable' ? '#fbbf24' : '#2EC4A0'
                  return (
                    <div key={i} onClick={() => onSelectConversation(a.chat_identifier)} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '4px 0' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, marginTop: 5, flexShrink: 0 }} />
                      <div style={{ fontSize: 12, color: '#4a4542', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{a.message}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </ProLock>
        )}

        {/* ZONE 0.57 — Follow Up (Proactive Intelligence) */}
        {proactiveItems.length > 0 && (
          <ProLock feature="ai_proactive_intel" onOpenSettings={onOpenSettings}>
          <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#E8604A', marginBottom: 4, fontFamily: "'DM Sans'", fontWeight: 600 }}>Follow up</div>
            <div style={{ fontSize: 12, color: '#9a948f', marginBottom: 10, fontFamily: "'DM Sans'" }}>Commitments and plans from your conversations.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {proactiveItems.slice(0, 6).map(item => {
                const typeColor: Record<string, string> = { commitment: '#E8604A', event: '#7F77DD', follow_up: '#2EC4A0', birthday: '#fbbf24', plan: '#9a948f' }
                const typeLabel: Record<string, string> = { commitment: 'Commitment', event: 'Event', follow_up: 'Follow up', birthday: 'Birthday', plan: 'Plan' }
                const priorityDot = item.priority === 2 ? '#E8604A' : item.priority === 1 ? '#fbbf24' : '#c8c0ba'
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: priorityDot, marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#1A1A1A', lineHeight: 1.5, fontFamily: "'DM Sans'" }}>{item.description}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${typeColor[item.item_type] || '#9a948f'}15`, color: typeColor[item.item_type] || '#9a948f', fontFamily: "'DM Sans'", fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{typeLabel[item.item_type] || item.item_type}</span>
                        <span onClick={() => onSelectConversation(item.chat_identifier)} style={{ fontSize: 10, color: '#2EC4A0', cursor: 'pointer', fontFamily: "'DM Sans'" }}>{item.contact_name}</span>
                        {item.due_date && <span style={{ fontSize: 10, color: '#9a948f', fontFamily: "'DM Sans'" }}>{item.due_date.slice(5)}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginTop: 2 }}>
                      <button onClick={() => handleCompleteProactive(item.id)} style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(46,196,160,0.3)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#2EC4A0', padding: 0 }} title="Done">✓</button>
                      <button onClick={() => handleDismissProactive(item.id)} style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.08)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#9a948f', padding: 0 }} title="Dismiss">✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </ProLock>
        )}

        {/* ZONE 0.6 — Media Intelligence */}
        {globalMedia && (globalMedia.topSenders.length > 0 || globalMedia.topReceivers.length > 0) && (
          <div style={{ gridColumn: 'span 6', borderRadius: 16, padding: '20px 22px', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#7F77DD', marginBottom: 10, fontFamily: "'DM Sans'", fontWeight: 600 }}>Media intelligence</div>
            {globalMedia.topSenders.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 4, fontFamily: "'DM Sans'" }}>Who sends you the most</div>
                {globalMedia.topSenders.slice(0, 3).map((s, i) => {
                  const mc = chats.find(c => c.rawName === s.chatName)?.messageCount || 0
                  const rate = mc > 0 ? Math.round(s.count / mc * 100) : 0
                  return (
                    <div key={s.chatName} onClick={() => onSelectConversation(s.chatName)} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans'" }}>
                      <span style={{ color: '#1A1A1A', fontWeight: i === 0 ? 600 : 400 }}>{resolveName(s.chatName, chatNameMap)}</span>
                      <span style={{ color: '#7F77DD' }}>{mc > 0 ? `${rate}% media` : s.count.toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {globalMedia.topReceivers.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 4, fontFamily: "'DM Sans'" }}>Who you send the most to</div>
                {globalMedia.topReceivers.slice(0, 3).map((s, i) => {
                  const mc = chats.find(c => c.rawName === s.chatName)?.messageCount || 0
                  const rate = mc > 0 ? Math.round(s.count / mc * 100) : 0
                  return (
                    <div key={s.chatName} onClick={() => onSelectConversation(s.chatName)} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', cursor: 'pointer', fontSize: 12, fontFamily: "'DM Sans'" }}>
                      <span style={{ color: '#1A1A1A', fontWeight: i === 0 ? 600 : 400 }}>{resolveName(s.chatName, chatNameMap)}</span>
                      <span style={{ color: '#E8604A' }}>{mc > 0 ? `${rate}% media` : s.count.toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>
            )}
            {globalMedia.mediaHeavy.filter(m => m.ratio > 30).length > 0 && (
              <div style={{ borderTop: '1px solid rgba(0,0,0,0.04)', paddingTop: 6 }}>
                <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9a948f', marginBottom: 4, fontFamily: "'DM Sans'" }}>Media-heavy</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {globalMedia.mediaHeavy.filter(m => m.ratio > 30).slice(0, 4).map(m => (
                    <span key={m.chatName} style={{ fontSize: 10, color: '#7F77DD', fontFamily: "'DM Sans'" }}>{resolveName(m.chatName, chatNameMap)} ({m.ratio}%)</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
            stat={`${Math.round(topFunny.laughsReceived / Math.max(topFunny.messageCount, 1) * 100)}% laugh rate (${topFunny.laughsReceived.toLocaleString()} total)`}
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
            stat={`${Math.round(topAttach.attachmentCount / Math.max(topAttach.messageCount, 1) * 100)}% media rate (${topAttach.attachmentCount.toLocaleString()} files)`}
            flavor="Photos, memes, evidence — all of it."
            emoji="📎" accentColor="#7F77DD" span={4} />
        ) : null}

        {/* ZONE 5 — Leaderboard tiles */}
        {isStatsLoading ? <WarmingCard span={6} /> : (
          <div style={{ ...tileBase, gridColumn: 'span 6' }}>
            <TileLabel text="Who makes you laugh most" />
            {byLaughsReceived.filter(c => c.laughsReceived > 0).slice(0, 3).map((c, i) => (
              <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)}
                sub={laughLabels[i] || ''} value={`${Math.round(c.laughsReceived / Math.max(c.messageCount, 1) * 100)}% laugh rate`} />
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
                value={`${Math.round(c.laughsGenerated / Math.max(c.messageCount, 1) * 100)}% laugh rate`} />
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
