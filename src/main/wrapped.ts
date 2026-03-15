import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import { compileContactsHelper, resolveContact, resolveContactsBatch } from './contacts'

const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db')

// Apple epoch: date/1000000000 + 978307200 = unix timestamp
const APPLE_EPOCH = 978307200
const NS_TO_S = 1000000000

function appleToUnix(appleNs: number): number {
  return appleNs / NS_TO_S + APPLE_EPOCH
}

function yearToAppleRange(year: number): { start: number; end: number } {
  const startUnix = new Date(`${year}-01-01T00:00:00`).getTime() / 1000
  const endUnix = new Date(`${year + 1}-01-01T00:00:00`).getTime() / 1000
  return {
    start: (startUnix - APPLE_EPOCH) * NS_TO_S,
    end: (endUnix - APPLE_EPOCH) * NS_TO_S
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const HOUR_LABELS: Record<string, string> = {
  '0': 'late night', '1': 'late night', '2': 'late night', '3': 'late night',
  '4': 'early morning', '5': 'early morning',
  '6': 'morning', '7': 'morning', '8': 'morning', '9': 'morning', '10': 'morning', '11': 'morning',
  '12': 'afternoon', '13': 'afternoon', '14': 'afternoon', '15': 'afternoon', '16': 'afternoon',
  '17': 'evening', '18': 'evening', '19': 'evening', '20': 'evening',
  '21': 'night', '22': 'night', '23': 'night'
}

// Emoji regex (simplified — covers most common emoji)
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{2764}\u{FE0F}]/gu

export interface WrappedData {
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
    conversationBreakdown: {
      direct: number
      groups: { chatName: string; count: number }[]
    }
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

let resolveContactFn: ((handle: string) => string) | null = null

function getContactName(handle: string): string {
  if (!resolveContactFn) {
    try {
      compileContactsHelper()
      resolveContactFn = resolveContact
    } catch {
      resolveContactFn = (h: string) => h
    }
  }
  return resolveContactFn!(handle)
}

function computeStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const unique = [...new Set(dates)].sort()
  let maxStreak = 1
  let current = 1
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1])
    const curr = new Date(unique[i])
    const diff = (curr.getTime() - prev.getTime()) / 86400000
    if (diff === 1) {
      current++
      if (current > maxStreak) maxStreak = current
    } else {
      current = 1
    }
  }
  return maxStreak
}

function findMostUsedEmoji(texts: string[]): string | null {
  const counts = new Map<string, number>()
  for (const text of texts) {
    if (!text) continue
    const matches = text.match(EMOJI_RE)
    if (matches) {
      for (const emoji of matches) {
        counts.set(emoji, (counts.get(emoji) || 0) + 1)
      }
    }
  }
  if (counts.size === 0) return null
  let best = ''
  let bestCount = 0
  for (const [emoji, count] of counts) {
    if (count > bestCount) { best = emoji; bestCount = count }
  }
  return best || null
}

export function getAvailableYears(): number[] {
  if (!existsSync(CHAT_DB_PATH)) return []
  const db = new Database(CHAT_DB_PATH, { readonly: true })
  try {
    const rows = db.prepare(`
      SELECT DISTINCT CAST(strftime('%Y', datetime(date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as year
      FROM message
      WHERE date > 0
      ORDER BY year ASC
    `).all() as { year: number }[]
    db.close()
    return rows.map((r) => r.year).filter((y) => y >= 2008 && y <= 2030)
  } catch {
    db.close()
    return []
  }
}

