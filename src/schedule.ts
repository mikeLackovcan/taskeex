export type Task = {
  id: string
  title: string
  /** Length in minutes. */
  duration: number
  /** Day it is scheduled on, as YYYY-MM-DD. Missing while it is still a loose bubble. */
  day?: string
  /** Start time in minutes after midnight. */
  start?: number
}

/** Start of the usual hours, in minutes after midnight. */
export const DAY_START = 9 * 60
const STEP = 15

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const addDays = (d: Date, n: number) => {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

/** Monday of the week that holds `d`. */
export const weekStart = (d: Date) => {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return addDays(c, -((c.getDay() + 6) % 7))
}

export const formatTime = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

export const formatDuration = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : `${minutes / 60} h`

const roundUp = (minutes: number) => Math.ceil(minutes / STEP) * STEP

/** First gap of at least `duration` minutes at or after `earliest` among `busy`. */
export function nextFreeSlot(busy: Task[], duration: number, earliest = DAY_START) {
  let start = roundUp(earliest)
  const sorted = busy
    .filter((t) => t.start !== undefined)
    .sort((a, b) => a.start! - b.start!)
  for (const t of sorted) {
    if (start + duration <= t.start!) break
    start = Math.max(start, roundUp(t.start! + t.duration))
  }
  return start
}

/** Put a task on a day at the next free slot. On today, never before now. */
export function schedule(tasks: Task[], id: string, day: string, now = new Date()) {
  const task = tasks.find((t) => t.id === id)
  if (!task) return tasks
  const others = tasks.filter((t) => t.day === day && t.id !== id)
  let earliest = DAY_START
  if (day === dayKey(now)) {
    earliest = Math.max(earliest, now.getHours() * 60 + now.getMinutes())
  }
  const start = nextFreeSlot(others, task.duration, earliest)
  return tasks.map((t) => (t.id === id ? { ...t, day, start } : t))
}

export const unschedule = (tasks: Task[], id: string) =>
  tasks.map((t) => (t.id === id ? { id: t.id, title: t.title, duration: t.duration } : t))

/** Change a task's length. On the calendar it keeps its start and pushes later tasks down if needed. */
export function resize(tasks: Task[], id: string, duration: number) {
  const next = tasks.map((t) => (t.id === id ? { ...t, duration } : t))
  const task = next.find((t) => t.id === id)
  if (!task?.day) return next
  const day = next.filter((t) => t.day === task.day).sort((a, b) => a.start! - b.start!)
  let end = 0
  for (const t of day) {
    if (t.start! < end && t.id !== id) t.start = roundUp(end)
    end = Math.max(end, t.start! + t.duration)
  }
  return next
}
