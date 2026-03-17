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
function arcSentence(arc: string, name: string): string {
  const m: Record<string, string> = { new: `${name} is a new presence in your messages.`, growing: `You and ${name} have been talking more than ever.`, fading: `You and ${name} have been less connected lately.`, rekindled: `You and ${name} found your way back.`, steady: 'Consistent, reliable, always there.' }
  return m[arc] || ''
}
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

export function Dashboard({ stats, chatNameMap, onSelectConversation, dateRange = 'all', scopedPerson, onClearScope, insightSurface = 'relationship', onSurfaceChange }: Props): JSX.Element {
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
              {/* Enriched stats from getConversationStats */}
              {convStats?.relationshipArc && (
                <RelCard emoji={arcEmoji[convStats.relationshipArc] || '⚖️'} title="Relationship Arc" span={4}
                  metric={arcLabel[convStats.relationshipArc] || 'Steady'}
                  sentence={arcSentence(convStats.relationshipArc, firstName)}
                  flavor="" />
              )}
              {convStats && convStats.longestStreakDays > 0 && (
                <RelCard emoji="🔥" title="Longest Streak" span={4}
                  metric={`${convStats.longestStreakDays} days`}
                  sentence="Your longest run of consecutive daily messages."
                  flavor={convStats.longestStreakDays > 30 ? "That's serious dedication." : ''} />
              )}
              {convStats?.peakHour !== null && convStats?.peakHour !== undefined && (
                <RelCard emoji="🕐" title="Your Peak Hour" span={4}
                  metric={formatHour(convStats.peakHour)}
                  sentence="When most of your messages happen."
                  flavor="" />
              )}
              {convStats?.firstMessageDate && (
                <RelCard emoji="📅" title="Since" span={4}
                  metric={new Date(convStats.firstMessageDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  sentence={`Your first message with ${firstName}.`}
                  flavor={((Date.now() - new Date(convStats.firstMessageDate).getTime()) / 86400000) > 365 ? 'A long-standing relationship.' : ''} />
              )}
              {convStats?.avgResponseTimeMinutes !== null && convStats?.avgResponseTimeMinutes !== undefined && (
                <RelCard emoji="⏱" title="Reply Speed" span={4}
                  metric={`${convStats.avgResponseTimeMinutes}m`}
                  sentence="Your average reply time."
                  flavor={convStats.avgResponseTimeMinutes < 5 ? 'Lightning fast.' : convStats.avgResponseTimeMinutes > 60 ? 'You take your time.' : ''} />
              )}
              {pd && pd.lateNightRatio > 0 ? (
                <RelCard emoji="🌙" title="Night Owls" span={4}
                  metric={`${pd.lateNightRatio}%`}
                  sentence={`${pd.lateNightRatio}% of your messages happen after 11pm.`}
                  flavor={pd.lateNightRatio > 40 ? 'This is a late-night relationship.' : 'Mostly daytime people.'} />
              ) : <SoonCard emoji="🌙" title="Night Owls" span={4} />}
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
    <div style={{ display: 'flex', gap: 6, marginBottom: 24, marginTop: 4 }}>
      {([
        { id: 'relationship' as const, label: 'Relationship', color: '#2EC4A0', meta: `${individuals.length} contacts` },
        { id: 'personal' as const, label: 'Personal', color: '#E8604A', meta: '8 insights' },
        { id: 'usage' as const, label: 'Usage', color: '#7F77DD', meta: `since ${earliestYear}` },
        { id: 'conversational' as const, label: 'Conversational', color: '#888780', meta: 'AI · V2' },
      ]).map(({ id, label, color, meta }) => (
        <button key={id} onClick={() => onSurfaceChange(id)}
          style={{
            display: 'flex', flexDirection: 'column', padding: '7px 14px',
            borderRadius: 10, cursor: 'pointer', border: '1px solid',
            borderColor: insightSurface === id ? 'rgba(0,0,0,0.08)' : 'transparent',
            background: insightSurface === id ? '#fff' : 'rgba(255,255,255,0.5)',
            fontFamily: "'DM Sans'"
          }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: insightSurface === id ? color : '#6f6a65' }}>{label}</span>
          <span style={{ fontSize: 10, color: '#9a948f', marginTop: 1 }}>{meta}</span>
        </button>
      ))}
    </div>
  )

  // ── Personal Insights Surface ──
  const personalSurface = (
    <div>
      <div style={{ background: '#26211d', borderRadius: 18, padding: 24, marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -60, bottom: -80, width: 240, height: 240, background: 'radial-gradient(circle,rgba(232,96,74,0.2) 0%,transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(232,96,74,0.7)', marginBottom: 10 }}>Personal insights</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 22, color: 'white', marginBottom: 6 }}>What your habits say about you.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>Patterns in how, when, and who you communicate with — without reading a single message.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24 }}>
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Most messaged" />
          {byMessages[0] ? <Metric value={resolveName(byMessages[0].rawName, chatNameMap)} sub={`${byMessages[0].messageCount.toLocaleString()} messages exchanged`} /> : <div style={{ color: '#6f6a65' }}>No data</div>}
        </div>
        <div style={{ ...tileBase, gridColumn: 'span 4' }}>
          <TileLabel text="Conversation starter" />
          <Metric value={`${initiationPct}%`} sub={initiationPct > 60 ? 'You start most conversations.' : initiationPct < 40 ? 'Others reach out to you more.' : 'Balanced — you share the load.'} />
          <BarTrack pct={initiationPct} />
        </div>
        {(() => {
          const top3Messages = byMessages.slice(0, 3).reduce((s, c) => s + c.messageCount, 0)
          const totalMessages = chats.reduce((s, c) => s + c.messageCount, 0)
          const concentration = totalMessages > 0 ? Math.round((top3Messages / totalMessages) * 100) : 0
          return (
            <div style={{ ...tileBase, gridColumn: 'span 4' }}>
              <TileLabel text="Concentration" />
              <Metric value={`${concentration}%`} sub="of your messages go to your top 3 contacts" />
              <BarTrack pct={concentration} />
            </div>
          )
        })()}
        <div style={{ ...tileBase, gridColumn: 'span 6' }}>
          <TileLabel text="Your comedy record" />
          {byLaughsGenerated[0] && byLaughsGenerated[0].laughsGenerated > 0 ? (
            <Metric value={resolveName(byLaughsGenerated[0].rawName, chatNameMap)} sub={`You make them laugh most — ${byLaughsGenerated[0].laughsGenerated.toLocaleString()} times`} />
          ) : <div style={{ color: '#9a948f', fontSize: 13 }}>No laugh data yet</div>}
        </div>
        {(() => {
          const groupMessages = groups.reduce((s, c) => s + c.messageCount, 0)
          const totalMsgs = chats.reduce((s, c) => s + c.messageCount, 0)
          const groupPct = totalMsgs > 0 ? Math.round((groupMessages / totalMsgs) * 100) : 0
          return (
            <div style={{ ...tileBase, gridColumn: 'span 6' }}>
              <TileLabel text="Group vs 1:1" />
              <Metric value={`${groupPct}%`} sub={groupPct > 50 ? "You're mostly a group chat person." : 'You prefer 1:1 conversations.'} />
              <BarTrack pct={groupPct} />
            </div>
          )
        })()}
        {(() => {
          const topNightOwl = [...individuals].sort((a, b) => b.lateNightRatio - a.lateNightRatio)[0]
          return topNightOwl && topNightOwl.lateNightRatio > 0 ? (
            <div style={{ ...tileBase, gridColumn: 'span 4' }}>
              <TileLabel text="Night owl score" />
              <Metric value={`${topNightOwl.lateNightRatio}%`} sub={`of messages with ${resolveName(topNightOwl.rawName, chatNameMap)} happen after 11pm`} />
            </div>
          ) : <ComingSoonTile label="Night owl score" span={4} />
        })()}
        {(() => {
          const fastest = [...individuals].filter(c => c.avgReplyMinutes > 0 && c.avgReplyMinutes < 60).sort((a, b) => a.avgReplyMinutes - b.avgReplyMinutes)[0]
          return fastest ? (
            <div style={{ ...tileBase, gridColumn: 'span 4' }}>
              <TileLabel text="You reply fastest to" />
              <Metric value={resolveName(fastest.rawName, chatNameMap)} sub={`~${fastest.avgReplyMinutes} min average reply time`} />
            </div>
          ) : <ComingSoonTile label="Reply speed" span={4} />
        })()}
        {(() => {
          const gone = [...individuals].filter(c => c.messageCount > 50).map(c => ({ ...c, days: Math.floor((Date.now() - new Date(c.lastMessageDate).getTime()) / 86400000) })).filter(c => c.days > 30).sort((a, b) => b.days - a.days)[0]
          return gone ? (
            <div style={{ ...tileBase, gridColumn: 'span 4' }}>
              <TileLabel text="Gone quiet" />
              <Metric value={resolveName(gone.rawName, chatNameMap)} sub={`${gone.days} days since your last message`} />
            </div>
          ) : <ComingSoonTile label="Gone quiet" span={4} />
        })()}
      </div>
    </div>
  )

  // ── Usage Insights Surface ──
  const usageSurface = (
    <div>
      <div style={{ background: '#1E1A2E', borderRadius: 18, padding: 24, marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -60, bottom: -80, width: 240, height: 240, background: 'radial-gradient(circle,rgba(127,119,221,0.2) 0%,transparent 65%)', pointerEvents: 'none' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(127,119,221,0.7)', marginBottom: 10 }}>Usage insights</div>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 200, fontSize: 22, color: 'white', marginBottom: 6 }}>Your messaging, by the numbers.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>The full picture of your iMessage activity — volume, attachments, and patterns across time.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24 }}>
        <div style={{ ...tileBase, gridColumn: 'span 4' }}><TileLabel text="Total indexed" /><Metric value={stats.total.toLocaleString()} sub="attachments in your archive" /></div>
        <div style={{ ...tileBase, gridColumn: 'span 4' }}><TileLabel text="Active conversations" /><Metric value={chats.length.toLocaleString()} sub="conversations with indexed content" /></div>
        <div style={{ ...tileBase, gridColumn: 'span 4' }}><TileLabel text="Group chats" /><Metric value={groups.length.toLocaleString()} sub={`of ${chats.length} total conversations`} /></div>
        <div style={{ ...tileBase, gridColumn: 'span 3' }}><TileLabel text="Images" /><Metric value={stats.images.toLocaleString()} sub="photos and screenshots" /></div>
        <div style={{ ...tileBase, gridColumn: 'span 3' }}><TileLabel text="Videos" /><Metric value={stats.videos.toLocaleString()} sub="video files" /></div>
        <div style={{ ...tileBase, gridColumn: 'span 3' }}><TileLabel text="Documents" /><Metric value={stats.documents.toLocaleString()} sub="files and docs" /></div>
        <div style={{ ...tileBase, gridColumn: 'span 3' }}><TileLabel text="Audio" /><Metric value={stats.audio.toLocaleString()} sub="voice notes and music" /></div>
        <div style={{ ...tileBase, gridColumn: 'span 6' }}>
          <TileLabel text="Most files shared" />
          {byAttachments[0] ? <Metric value={resolveName(byAttachments[0].rawName, chatNameMap)} sub={`${byAttachments[0].attachmentCount.toLocaleString()} attachments exchanged`} /> : <div style={{ color: '#6f6a65' }}>No data</div>}
        </div>
        <div style={{ ...tileBase, gridColumn: 'span 6' }}>
          <TileLabel text="Most active group" />
          {topGroup ? <Metric value={resolveName(topGroup.rawName, chatNameMap)} sub={`${topGroup.messageCount.toLocaleString()} messages`} /> : <div style={{ color: '#9a948f', fontSize: 13 }}>No group chats found</div>}
        </div>
        <ComingSoonTile label="Activity heatmap · days × hours" span={12} />
        <ComingSoonTile label="Year-by-year timeline" span={12} />
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
    <div style={{ maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      {/* Topbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, marginBottom: 8 }}>
        <span style={{ fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#8a8480' }}>
          {currentMonth} Wrap · surfaced automatically
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
        <div style={{ ...tileBase, gridColumn: 'span 8' }}>
          <TileLabel text="Who makes you laugh most" />
          {byLaughsReceived.filter((c) => c.laughsReceived > 0).slice(0, 3).map((c, i) => (
            <LeaderRow key={c.rawName} rank={i + 1} name={resolveName(c.rawName, chatNameMap)} sub={laughLabels[i] || ''} value={`${c.laughsReceived.toLocaleString()} laughs`} />
          ))}
          {byLaughsReceived.every((c) => c.laughsReceived === 0) && <div style={{ color: '#9a948f', fontSize: 13, padding: '12px 0' }}>No laugh data for this period</div>}
          <CtaPill text="See exact messages → Pro" />
        </div>

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
