import type { Attachment } from '../types'

export interface Cluster {
  id: string
  title: string
  attachments: Attachment[]
  totalReactions: number
  participants: string[]
  peakHour: string
}

const GAP_HOURS = 3

export function clusterAttachments(attachments: Attachment[]): Cluster[] {
  if (!attachments.length) return []

  const sorted = [...attachments].sort((a, b) =>
    new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  )

  const groups: Attachment[][] = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const gap = (new Date(sorted[i].created_at || 0).getTime() - new Date(sorted[i - 1].created_at || 0).getTime()) / 3600000
    if (gap <= GAP_HOURS) groups[groups.length - 1].push(sorted[i])
    else groups.push([sorted[i]])
  }

  return groups.reverse().map((atts, i) => {
    const dates = atts.map((a) => new Date(a.created_at || 0))
    const first = dates.reduce((a, b) => (a < b ? a : b))
    const last = dates.reduce((a, b) => (a > b ? a : b))
    const sameDay = first.toDateString() === last.toDateString()
    const fmt = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const title = sameDay
      ? first.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      : `${fmt(first)} – ${fmt(last)}`

    const hourCounts: Record<number, number> = {}
    dates.forEach((d) => { const h = d.getHours(); hourCounts[h] = (hourCounts[h] || 0) + 1 })
    const peakH = parseInt(Object.entries(hourCounts).sort((a, b) => +b[1] - +a[1])[0]?.[0] || '12')
    const peakHour = `${peakH % 12 || 12}:00 ${peakH >= 12 ? 'PM' : 'AM'}`

    return {
      id: `cluster-${i}-${first.getTime()}`,
      title,
      attachments: atts,
      totalReactions: atts.reduce((s, a) => s + (a.reaction_count || 0), 0),
      participants: [...new Set(atts.map((a) => a.sender_handle).filter(Boolean))] as string[],
      peakHour
    }
  })
}
