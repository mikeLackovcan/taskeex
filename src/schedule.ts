export type Task = {
  id: string
  title: string
  /** Length in minutes. */
  duration: number
  /** Day it is scheduled on, as YYYY-MM-DD. Missing while it is still a loose bubble. */
  day?: string
  /** Start time in minutes after midnight. */
  start?: number
  done?: boolean
  /** A rolling task moves to today for as long as it is not done. */
  rolling?: boolean
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
  tasks.map((t) => {
    if (t.id !== id) return t
    const { day: _day, start: _start, ...loose } = t
    return loose
  })

/** Keep task `id` where it is and push the tasks after it down until nothing overlaps it. */
function pushLater(tasks: Task[], id: string) {
  const task = tasks.find((t) => t.id === id)
  if (!task?.day) return tasks
  const later = tasks
    .filter((t) => t.day === task.day && t.id !== id && t.start! >= task.start!)
    .sort((a, b) => a.start! - b.start!)
  let end = task.start! + task.duration
  for (const t of later) {
    if (t.start! < end) t.start = roundUp(end)
    end = Math.max(end, t.start! + t.duration)
  }
  return tasks
}

/** Change a task's length. On the calendar it keeps its start and pushes later tasks down if needed. */
export const resize = (tasks: Task[], id: string, duration: number) =>
  pushLater(
    tasks.map((t) => (t.id === id ? { ...t, duration } : { ...t })),
    id,
  )

/** Start a scheduled task at a chosen time. Tasks from that time on make room. */
export const setStart = (tasks: Task[], id: string, start: number) =>
  pushLater(
    tasks.map((t) => (t.id === id && t.day ? { ...t, start } : { ...t })),
    id,
  )

/** Bring rolling tasks that were left undone on a past day forward to today. */
export function rollOver(tasks: Task[], now = new Date()) {
  const today = dayKey(now)
  const late = tasks.filter((t) => t.rolling && !t.done && t.day && t.day < today)
  return late.reduce((ts, t) => schedule(ts, t.id, today, now), tasks)
}