export function generateWrapped(year: number): WrappedData {
  if (!existsSync(CHAT_DB_PATH)) throw new Error('Messages database not found')
  const db = new Database(CHAT_DB_PATH, { readonly: true })
  const { start, end } = yearToAppleRange(year)

  try {
    console.log(`[Wrapped] Generating for ${year}...`)

    // Pre-resolve all contact handles for this year in one batch
    try {
      compileContactsHelper()
      const allHandles = db.prepare(`
        SELECT DISTINCT h.id as handle FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.date >= ? AND m.date < ? AND h.id IS NOT NULL
      `).all(start, end) as { handle: string }[]
      resolveContactsBatch(allHandles.map((r: { handle: string }) => r.handle))
      console.log(`[Wrapped] Resolved ${allHandles.length} contacts`)
    } catch (err) {
      console.log('[Wrapped] Contact resolution failed:', err)
    }

    // ── Top-line stats ──
    const topLine = db.prepare(`
      SELECT
        SUM(CASE WHEN is_from_me = 1 THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN is_from_me = 0 THEN 1 ELSE 0 END) as received,
        COUNT(*) as total
      FROM message
      WHERE date >= ? AND date < ?
        AND (text IS NOT NULL OR cache_has_attachments = 1)
    `).get(start, end) as { sent: number; received: number; total: number }

    const totalAttachments = (db.prepare(`
      SELECT COUNT(DISTINCT a.ROWID) as c
      FROM attachment a
      JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
      JOIN message m ON maj.message_id = m.ROWID
      WHERE m.date >= ? AND m.date < ?
    `).get(start, end) as { c: number }).c

    const totalConversations = (db.prepare(`
      SELECT COUNT(DISTINCT c.ROWID) as c
      FROM message m
      JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      JOIN chat c ON cmj.chat_id = c.ROWID
      WHERE m.date >= ? AND m.date < ?
    `).get(start, end) as { c: number }).c

    const activeDays = (db.prepare(`
      SELECT COUNT(DISTINCT date(datetime(date/1000000000 + 978307200, 'unixepoch', 'localtime'))) as c
      FROM message
      WHERE date >= ? AND date < ?
        AND (text IS NOT NULL OR cache_has_attachments = 1)
    `).get(start, end) as { c: number }).c

    // ── Top relationships (person-level, across ALL conversations) ──
    // Count all messages where this handle appears — includes group chats
    const topHandlesRaw = db.prepare(`
      SELECT
        h.id as handle,
        SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received,
        COUNT(*) as total,
        MIN(datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) as first_date
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.date >= ? AND m.date < ?
        AND h.id IS NOT NULL
        AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
      GROUP BY h.id
      ORDER BY total DESC
      LIMIT 10
    `).all(start, end) as { handle: string; received: number; total: number; first_date: string }[]

    // Also count sent messages per handle (messages I sent in conversations where this handle participates)
    const sentByHandle = new Map<string, number>()
    for (const r of topHandlesRaw) {
      const sent = (db.prepare(`
        SELECT COUNT(*) as c
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        JOIN handle h ON chj.handle_id = h.ROWID
        WHERE m.date >= ? AND m.date < ?
          AND m.is_from_me = 1
          AND h.id = ?
          AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
      `).get(start, end, r.handle) as { c: number }).c
      sentByHandle.set(r.handle, sent)
    }

    const topRelationships = topHandlesRaw.slice(0, 5).map((r) => {
      const sent = sentByHandle.get(r.handle) || 0

      // Streak: all days with messages involving this person
      const dates = db.prepare(`
        SELECT DISTINCT date(datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) as d
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.date >= ? AND m.date < ? AND h.id = ?
        ORDER BY d
      `).all(start, end, r.handle) as { d: string }[]

      // Most active month
      const monthCounts = db.prepare(`
        SELECT
          CAST(strftime('%m', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as month,
          COUNT(*) as c
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.date >= ? AND m.date < ? AND h.id = ?
        GROUP BY month ORDER BY c DESC LIMIT 1
      `).get(start, end, r.handle) as { month: number; c: number } | undefined

      // Conversation breakdown: direct vs group chats
      const chatBreakdown = db.prepare(`
        SELECT
          COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) as chat_name,
          COUNT(*) as msg_count
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.date >= ? AND m.date < ?
          AND h.id = ?
        GROUP BY c.ROWID
        ORDER BY msg_count DESC
      `).all(start, end, r.handle) as { chat_name: string; msg_count: number }[]

      // Identify direct chat (chat_identifier matches handle) vs groups
      let direct = 0
      const groups: { chatName: string; count: number }[] = []
      for (const cb of chatBreakdown) {
        if (cb.chat_name === r.handle || cb.chat_name?.includes(r.handle)) {
          direct += cb.msg_count
        } else {
          groups.push({ chatName: cb.chat_name, count: cb.msg_count })
        }
      }

      return {
        handle: r.handle,
        displayName: getContactName(r.handle),
        messagesSent: sent,
        messagesReceived: r.received,
        totalMessages: r.total + sent,
        firstMessageDate: r.first_date,
        longestStreakDays: computeStreak(dates.map((d) => d.d)),
        mostActiveMonth: monthCounts ? MONTH_NAMES[monthCounts.month - 1] : 'Unknown',
        conversationBreakdown: { direct, groups }
      }
    })

    // ── Monthly activity ──
    const monthlyRaw = db.prepare(`
      SELECT
        CAST(strftime('%m', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as month,
        SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received
      FROM message m
      WHERE m.date >= ? AND m.date < ?
        AND (m.text IS NOT NULL OR m.cache_has_attachments = 1)
      GROUP BY month
      ORDER BY month
    `).all(start, end) as { month: number; sent: number; received: number }[]

    const monthlyAttachments = db.prepare(`
      SELECT
        CAST(strftime('%m', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as month,
        COUNT(DISTINCT a.ROWID) as c
      FROM attachment a
      JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
      JOIN message m ON maj.message_id = m.ROWID
      WHERE m.date >= ? AND m.date < ?
      GROUP BY month
    `).all(start, end) as { month: number; c: number }[]

    const attByMonth = new Map(monthlyAttachments.map((r) => [r.month, r.c]))
    const monthMap = new Map(monthlyRaw.map((r) => [r.month, r]))

    const monthlyActivity = MONTH_NAMES.map((name, i) => {
      const m = monthMap.get(i + 1)
      return {
        month: name,
        messagesSent: m?.sent || 0,
        messagesReceived: m?.received || 0,
        attachments: attByMonth.get(i + 1) || 0
      }
    })

    // ── Moment clusters ──
    const avgAttachments = totalAttachments / 12
    const momentClusters = monthlyActivity
      .filter((m) => m.attachments > avgAttachments * 2 && m.attachments > 5)
      .map((m) => {
        const monthNum = MONTH_NAMES.indexOf(m.month) + 1
        const topContact = db.prepare(`
          SELECT h.id as handle, COUNT(*) as c
          FROM attachment a
          JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
          JOIN message m ON maj.message_id = m.ROWID
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE m.date >= ? AND m.date < ?
            AND CAST(strftime('%m', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) = ?
            AND h.id IS NOT NULL
          GROUP BY h.id ORDER BY c DESC LIMIT 1
        `).get(start, end, monthNum) as { handle: string; c: number } | undefined

        return {
          month: m.month,
          year,
          attachmentCount: m.attachments,
          topContact: topContact ? getContactName(topContact.handle) : 'Unknown',
          label: `Big month for photos`
        }
      })

    // ── Personality ──
    const hourCounts = db.prepare(`
      SELECT
        CAST(strftime('%H', datetime(date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as hour,
        COUNT(*) as c
      FROM message
      WHERE date >= ? AND date < ? AND is_from_me = 1
      GROUP BY hour ORDER BY c DESC
    `).all(start, end) as { hour: number; c: number }[]

    const peakHour = hourCounts.length > 0 ? hourCounts[0].hour : 12

    // Average response time — sample recent messages, compute in JS to avoid slow self-join
    let avgResponseTimeMinutes = 0
    try {
      const recentMessages = db.prepare(`
        SELECT date, is_from_me
        FROM message
        WHERE date >= ? AND date < ?
          AND (text IS NOT NULL OR cache_has_attachments = 1)
        ORDER BY date ASC
        LIMIT 2000
      `).all(start, end) as { date: number; is_from_me: number }[]

      const responseTimes: number[] = []
      for (let i = 1; i < recentMessages.length; i++) {
        if (recentMessages[i - 1].is_from_me === 0 && recentMessages[i].is_from_me === 1) {
          const diffMin = (recentMessages[i].date - recentMessages[i - 1].date) / NS_TO_S / 60
          if (diffMin > 0 && diffMin < 1440) responseTimes.push(diffMin) // within 24h
        }
      }
      if (responseTimes.length > 0) {
        avgResponseTimeMinutes = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      }
    } catch { /* ignore */ }

    // Longest conversation day
    const busiestDay = db.prepare(`
      SELECT date(datetime(date/1000000000 + 978307200, 'unixepoch', 'localtime')) as d, COUNT(*) as c
      FROM message
      WHERE date >= ? AND date < ?
        AND (text IS NOT NULL OR cache_has_attachments = 1)
      GROUP BY d ORDER BY c DESC LIMIT 1
    `).get(start, end) as { d: string; c: number } | undefined

    // Most used emoji
    const sentTexts = db.prepare(`
      SELECT text FROM message
      WHERE date >= ? AND date < ? AND is_from_me = 1 AND text IS NOT NULL
      LIMIT 5000
    `).all(start, end) as { text: string }[]

    const mostUsedEmoji = findMostUsedEmoji(sentTexts.map((r) => r.text))

    const personality = {
      peakHour,
      peakHourLabel: HOUR_LABELS[String(peakHour)] || 'afternoon',
      avgResponseTimeMinutes,
      longestConversationDay: busiestDay?.d || '',
      mostUsedEmoji
    }

    // ── Relationship arcs ──
    const { start: prevStart, end: prevEnd } = yearToAppleRange(year - 1)
    const prevYearHandles = db.prepare(`
      SELECT h.id as handle, COUNT(*) as total
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.date >= ? AND m.date < ? AND h.id IS NOT NULL
      GROUP BY h.id
    `).all(prevStart, prevEnd) as { handle: string; total: number }[]

    const prevMap = new Map(prevYearHandles.map((r) => [r.handle, r.total]))

    const thisYearHandles = db.prepare(`
      SELECT h.id as handle, COUNT(*) as total
      FROM message m
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE m.date >= ? AND m.date < ? AND h.id IS NOT NULL
      GROUP BY h.id
      ORDER BY total DESC
      LIMIT 20
    `).all(start, end) as { handle: string; total: number }[]

    const relationshipArcs = thisYearHandles.map((r) => {
      const lastYear = prevMap.get(r.handle) || 0
      const changePercent = lastYear > 0 ? Math.round(((r.total - lastYear) / lastYear) * 100) : 100

      let arc: 'new' | 'growing' | 'fading' | 'rekindled' | 'steady'
      if (lastYear === 0) arc = 'new'
      else if (changePercent > 50) arc = 'growing'
      else if (changePercent < -50) arc = 'fading'
      else if (lastYear < 10 && r.total > 50) arc = 'rekindled'
      else arc = 'steady'

      return {
        handle: r.handle,
        displayName: getContactName(r.handle),
        thisYearMessages: r.total,
        lastYearMessages: lastYear,
        changePercent,
        arc
      }
    })

    // Also add fading contacts (high last year, low this year)
    for (const [handle, lastTotal] of prevMap) {
      if (lastTotal > 50 && !thisYearHandles.find((r) => r.handle === handle)) {
        const thisYear = (db.prepare(`
          SELECT COUNT(*) as c FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID
          WHERE m.date >= ? AND m.date < ? AND h.id = ?
        `).get(start, end, handle) as { c: number }).c

        if (thisYear < lastTotal * 0.3) {
          relationshipArcs.push({
            handle,
            displayName: getContactName(handle),
            thisYearMessages: thisYear,
            lastYearMessages: lastTotal,
            changePercent: Math.round(((thisYear - lastTotal) / lastTotal) * 100),
            arc: 'fading'
          })
        }
      }
    }

    // Sort arcs by absolute change
    relationshipArcs.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))

    // ── Narrative ──
    const topContact = topRelationships[0]
    const topContactPercent = topContact ? Math.round((topContact.totalMessages / (topLine.total || 1)) * 100) : 0

    const mostActiveMonth = monthlyActivity.reduce((best, m) =>
      (m.messagesSent + m.messagesReceived) > (best.messagesSent + best.messagesReceived) ? m : best
    , monthlyActivity[0])

    const mostActiveMonthTotal = mostActiveMonth.messagesSent + mostActiveMonth.messagesReceived

    const headline = topContact && topContactPercent > 40
      ? `${year} was the year of ${topContact.displayName}`
      : `${year}: you stayed connected across ${totalConversations} relationships`

    const topRelationshipLine = topContact
      ? `${topContact.displayName} was your most frequent conversation — ${topContact.totalMessages.toLocaleString()} messages over ${new Set(monthlyActivity.filter((m) => m.messagesSent + m.messagesReceived > 0).map((m) => m.month)).size} months`
      : 'No conversations found'

    const mostActivePeriodLine = `${mostActiveMonth.month} was your most active month — ${mostActiveMonthTotal.toLocaleString()} messages in 30 days`

    const personalityLine = `You're a ${personality.peakHourLabel} texter` +
      (personality.avgResponseTimeMinutes > 0 ? ` with an average reply time of ${personality.avgResponseTimeMinutes} minutes` : '')

    const topMoment = momentClusters[0]
    const momentLine = topMoment
      ? `Something big happened in ${topMoment.month} — you shared ${topMoment.attachmentCount} photos that month alone`
      : null

    console.log(`[Wrapped] Done for ${year}: ${topLine.total} messages, ${totalConversations} conversations`)
    db.close()

    return {
      year,
      totalMessagesSent: topLine.sent || 0,
      totalMessagesReceived: topLine.received || 0,
      totalAttachments,
      totalConversations,
      activeDays,
      topRelationships,
      monthlyActivity,
      momentClusters,
      personality,
      relationshipArcs: relationshipArcs.slice(0, 15),
      narrative: {
        headline,
        topRelationshipLine,
        mostActivePeriodLine,
        personalityLine,
        momentLine
      }
    }
  } catch (err) {
    db.close()
    throw err
  }
}
