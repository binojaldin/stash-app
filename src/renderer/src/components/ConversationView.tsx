import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Image } from 'lucide-react'

interface ConversationMessage {
  rowId: number
  body: string
  isFromMe: boolean
  sentAt: string
  hasAttachment: boolean
  attachmentId?: number
}

interface ConversationViewProps {
  chatIdentifier: string
  contactName: string
  contactColor: string
  contactInitials: string
  availableYears: number[]
  anchorYear?: number
  anchorMonth?: number
  hideHeader?: boolean
  onClose?: () => void
  onOpenAttachment?: (attachmentId: number) => void
  onPeriodChange?: (year: number | null, month: number | null) => void
}

const PAGE_SIZE = 60
const MAX_MESSAGES = 300

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Simple URL regex
const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

// Emoji-only: 1-3 emoji codepoints with optional variation selectors/ZWJ, nothing else
const EMOJI_ONLY_RE = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*(?:\s*(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*){0,2}\s*$/u

function isEmojiOnly(text: string): boolean {
  if (!text || text.length > 20) return false
  return EMOJI_ONLY_RE.test(text.trim())
}

function renderMessageBody(body: string, textColor: string): JSX.Element {
  // Split body into text and URL segments
  const parts: JSX.Element[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const re = new RegExp(URL_RE.source, 'g')
  let key = 0

  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{body.slice(lastIndex, match.index)}</span>)
    }
    parts.push(
      <span key={key++} style={{ color: '#5B9BAF', textDecoration: 'underline', textDecorationColor: 'rgba(91,155,175,0.3)', wordBreak: 'break-all' }}>
        {match[0]}
      </span>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) {
    parts.push(<span key={key++}>{body.slice(lastIndex)}</span>)
  }

  return <div style={{ fontSize: 13, lineHeight: 1.45, color: textColor, wordBreak: 'break-word' }}>{parts}</div>
}

function formatDateSeparator(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffMs = today.getTime() - msgDay.getTime()
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffDays === 0) return 'TODAY'
  if (diffDays === 1) return 'YESTERDAY'
  if (diffDays < 7) return ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][date.getDay()]
  if (date.getFullYear() === now.getFullYear()) {
    return `${MONTH_LABELS[date.getMonth()].toUpperCase()} ${date.getDate()}`
  }
  return `${MONTH_LABELS[date.getMonth()].toUpperCase()} ${date.getDate()}, ${date.getFullYear()}`
}

function formatTimestamp(date: Date): string {
  const h = date.getHours()
  const m = date.getMinutes()
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function parseDate(sentAt: string): Date {
  if (!sentAt) return new Date(0)
  return new Date(sentAt.replace(' ', 'T'))
}

function minutesBetween(a: string, b: string): number {
  const da = parseDate(a)
  const db = parseDate(b)
  return Math.abs(da.getTime() - db.getTime()) / 60000
}

interface MessageGroup {
  type: 'messages'
  isFromMe: boolean
  messages: ConversationMessage[]
}

interface DateSeparator {
  type: 'date'
  label: string
  isYearMarker?: boolean
}

interface PhotoBurst {
  type: 'photo-burst'
}

type RenderItem = MessageGroup | DateSeparator | PhotoBurst

function buildRenderItems(messages: ConversationMessage[]): RenderItem[] {
  if (messages.length === 0) return []

  const items: RenderItem[] = []
  let currentGroup: MessageGroup | null = null
  let lastYear: number | null = null
  let recentAttachments = 0
  let recentMessageCount = 0
  let photoBurstShown = false

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const msgDate = parseDate(msg.sentAt)
    const gapMinutes = i > 0 ? minutesBetween(messages[i - 1].sentAt, msg.sentAt) : Infinity

    if (i === 0 || gapMinutes > 60) {
      if (currentGroup) { items.push(currentGroup); currentGroup = null }

      if (lastYear !== null && msgDate.getFullYear() !== lastYear) {
        items.push({ type: 'date', label: `${msgDate.getFullYear()}`, isYearMarker: true })
      } else {
        items.push({ type: 'date', label: formatDateSeparator(msgDate) })
      }
      recentAttachments = 0
      recentMessageCount = 0
      photoBurstShown = false
    }

    if (msg.hasAttachment) recentAttachments++
    recentMessageCount++
    if (recentAttachments >= 3 && recentMessageCount <= 10 && !photoBurstShown) {
      if (currentGroup) { items.push(currentGroup); currentGroup = null }
      items.push({ type: 'photo-burst' })
      photoBurstShown = true
    }

    const canGroup = currentGroup &&
      currentGroup.isFromMe === msg.isFromMe &&
      currentGroup.messages.length > 0 &&
      minutesBetween(currentGroup.messages[currentGroup.messages.length - 1].sentAt, msg.sentAt) <= 5

    if (canGroup) {
      currentGroup!.messages.push(msg)
    } else {
      if (currentGroup) items.push(currentGroup)
      currentGroup = { type: 'messages', isFromMe: msg.isFromMe, messages: [msg] }
    }

    lastYear = msgDate.getFullYear()
  }

  if (currentGroup) items.push(currentGroup)
  return items
}

