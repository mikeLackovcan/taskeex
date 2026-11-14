// Reading a new task typed in one line, such as "Gym tomorrow 6pm 1h", so it can go straight
// onto the calendar. Anything not recognised stays part of the name.
import { addDays, dayKey } from './schedule'

export type QuickAdd = {
  title: string
  duration?: number
  day?: string
  start?: number
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Minutes after midnight for "6pm", "6:30 pm", "18:00", "18.30"; null for anything else. */
function readTime(hour: string, minute: string | undefined, meridiem: string | undefined) {
  let h = Number(hour)
  const m = Number(minute ?? 0)
  if (h > 24 || m > 59) return null
  if (meridiem === 'pm' && h < 12) h += 12
  if (meridiem === 'am' && h === 12) h = 0
  return h * 60 + m
}

export function readQuickAdd(text: string, now = new Date()): QuickAdd {
  let rest = ` ${text.trim()} `
  const out: QuickAdd = { title: '' }
  const take = (re: RegExp, use: (m: RegExpExecArray) => boolean) => {
    const m = re.exec(rest)
    if (m && use(m)) rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)
  }

  // Length: "1h", "1.5 h", "90m", "30 min", "2 hours"
  take(/\s(?:for\s)?(\d+(?:[.,]\d+)?)\s?(h|hrs?|hours?|m|mins?|minutes?)(?=\s)/i, (m) => {
    const n = Number(m[1].replace(',', '.'))
    const minutes = /^h/i.test(m[2]) ? n * 60 : n
    if (minutes < 5 || minutes > 12 * 60) return false
    out.duration = Math.max(15, Math.round(minutes / 15) * 15)
    return true
  })

  // Time: "6pm", "at 6", "6:30 pm", "18:00", "at 18". A bare number such as "3 chapters" is not a time.
  take(/\s(?:at\s)?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)(?=\s)/i, (m) => {
    const t = readTime(m[1], m[2], m[3].toLowerCase())
    if (t === null) return false
    out.start = t
    return true
  })
  if (out.start === undefined) {
    take(/\s(?:at\s)?(\d{1,2})[:.](\d{2})(?=\s)/i, (m) => {
      const t = readTime(m[1], m[2], undefined)
      if (t === null) return false
      out.start = t
      return true
    })
  }
  if (out.start === undefined) {
    take(/\sat\s(\d{1,2})(?=\s)/i, (m) => {
      const h = Number(m[1])
      if (h > 23) return false
      // "at 6" with no am or pm: the next 6 o'clock that makes sense during waking hours.
      out.start = (h >= 1 && h <= 7 ? h + 12 : h) * 60
      return true
    })
  }

  // Day: "today", "tonight", "tomorrow", "monday", "on fri", "next friday"
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  take(/\s(today|tonight|tomorrow|tmrw)(?=\s)/i, (m) => {
    out.day = dayKey(/^to(day|night)$/i.test(m[1]) ? today : addDays(today, 1))
    if (/tonight/i.test(m[1]) && out.start === undefined) out.start = 19 * 60
    return true
  })
  if (!out.day) {
    // Full names anywhere; short ones ("fri") only after "on" or "next", so "sun cream" stays a name.
    take(/\s(?:(on|next)\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=\s)/i, (m) => {
      if (!m[1] && !m[2].toLowerCase().endsWith('day')) return false
      const want = WEEKDAYS.findIndex((d) => d.startsWith(m[2].toLowerCase().slice(0, 3)))
      if (want < 0) return false
      const ahead = (want - today.getDay() + 7) % 7 || 7
      out.day = dayKey(addDays(today, ahead))
      return true
    })
  }

  // A time with no day means the next time it comes round.
  if (out.start !== undefined && !out.day) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    out.day = dayKey(out.start > nowMinutes ? today : addDays(today, 1))
  }

  out.title = rest.replace(/\s+/g, ' ').trim().replace(/^[,.\-–\s]+|[,.\-–\s]+$/g, '')
  if (!out.title) return { title: text.trim() }
  return out
}
