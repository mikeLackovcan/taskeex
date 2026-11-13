export type Task = {
  id: string
  title: string
  /** Length in minutes. */
  duration: number
  /** Day it is scheduled on, as YYYY-MM-DD. Missing while it is still a loose bubble. */
  day?: string
  /** Start time in minutes after midnight. Missing on a day task that has no set time. */
  start?: number
  done?: boolean
  /** A rolling task moves to today for as long as it is not done. */
  rolling?: boolean
  /** When it was created, in ms. Keeps the bubbles in the same order on every device. */
  at?: number
  /** A repeating task shows on every matching day from `day` on. */
  repeat?: Repeat
  /** Days on which a repeating task was done. */
  doneOn?: string[]
}

export type Repeat = 'daily' | 'weekdays' | 'weekly'
export const REPEATS: Repeat[] = ['daily', 'weekdays', 'weekly']

const DAY_MS = 86_400_000
const toDate = (day: string) => new Date(`${day}T00:00`)
/** Whole days from `a` to `b`. */
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS)
export const shiftDay = (day: string, n: number) => dayKey(addDays(toDate(day), n))
const isWeekday = (day: string) => toDate(day).getDay() % 6 !== 0

/** Whether a task is on `day`: its own day, or a later day its repeat matches. */
export function occursOn(t: Task, day: string) {
  if (!t.day) return false
  if (t.day === day) return t.repeat !== 'weekdays' || isWeekday(day)
  if (!t.repeat || day < t.day) return false
  if (t.repeat === 'daily') return true
  if (t.repeat === 'weekdays') return isWeekday(day)
  return daysBetween(t.day, day) % 7 === 0
}

/** The tasks on a day, with a repeating task shown as that day's copy, done or not on that day. */
export const onDay = (tasks: Task[], day: string) =>
  tasks
    .filter((t) => occursOn(t, day))
    .map((t) => (t.repeat ? { ...t, day, done: !!t.doneOn?.includes(day) } : t))

/** Make a task repeat, or stop it repeating. A weekday repeat starts on a weekday. */
export function setRepeat(tasks: Task[], id: string, repeat: Repeat | undefined): Task[] {
  return tasks.map((t) => {
    if (t.id !== id) return t
    const { repeat: _r, doneOn: _d, rolling: _ro, done: _do, ...rest } = t
    if (!repeat) return rest
    let day = t.day
    while (repeat === 'weekdays' && day && !isWeekday(day)) day = shiftDay(day, 1)
    return { ...rest, day, repeat }
  })
}

/** Mark one day of a repeating task done or not done. */
export const toggleDoneOn = (tasks: Task[], id: string, day: string): Task[] =>
  tasks.map((t) => {
    if (t.id !== id) return t
    const doneOn = t.doneOn ?? []
    const next = doneOn.includes(day) ? doneOn.filter((d) => d !== day) : [...doneOn, day].sort()
    const { doneOn: _d, ...rest } = t
    return next.length ? { ...rest, doneOn: next } : rest
  })

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
  const others = tasks.filter((t) => occursOn(t, day) && t.id !== id)
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

/**
 * Keep task `id` where it is and push the one-off tasks after it down until nothing overlaps it.
 * Repeating tasks hold their time, so the pushed tasks go past them.
 */
function pushLater(tasks: Task[], id: string) {
  const task = tasks.find((t) => t.id === id)
  if (!task?.day || task.start === undefined) return tasks
  const day = task.day
  const later = tasks.filter((t) => t.id !== id && t.start !== undefined && occursOn(t, day) && t.start >= task.start!)
  const fixed = later.filter((t) => t.repeat)
  let end = task.start! + task.duration
  for (const t of later.filter((t) => !t.repeat).sort((a, b) => a.start! - b.start!)) {
    if (t.start! < end) t.start = roundUp(end)
    for (const f of fixed.sort((a, b) => a.start! - b.start!)) {
      if (t.start! < f.start! + f.duration && f.start! < t.start! + t.duration) t.start = roundUp(f.start! + f.duration)
    }
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

const DAY_END = 24 * 60

/**
 * The start a task gets when it is put at `wanted` on a day: snapped to a quarter hour,
 * kept inside the day, and moved past any task that is already running at that time.
 */
export function freeStartAt(tasks: Task[], id: string, day: string, wanted: number) {
  const task = tasks.find((t) => t.id === id)
  const duration = task?.duration ?? 0
  let start = Math.min(Math.max(Math.round(wanted / STEP) * STEP, 0), DAY_END - duration)
  const others = tasks
    .filter((t) => occursOn(t, day) && t.id !== id && t.start !== undefined)
    .sort((a, b) => a.start! - b.start!)
  for (const o of others) {
    if (o.start! < start && start < o.start! + o.duration) start = roundUp(o.start! + o.duration)
  }
  return start
}

/** Put a task on a day at a chosen time. Tasks from that time on make room. */
export function placeAt(tasks: Task[], id: string, day: string, wanted: number) {
  const start = freeStartAt(tasks, id, day, wanted)
  return pushLater(
    tasks.map((t) => (t.id === id ? { ...t, day, start } : { ...t })),
    id,
  )
}

/** Start a scheduled task at a chosen time on its own day. */
export function setStart(tasks: Task[], id: string, start: number) {
  const day = tasks.find((t) => t.id === id)?.day
  return day ? placeAt(tasks, id, day, start) : tasks
}

/** Bring rolling tasks that were left undone on a past day forward to today. */
export function rollOver(tasks: Task[], now = new Date()) {
  const today = dayKey(now)
  const late = tasks.filter((t) => t.rolling && !t.repeat && !t.done && t.day && t.day < today)
  return late.reduce((ts, t) => (t.start === undefined ? setDay(ts, t.id, today) : schedule(ts, t.id, today, now)), tasks)
}

/** Put a task on a day with no set time. */
export const setDay = (tasks: Task[], id: string, day: string) =>
  tasks.map((t) => {
    if (t.id !== id) return t
    const { start: _start, ...rest } = t
    return { ...rest, day }
  })

/** Move a task to another day. A task with a time keeps it; a task without one stays without. */
export function moveToDay(tasks: Task[], id: string, day: string) {
  const task = tasks.find((t) => t.id === id)
  if (!task) return tasks
  return task.start === undefined ? setDay(tasks, id, day) : placeAt(tasks, id, day, task.start)
}

/**
 * Move one day's copy of a task from `from` to `to`, using `place` to put it on `to`.
 * A repeating task moves as a whole: every copy shifts by the same number of days and
 * takes the new time. A weekday task dropped on a weekend keeps its days and takes only the time.
 */
export function moveCopy(tasks: Task[], id: string, from: string, to: string, place: (ts: Task[], day: string) => Task[]) {
  const task = tasks.find((t) => t.id === id)
  if (!task?.repeat || !task.day) return place(tasks, to)
  if (task.repeat === 'weekdays' && !isWeekday(to)) to = from
  const anchor = shiftDay(task.day, daysBetween(from, to))
  // Put the copy on `to` first, so the time is checked against that day's tasks.
  const placed = place(
    tasks.map((t) => (t.id === id ? { ...t, day: to } : t)),
    to,
  )
  return placed.map((t) => (t.id === id && t.day ? { ...t, day: anchor } : t))
}
