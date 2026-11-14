// Spreading several tasks across the calendar by a simple rule, such as
// "every other day from 6 to 8 pm, one a day". The rule is read from a sentence
// (here, or by Gemini when the sentence is unusual); placing the tasks is plain code.
import { addDays, dayKey, formatTime, nextFreeSlot, onDay, type Task } from './schedule'

export type SpreadRule = {
  /** First day a task may go on, as YYYY-MM-DD. */
  from: string
  /** Last day a task may go on. Without it, tasks keep going until all are placed. */
  until?: string
  /** 1 for every day, 2 for every other day, and so on. */
  everyDays: number
  /** Weekdays allowed, 0 = Sunday. Empty allows every day. */
  weekdays: number[]
  /** Most tasks to put on one day. */
  perDay: number
  /** Time window each day, in minutes after midnight. */
  windowStart: number
  windowEnd: number
}

/** How far ahead to look before leaving the remaining tasks as bubbles. */
const HORIZON_DAYS = 90
const toDate = (day: string) => new Date(`${day}T00:00`)

export type Placement = { id: string; day: string; start: number }

/**
 * Where each task would go. Tasks go in the order given, each at the first free time in
 * the window on the next allowed day. Tasks that do not fit stay unplaced.
 */
export function planSpread(tasks: Task[], ids: string[], rule: SpreadRule, now = new Date()): Placement[] {
  const placed: Placement[] = []
  const queue = ids.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t)
  let working = tasks
  const today = dayKey(now)
  let day = toDate(rule.from < today ? today : rule.from)
  let step = 0
  for (let i = 0; i < HORIZON_DAYS && queue.length; i++, day = addDays(day, 1)) {
    const key = dayKey(day)
    if (rule.until && key > rule.until) break
    if (rule.weekdays.length && !rule.weekdays.includes(day.getDay())) continue
    // "Every other day" counts the allowed days from the first one.
    if (step++ % Math.max(1, rule.everyDays) !== 0) continue
    let earliest = rule.windowStart
    if (key === today) earliest = Math.max(earliest, now.getHours() * 60 + now.getMinutes())
    for (let n = 0; n < rule.perDay && queue.length; ) {
      const task = queue[0]
      const start = nextFreeSlot(onDay(working, key), task.duration, earliest)
      if (start + task.duration > rule.windowEnd) break
      queue.shift()
      placed.push({ id: task.id, day: key, start })
      working = working.map((t) => (t.id === task.id ? { ...t, day: key, start } : t))
      n++
    }
  }
  return placed
}

export const applyPlan = (tasks: Task[], plan: Placement[]) => {
  const at = new Map(plan.map((p) => [p.id, p]))
  return tasks.map((t) => {
    const p = at.get(t.id)
    return p ? { ...t, day: p.day, start: p.start } : t
  })
}

// ---------- Reading a sentence ----------

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, a: 1, an: 1, single: 1 }
const num = (w: string) => NUMBER_WORDS[w] ?? Number(w)

/** A clock time such as "6", "6pm", "18:30", "6.30 am". `pm` applies when the time has no am/pm of its own. */
function clock(text: string, pm?: boolean) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(text.trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const meridiem = m[3] ?? (pm ? 'pm' : undefined)
  if (meridiem === 'pm' && h < 12) h += 12
  if (meridiem === 'am' && h === 12) h = 0
  // "between 6 and 8" with no am or pm almost always means the evening.
  if (!meridiem && h >= 1 && h <= 7) h += 12
  return h > 24 || min > 59 ? null : h * 60 + min
}