export function ConversationView({
  chatIdentifier, contactName, contactColor, contactInitials,
  availableYears, anchorYear, anchorMonth, hideHeader, onClose, onOpenAttachment, onPeriodChange
}: ConversationViewProps): JSX.Element {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [hasNewer, setHasNewer] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [initialLoad, setInitialLoad] = useState(true)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef(false)
  const shouldScrollToBottom = useRef(true)

  // Load initial messages — anchored to period if provided, else most recent
  const loadInitial = useCallback(async () => {
    setInitialLoad(true)

    if (anchorYear !== undefined && anchorYear !== null) {
      // Jump to the first message of the anchor period
      const anchor = await window.api.getFirstMessageForPeriod(chatIdentifier, anchorYear, anchorMonth)
      if (anchor) {
        shouldScrollToBottom.current = false
        const page = await window.api.getMessagesForChat(chatIdentifier, PAGE_SIZE, undefined, anchor.rowId - 1)
        setMessages(page.messages)
        setHasOlder(page.hasOlder)
        setHasNewer(page.hasNewer)
        setInitialLoad(false)
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0
        })
        return
      }
    }

    // Default: load most recent
    shouldScrollToBottom.current = true
    const result = await window.api.getMessagesForChat(chatIdentifier, PAGE_SIZE)
    setMessages(result.messages)
    setHasOlder(result.hasOlder)
    setHasNewer(result.hasNewer)
    setInitialLoad(false)
  }, [chatIdentifier, anchorYear, anchorMonth])

  useEffect(() => { loadInitial() }, [loadInitial])

  useEffect(() => {
    if (!initialLoad && shouldScrollToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      shouldScrollToBottom.current = false
    }
  }, [initialLoad, messages])

  const loadOlder = useCallback(async () => {
    if (!hasOlder || isLoadingRef.current || messages.length === 0) return
    isLoadingRef.current = true
    setLoadingOlder(true)
    const firstRowId = messages[0].rowId
    const scrollEl = scrollRef.current
    const prevScrollHeight = scrollEl?.scrollHeight || 0

    const result = await window.api.getMessagesForChat(chatIdentifier, PAGE_SIZE, firstRowId)
    setMessages(prev => {
      const combined = [...result.messages, ...prev]
      if (combined.length > MAX_MESSAGES) { setHasNewer(true); return combined.slice(0, MAX_MESSAGES) }
      return combined
    })
    setHasOlder(result.hasOlder)

    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight - prevScrollHeight
      isLoadingRef.current = false
      setLoadingOlder(false)
    })
  }, [chatIdentifier, hasOlder, messages])

  const loadNewer = useCallback(async () => {
    if (!hasNewer || isLoadingRef.current || messages.length === 0) return
    isLoadingRef.current = true
    setLoadingNewer(true)
    const lastRowId = messages[messages.length - 1].rowId

    const result = await window.api.getMessagesForChat(chatIdentifier, PAGE_SIZE, undefined, lastRowId)
    setMessages(prev => {
      const combined = [...prev, ...result.messages]
      if (combined.length > MAX_MESSAGES) { setHasOlder(true); return combined.slice(combined.length - MAX_MESSAGES) }
      return combined
    })
    setHasNewer(result.hasNewer)
    isLoadingRef.current = false
    setLoadingNewer(false)
  }, [chatIdentifier, hasNewer, messages])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollTop < 400 && hasOlder && !isLoadingRef.current) loadOlder()
    if (scrollHeight - scrollTop - clientHeight < 400 && hasNewer && !isLoadingRef.current) loadNewer()
  }, [hasOlder, hasNewer, loadOlder, loadNewer])

  const jumpToDate = useCallback(async (year: number, month?: number) => {
    const result = await window.api.getFirstMessageForPeriod(chatIdentifier, year, month)
    if (!result) return
    const page = await window.api.getMessagesForChat(chatIdentifier, PAGE_SIZE, undefined, result.rowId - 1)
    setMessages(page.messages)
    setHasOlder(page.hasOlder)
    setHasNewer(page.hasNewer)
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 })
  }, [chatIdentifier])

  const handleYearClick = useCallback((year: number) => {
    if (selectedYear === year) {
      setSelectedYear(null)
      onPeriodChange?.(null, null)
    } else {
      setSelectedYear(year)
      jumpToDate(year)
      onPeriodChange?.(year, null)
    }
  }, [selectedYear, jumpToDate, onPeriodChange])

  const handleMonthClick = useCallback((month: number) => {
    if (selectedYear) {
      jumpToDate(selectedYear, month)
      onPeriodChange?.(selectedYear, month)
    }
  }, [selectedYear, jumpToDate, onPeriodChange])

  const renderItems = useMemo(() => buildRenderItems(messages), [messages])

  const messageCount = messages.length
  const yearRange = useMemo(() => {
    if (availableYears.length === 0) return ''
    const min = availableYears[availableYears.length - 1]
    const max = availableYears[0]
    return min === max ? `${min}` : `${min} – ${max}`
  }, [availableYears])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0A0907', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      {!hideHeader && (
        <div style={{ flexShrink: 0, padding: '16px 20px 12px', borderBottom: '1px solid #1E1C16' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: contactColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 600, color: '#0A0A0A'
              }}>
                {contactInitials}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: '#E8E4DE' }}>{contactName}</div>
                <div style={{ fontSize: 11, color: '#6A6560' }}>
                  {messageCount > 0 ? `${messageCount} messages loaded` : 'Loading...'}{yearRange ? ` · ${yearRange}` : ''}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#4A4438', letterSpacing: '0.14em', textTransform: 'uppercase', marginRight: 4 }}>Jump to</span>
              {availableYears.slice(0, 8).map(year => (
                <button key={year} onClick={() => handleYearClick(year)}
                  style={{
                    padding: '3px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                    border: '1px solid', fontFamily: "'DM Sans'",
                    borderColor: selectedYear === year ? '#C8A96E' : '#2A2620',
                    background: selectedYear === year ? '#1A1610' : 'transparent',
                    color: selectedYear === year ? '#C8A96E' : '#5A5448'
                  }}>
                  {year}
                </button>
              ))}
            </div>
          </div>

          {selectedYear && (
            <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
              {MONTH_LABELS.map((mo, idx) => (
                <button key={mo} onClick={() => handleMonthClick(idx + 1)}
                  style={{
                    padding: '3px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                    border: '1px solid #2A2620', fontFamily: "'DM Sans'",
                    background: 'transparent', color: '#5A5448'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1A1610'; e.currentTarget.style.borderColor = '#C8A96E'; e.currentTarget.style.color = '#C8A96E' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#2A2620'; e.currentTarget.style.color = '#5A5448' }}>
                  {mo}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message area */}
      <div ref={scrollRef} onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#0A0907' }}>

        {loadingOlder && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ width: 20, height: 20, border: '2px solid #2A2723', borderTop: '2px solid #C8A96E', borderRadius: '50%', animation: 'cvSpin 0.7s linear infinite', margin: '0 auto' }} />
          </div>
        )}

        {initialLoad ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 24, height: 24, border: '2px solid #2A2723', borderTop: '2px solid #C8A96E', borderRadius: '50%', animation: 'cvSpin 0.7s linear infinite', margin: '0 auto 12px' }} />
              <div style={{ fontSize: 12, color: '#6A6560' }}>Loading conversation...</div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ fontSize: 13, color: '#4A4540' }}>No messages found</div>
          </div>
        ) : (
          renderItems.map((item, idx) => {
            if (item.type === 'date') {
              return (
                <div key={`date-${idx}`} style={{ textAlign: 'center', padding: item.isYearMarker ? '24px 0 16px' : '16px 0 8px' }}>
                  <span style={{
                    fontSize: item.isYearMarker ? 14 : 10,
                    letterSpacing: item.isYearMarker ? '0.06em' : '0.16em',
                    color: item.isYearMarker ? '#C8A96E' : '#4A4540',
                    fontWeight: item.isYearMarker ? 500 : 400,
                    fontFamily: "'DM Sans'"
                  }}>
                    {item.isYearMarker ? `${item.label} →` : item.label}
                  </span>
                </div>
              )
            }

            if (item.type === 'photo-burst') {
              return (
                <div key={`burst-${idx}`} style={{ textAlign: 'center', padding: '6px 0' }}>
                  <span style={{ fontSize: 10, color: '#4A4540', letterSpacing: '0.1em', fontFamily: "'DM Sans'" }}>
                    <Image style={{ width: 10, height: 10, display: 'inline', verticalAlign: 'middle', marginRight: 4, opacity: 0.5 }} />
                    PHOTO BURST
                  </span>
                </div>
              )
            }

            const group = item as MessageGroup
            const isMe = group.isFromMe
            const lastMsg = group.messages[group.messages.length - 1]
            const lastTime = parseDate(lastMsg.sentAt)

            const prevItem = idx > 0 ? renderItems[idx - 1] : null
            const afterDateSep = prevItem !== null && prevItem.type === 'date'
            const prevIsOtherSender = prevItem !== null && prevItem.type === 'messages' && (prevItem as MessageGroup).isFromMe !== isMe

            let groupMarginTop = 0
            if (afterDateSep) groupMarginTop = 6
            else if (prevIsOtherSender) groupMarginTop = 10
            else if (prevItem !== null && prevItem.type === 'messages') groupMarginTop = 4

            return (
              <div key={`group-${group.messages[0].rowId}`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginTop: groupMarginTop }}>
                {group.messages.map((msg, mi) => {
                  const isFirst = mi === 0
                  const isLast = mi === group.messages.length - 1
                  const count = group.messages.length

                  // Emoji-only detection
                  const emojiOnly = !msg.hasAttachment && msg.body && isEmojiOnly(msg.body)

                  if (emojiOnly) {
                    return (
                      <div key={msg.rowId} style={{ marginBottom: isLast ? 0 : 2, maxWidth: '75%' }}>
                        <div style={{ fontSize: 28, lineHeight: 1.3 }}>{msg.body}</div>
                      </div>
                    )
                  }

                  let topLeft: number, topRight: number, bottomLeft: number, bottomRight: number
                  if (isMe) {
                    if (count === 1) { topLeft = 14; topRight = 14; bottomLeft = 14; bottomRight = 4 }
                    else if (isFirst) { topLeft = 14; topRight = 14; bottomLeft = 14; bottomRight = 4 }
                    else if (isLast) { topLeft = 14; topRight = 4; bottomLeft = 14; bottomRight = 4 }
                    else { topLeft = 14; topRight = 4; bottomLeft = 14; bottomRight = 4 }
                  } else {
                    if (count === 1) { topLeft = 14; topRight = 14; bottomLeft = 4; bottomRight = 14 }
                    else if (isFirst) { topLeft = 14; topRight = 14; bottomLeft = 4; bottomRight = 14 }
                    else if (isLast) { topLeft = 4; topRight = 14; bottomLeft = 4; bottomRight = 14 }
                    else { topLeft = 4; topRight = 14; bottomLeft = 4; bottomRight = 14 }
                  }

                  const hasAttachmentOnly = msg.hasAttachment && !msg.body

                  return (
                    <div key={msg.rowId} style={{ marginBottom: isLast ? 0 : 2, maxWidth: '75%' }}>
                      {msg.hasAttachment && msg.attachmentId ? (
                        <div
                          onClick={() => onOpenAttachment?.(msg.attachmentId!)}
                          style={{
                            background: '#1A1814', border: '1px solid #2A2620', borderRadius: 12,
                            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
                            cursor: 'pointer', marginBottom: msg.body ? 4 : 0, minWidth: 140
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#1E1B15'; e.currentTarget.style.borderColor = '#3A3620' }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#1A1814'; e.currentTarget.style.borderColor = '#2A2620' }}>
                          <Image style={{ width: 16, height: 16, color: '#6A6560', opacity: 0.6 }} />
                          <span style={{ fontSize: 12, color: '#6A6560' }}>Photo</span>
                        </div>
                      ) : msg.hasAttachment ? (
                        <div style={{
                          background: '#1A1814', border: '1px solid #2A2620', borderRadius: 12,
                          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
                          marginBottom: msg.body ? 4 : 0, minWidth: 140
                        }}>
                          <Image style={{ width: 16, height: 16, color: '#6A6560', opacity: 0.6 }} />
                          <span style={{ fontSize: 12, color: '#6A6560' }}>Attachment</span>
                        </div>
                      ) : null}
                      {msg.body && (
                        <div style={{
                          background: isMe ? '#2A2218' : '#161310',
                          borderRadius: `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`,
                          padding: '8px 12px', maxWidth: '100%'
                        }}>
                          {renderMessageBody(msg.body, isMe ? '#E8E4DE' : '#D0CBC5')}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div style={{ fontSize: 10, color: '#3A3530', marginTop: 3 }}>
                  {formatTimestamp(lastTime)}
                </div>
              </div>
            )
          })
        )}

        {loadingNewer && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ width: 20, height: 20, border: '2px solid #2A2723', borderTop: '2px solid #C8A96E', borderRadius: '50%', animation: 'cvSpin 0.7s linear infinite', margin: '0 auto' }} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ flexShrink: 0, padding: '10px 20px', borderTop: '1px solid #1E1C16', textAlign: 'center' }}>
        <span style={{ fontSize: 11, color: '#2A2620', fontStyle: 'italic' }}>
          Read-only archive · open in Messages to reply
        </span>
      </div>

      <style>{`@keyframes cvSpin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
