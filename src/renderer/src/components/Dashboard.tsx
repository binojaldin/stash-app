import { Lock } from 'lucide-react'
import type { Stats, ChatNameEntry } from '../types'

interface Props {
  stats: Stats
  chatNameMap: Record<string, string>
  onSelectConversation: (rawName: string) => void
  dateRange?: string
  scopedPerson?: string | null
  onClearScope?: () => void
}

function heroTitle(range: string): string {
  const month = MONTH_NAMES[new Date().getMonth()]
  const year = new Date().getFullYear()
  switch (range) {
    case 'month': return `${month}. Your messages, surfaced.`
    case 'year': return `${year}. Your messages, surfaced.`
    case '7days': return `Last 7 days. Your messages, surfaced.`
    case '30days': return `Last 30 days. Your messages, surfaced.`
    default: return `Your messages, surfaced.`
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

export function Dashboard({ stats, chatNameMap, onSelectConversation, dateRange = 'all', scopedPerson, onClearScope }: Props): JSX.Element {
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

  // ── Relationship view — "The [Name] Files" ──
  if (scopedPerson) {
    const pn = resolveName(scopedPerson, chatNameMap)
    const firstName = pn.split(' ')[0]
    const pd = chats.find((c) => c.rawName === scopedPerson)
    const dateLabel = dateRange === 'all' ? 'All time' : dateRange === 'month' ? 'This month' : dateRange === 'year' ? 'This year' : dateRange === '30days' ? 'Last 30 days' : 'Last 7 days'
    const initPct = pd ? Math.min(99, Math.round((pd.initiationCount / Math.max(pd.messageCount * 0.1, 1)) * 100)) : 0
    const sentPct = pd ? Math.round((pd.sentCount / Math.max(pd.messageCount, 1)) * 100) : 50

    const RelCard = ({ emoji, title, metric, sentence, flavor, span }: { emoji: string; title: string; metric: string; sentence: string; flavor: string; span: number }): JSX.Element => (
      <div style={{ ...tileBase, gridColumn: `span ${span}` }}>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', marginBottom: 8, fontWeight: 600 }}>{emoji} {title}</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: '#2EC4A0', marginBottom: 6, lineHeight: 1.2 }}>{metric}</div>
        <div style={{ fontSize: 14, color: '#1A1A1A', marginBottom: 4, fontWeight: 500 }}>{sentence}</div>
        <div style={{ fontSize: 12, color: '#9a948f', fontStyle: 'italic' }}>{flavor}</div>
      </div>
    )

    const ComingSoonCard = ({ emoji, title, span }: { emoji: string; title: string; span: number }): JSX.Element => (
      <div style={{ ...tileBase, gridColumn: `span ${span}`, opacity: 0.5, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 140 }}>
        <div style={{ fontSize: 24, marginBottom: 6 }}>{emoji}</div>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#2EC4A0', fontWeight: 600, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#2EC4A0' }}>Coming soon</div>
      </div>
    )

    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 40px', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
          {/* Topbar */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
            <div><span style={{ fontSize: 18, color: '#1A1A1A', fontWeight: 500 }}>{pn}</span><span style={{ fontSize: 12, color: '#9a948f', marginLeft: 10 }}>{dateLabel}</span></div>
            <span style={{ color: '#9a948f', letterSpacing: '0.2em', fontSize: 20 }}>•••</span>
          </div>

          {/* Hero — "The [Name] Files" */}
          <div style={{ background: '#1E2826', borderRadius: 22, padding: 28, marginBottom: 20, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', right: -80, bottom: -120, width: 320, height: 320, background: 'radial-gradient(circle, rgba(46,196,160,0.18) 0%, transparent 62%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(46,196,160,0.7)', marginBottom: 12 }}>THE DYNAMIC</div>
              <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 28, color: 'white', letterSpacing: '0.02em', marginBottom: 10 }}>The {firstName} Files.</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.68)', lineHeight: 1.7 }}>
                {pd ? `${pd.messageCount.toLocaleString()} messages exchanged. ${pd.attachmentCount.toLocaleString()} attachments shared.` : ''}
              </div>
            </div>
          </div>

          {/* Insight cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24 }}>
            {pd && <>
              <RelCard emoji="🎭" title="Comedy Advantage" span={4}
                metric={pd.laughsReceived > pd.laughsGenerated ? 'You win' : `${firstName} wins`}
                sentence={`You got ${pd.laughsGenerated.toLocaleString()} laughs out of them.`}
                flavor="They're your best audience." />
              <RelCard emoji="😂" title="Your Comedian" span={4}
                metric={pd.laughsReceived.toLocaleString()}
                sentence={`${firstName} made you laugh ${pd.laughsReceived.toLocaleString()} times.`}
                flavor="Certified funny." />
              <RelCard emoji="⚡" title="Conversation Instigator" span={4}
                metric={`${initPct}%`}
                sentence={`You started ${initPct}% of threads.`}
                flavor={initPct > 50 ? 'You keep this thing alive.' : 'They reach out more.'} />
              <RelCard emoji="💬" title="Message Balance" span={6}
                metric={`${sentPct}/${100 - sentPct}`}
                sentence={`You sent ${sentPct}% of the words.`}
                flavor={sentPct > 55 ? 'You talk more. No shame.' : sentPct < 45 ? 'They do most of the talking.' : 'Perfectly balanced, as all things should be.'} />
              <RelCard emoji="📸" title="The Archive" span={6}
                metric={pd.attachmentCount.toLocaleString()}
                sentence={`${pd.attachmentCount.toLocaleString()} things shared between you.`}
                flavor="Photos, memes, evidence." />
            </>}
            <ComingSoonCard emoji="🌙" title="Night Owls" span={4} />
            <ComingSoonCard emoji="🔥" title="Peak Chaos Hour" span={4} />
            <ComingSoonCard emoji="🧵" title="Marathon Thread" span={4} />
          </div>
        </div>
      </div>
    )
  }

  const laughLabels = ['Funniest friend', 'Closest behind', 'Group chat chaos']

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 40px', fontFamily: "'DM Sans', sans-serif" }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#8a8480' }}>
          {currentMonth} Wrap · surfaced automatically
        </span>
        <span style={{ color: '#9a948f', letterSpacing: '0.2em', fontSize: 20 }}>•••</span>
      </div>

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
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Funniest person" />
          {topFunny && topFunny.laughsReceived > 0 ? (
            <>
              <Metric value={resolveName(topFunny.rawName, chatNameMap)} sub={`${topFunny.laughsReceived.toLocaleString()} times they made you laugh`} />
              <CtaPill text="See why → Pro" />
            </>
          ) : <div style={{ color: '#9a948f', fontSize: 13 }}>No laugh data for this period</div>}
        </div>

        {/* Tile 2 — Initiation balance */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Initiation balance" />
          <Metric value={`${initiationPct}%`} sub="You started most conversations this month." />
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
        <div style={{ ...tileBase, gridColumn: 'span 8' }}>
          <TileLabel text="Who makes you laugh most" />
          {byLaughsReceived.filter((c) => c.laughsReceived > 0).slice(0, 3).map((c, i) => (
            <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)} sub={laughLabels[i] || ''} value={`${c.laughsReceived.toLocaleString()} laughs`} />
          ))}
          {byLaughsReceived.every((c) => c.laughsReceived === 0) && <div style={{ color: '#9a948f', fontSize: 13, padding: '12px 0' }}>No laugh data for this period</div>}
          <CtaPill text="See exact messages → Pro" />
        </div>

        {/* Tile 5 — Most attachments */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most attachments" />
          {topAttach ? (
            <Metric value={topAttach.attachmentCount.toLocaleString()} sub={`${resolveName(topAttach.rawName, chatNameMap)} sent the most photos, screenshots, and files.`} />
          ) : <div style={{ color: '#6f6a65' }}>No data yet</div>}
        </div>

        {/* Tile 6 — Late night (coming soon) */}
        <ComingSoonTile label="After 11pm" span={4} />

        {/* Tile 7 — Most active group */}
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most active group" />
          {topGroup ? (
            <Metric value={resolveName(topGroup.rawName, chatNameMap)} sub={`${topGroup.messageCount.toLocaleString()} messages exchanged`} />
          ) : <div style={{ color: '#6f6a65' }}>No group chats indexed</div>}
        </div>

        {/* Tile 8 — Who you reach out to most (full width leaderboard) */}
        <div style={{ ...tileBase, gridColumn: 'span 12' }}>
          <TileLabel text="Who you reach out to most" />
          {byInitiation.slice(0, 3).map((c, i) => (
            <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)} sub={`${c.initiationCount.toLocaleString()} conversation starts`} value={c.initiationCount.toLocaleString()} />
          ))}
        </div>
      </div>
    </div>
    </div>
  )
}