const TIME = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?`

/** The next date that falls on `weekday`, counting today when `orToday` is set. */
function nextWeekday(now: Date, weekday: number, orToday = true) {
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!orToday || d.getDay() !== weekday) d = addDays(d, ((weekday - d.getDay() + 7) % 7) || 7)
  return d
}

export type Reading = { rule: SpreadRule; understood: boolean }

/**
 * Read the common ways of saying how to spread tasks. `understood` is false when nothing in
 * the sentence was recognised, which is when Gemini is asked instead.
 */
export function readRule(sentence: string, now = new Date()): Reading {
  const s = ` ${sentence.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ')} `
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const rule: SpreadRule = {
    from: dayKey(today),
    everyDays: 1,
    weekdays: [],
    perDay: 1,
    windowStart: 9 * 60,
    windowEnd: 21 * 60,
  }
  let hits = 0
  let perDaySet = false
  const hit = <T,>(v: T) => {
    hits++
    return v
  }

  // How often
  let m: RegExpExecArray | null
  if (/ every (other|second) day| every 2(nd)? days?/.test(s)) rule.everyDays = hit(2)
  else if ((m = / every (\d+|two|three|four|five) days/.exec(s))) rule.everyDays = hit(num(m[1]))
  else if (/ (every|each) day| daily /.test(s)) rule.everyDays = hit(1)

  // Which days
  if (/ (on )?weekdays| work ?days| workdays/.test(s)) rule.weekdays = hit([1, 2, 3, 4, 5])
  else if (/ weekends?/.test(s)) rule.weekdays = hit([0, 6])
  else {
    const named = DAY_NAMES.map((d, i) => (new RegExp(` ${d}[a-z]*s? `).test(s) || new RegExp(` ${d}[a-z]*s?[,.]`).test(s) ? i : -1)).filter((i) => i >= 0)
    const starting = /(from|starting|start on|beginning) (sun|mon|tue|wed|thu|fri|sat)/.exec(s)
    if (starting) {
      rule.from = dayKey(nextWeekday(now, DAY_NAMES.indexOf(starting[2])))
      hits++
      const rest = named.filter((i) => i !== DAY_NAMES.indexOf(starting[2]))
      if (rest.length) rule.weekdays = hit(named)
    } else if (named.length) rule.weekdays = hit(named)
  }

  // How many a day
  if ((m = / (one|two|three|four|five|\d+|a|an|single) (task )?(per|a|each) day/.exec(s)) || (m = / (one|two|three|\d+) (tasks? )?daily/.exec(s))) {
    rule.perDay = hit(num(m[1]))
    perDaySet = true
  } else if (/ each (task|one) (on )?(its own|a different|another) day| one task each day| next day (an)?other task/.test(s)) {
    rule.perDay = hit(1)
    perDaySet = true
  } else if (/ all (on )?(one|the same) day| together/.test(s)) {
    rule.perDay = hit(99)
    perDaySet = true
  }

  // When in the day
  if ((m = new RegExp(String.raw` (?:from |between )?(${TIME}) ?(?:-|to|until|till|and) ?(${TIME})(?=[\s,.;])`).exec(s))) {
    const pm = /pm\s*$/.test(m[2]) && !/am|pm/.test(m[1])
    const am = /am\s*$/.test(m[2]) && !/am|pm/.test(m[1])
    const a = clock(m[1], pm || undefined)
    const b = clock(m[2])
    const start = am ? clock(m[1].trim() + 'am') : a
    if (start !== null && b !== null && b > start) {
      rule.windowStart = start
      rule.windowEnd = b
      hits++
    }
  } else if ((m = new RegExp(String.raw` after (${TIME})(?=[\s,.;])`).exec(s)) && clock(m[1]) !== null) {
    rule.windowStart = hit(clock(m[1])!)
    rule.windowEnd = 24 * 60
  } else if ((m = new RegExp(String.raw` before (${TIME}|noon)(?=[\s,.;])`).exec(s))) {
    rule.windowStart = 7 * 60
    rule.windowEnd = hit(m[1] === 'noon' ? 12 * 60 : (clock(m[1]) ?? 12 * 60))
  } else if (/ mornings?/.test(s)) [rule.windowStart, rule.windowEnd] = hit([8 * 60, 12 * 60])
  else if (/ afternoons?/.test(s)) [rule.windowStart, rule.windowEnd] = hit([12 * 60, 17 * 60])
  else if (/ evenings?| tonight| after work/.test(s)) [rule.windowStart, rule.windowEnd] = hit([17 * 60, 21 * 60])
  else if (/ lunch/.test(s)) [rule.windowStart, rule.windowEnd] = hit([12 * 60, 14 * 60])

  // Starting when, and by when
  if (/ today| tonight| this (morning|afternoon|evening)/.test(s)) {
    rule.from = hit(dayKey(today))
    if (!/ (from|starting) today/.test(s)) rule.until = rule.from
    if (!perDaySet) rule.perDay = 99
  } else if (/ tomorrow/.test(s)) {
    rule.from = hit(dayKey(addDays(today, 1)))
    if (!/ (from|starting) tomorrow/.test(s) && !/ every | each day| daily /.test(s)) {
      rule.until = rule.from
      if (!perDaySet) rule.perDay = 99
    }
  } else if (/ next week/.test(s)) {
    const monday = nextWeekday(now, 1, false)
    rule.from = hit(dayKey(monday))
    if (!/ from next week| starting next week/.test(s)) rule.until = dayKey(addDays(monday, 6))
  }
  if (/ this week/.test(s)) rule.until = hit(dayKey(nextWeekday(now, 0)))
  else if ((m = / (?:by|until|till|before) (sun|mon|tue|wed|thu|fri|sat)[a-z]* /.exec(s))) {
    rule.until = hit(dayKey(nextWeekday(now, DAY_NAMES.indexOf(m[1]))))
  }

  return { rule, understood: hits > 0 }
}

// ---------- Saying a rule back ----------

const WEEKDAY_SHORT = (i: number) => new Date(2026, 10, 15 + i).toLocaleDateString(undefined, { weekday: 'short' })

/** The rule in a few words, so the person can see it was understood. */
export function describeRule(rule: SpreadRule, now = new Date()) {
  const parts: string[] = []
  if (rule.everyDays === 2) parts.push('Every other day')
  else if (rule.everyDays > 2) parts.push(`Every ${rule.everyDays} days`)
  const wd = [...rule.weekdays].sort().join()
  if (wd === '1,2,3,4,5') parts.push('weekdays')
  else if (wd === '0,6') parts.push('weekends')
  else if (rule.weekdays.length) parts.push(rule.weekdays.map(WEEKDAY_SHORT).join(', '))
  parts.push(`${formatTime(rule.windowStart)}–${formatTime(rule.windowEnd % (24 * 60) || 24 * 60)}`)
  if (rule.perDay === 1) parts.push('one a day')
  else if (rule.perDay < 20) parts.push(`up to ${rule.perDay} a day`)
  const today = dayKey(now)
  const tomorrow = dayKey(addDays(now, 1))
  const name = (d: string) =>
    d === today ? 'today' : d === tomorrow ? 'tomorrow' : toDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (rule.until === rule.from) parts.push(name(rule.from))
  else {
    if (rule.from !== today) parts.push(`from ${name(rule.from)}`)
    if (rule.until) parts.push(`until ${name(rule.until)}`)
  }
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Check a rule that came back from Gemini, and fill in anything it left out. */
export function cleanRule(raw: Partial<SpreadRule>, now = new Date()): SpreadRule | null {
  const base = readRule('', now).rule
  const isDay = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  const minutes = (v: unknown, fallback: number) =>
    typeof v === 'number' && v >= 0 && v <= 24 * 60 ? Math.round(v) : fallback
  const rule: SpreadRule = {
    from: isDay(raw.from) ? raw.from! : base.from,
    until: isDay(raw.until) ? raw.until : undefined,
    everyDays: typeof raw.everyDays === 'number' && raw.everyDays >= 1 && raw.everyDays <= 14 ? Math.round(raw.everyDays) : 1,
    weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
    perDay: typeof raw.perDay === 'number' && raw.perDay >= 1 ? Math.min(99, Math.round(raw.perDay)) : 1,
    windowStart: minutes(raw.windowStart, base.windowStart),
    windowEnd: minutes(raw.windowEnd, base.windowEnd),
  }
  if (rule.windowEnd <= rule.windowStart) return null
  if (rule.until && rule.until < rule.from) rule.until = undefined
  return rule
}
