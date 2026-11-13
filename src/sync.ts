// The rules for keeping tasks the same across devices and in Google Calendar.
// Nothing here talks to the network, so all of it can be tested.
import type { Repeat, Task } from './schedule'

export type Diff = { upserts: Task[]; removes: Task[] }

const sameValue = (a: unknown, b: unknown) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]))

const same = (a: Task, b: Task) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Task>
  for (const k of keys) if (!sameValue(a[k], b[k])) return false
  return true
}

export const sameTasks = (a: Task[], b: Task[]) => a.length === b.length && a.every((t, i) => same(t, b[i]))

/** What changed between two lists of tasks. */
export function diff(before: Task[], after: Task[]): Diff {
  const old = new Map(before.map((t) => [t.id, t]))
  const now = new Set(after.map((t) => t.id))
  return {
    upserts: after.filter((t) => !old.has(t.id) || !same(old.get(t.id)!, t)),
    removes: before.filter((t) => !now.has(t.id)),
  }
}

/** Replay changes made on this device on top of what the account holds. */
export function applyDiff(tasks: Task[], d: Diff) {
  const changed = new Map(d.upserts.map((t) => [t.id, t]))
  const gone = new Set(d.removes.map((t) => t.id))
  const kept = tasks.filter((t) => !gone.has(t.id)).map((t) => changed.get(t.id) ?? t)
  const known = new Set(tasks.map((t) => t.id))
  return sortTasks([...kept, ...d.upserts.filter((t) => !known.has(t.id))])
}

/** The first time a device signs in to an account, its own tasks are added to the account's. */
export function union(remote: Task[], local: Task[]) {
  const known = new Set(remote.map((t) => t.id))
  return sortTasks([...remote, ...local.filter((t) => !known.has(t.id))])
}

/** Oldest first, so every device lists tasks in the same order. */
export const sortTasks = (tasks: Task[]) =>
  [...tasks].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

// ---------- Google Calendar ----------

/**
 * A short record of everything a calendar event is made from. A task whose record differs
 * from the one saved with its event needs the event written again. A task off the calendar has none.
 */
export const calSig = (t: Task) =>
  t.day ? JSON.stringify([t.title, t.day, t.start ?? null, t.duration, !!t.done, t.repeat ?? null]) : undefined

/**
 * The id of a task's calendar event. It is worked out from the task's id, so two devices
 * writing the same task end up with one event, not two. Google allows only 0-9 and a-v.
 */
export const eventId = (taskId: string) =>
  'tx' +
  (/^[0-9a-f-]+$/.test(taskId)
    ? taskId.replace(/-/g, '')
    : [...taskId].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join(''))

const pad = (n: number) => String(n).padStart(2, '0')

/** `day` plus a number of minutes, as a local date and time. Rolls into the next day when needed. */
function localDateTime(day: string, minutes: number) {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d, 0, minutes)
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return { date: ymd, dateTime: `${ymd}T${pad(date.getHours())}:${pad(date.getMinutes())}:00` }
}

/** Google's repeat rule for each kind of repeat. Weekly repeats on the weekday of the first day. */
const RRULE: Record<Repeat, string> = {
  daily: 'RRULE:FREQ=DAILY',
  weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY',
}

/** Minutes before the start at which Google shows the reminder. */
export const REMINDER_MINUTES = 10

/** The calendar event for a task that is on a day. */
export function eventBody(t: Task, timeZone: string) {
  const summary = (t.done ? '✓ ' : '') + t.title
  const base = { summary, status: 'confirmed', description: 'Made with Taskeex', recurrence: t.repeat ? [RRULE[t.repeat]] : [] }
  if (t.start === undefined) {
    // No set time: an all-day event. Google has no "on the day" reminder for these.
    return {
      ...base,
      start: { date: t.day! },
      end: { date: localDateTime(t.day!, 24 * 60).date },
      reminders: { useDefault: false, overrides: [] },
    }
  }
  return {
    ...base,
    start: { dateTime: localDateTime(t.day!, t.start).dateTime, timeZone },
    end: { dateTime: localDateTime(t.day!, t.start + t.duration).dateTime, timeZone },
    reminders: { useDefault: false, overrides: t.done ? [] : [{ method: 'popup', minutes: REMINDER_MINUTES }] },
  }
}

/** What each calendar event was last made from: task id to the task's record at that time. */
export type Events = Record<string, string>

export type CalendarWork = {
  /** Tasks whose event must be created or rewritten. */
  write: Task[]
  /** Ids of tasks that were deleted or taken off the calendar but still have an event. */
  clear: string[]
}

/** Compare the tasks with the events that exist, and say what Google Calendar is missing. */
export function calendarWork(tasks: Task[], events: Events): CalendarWork {
  const onCalendar = new Set(tasks.filter((t) => t.day).map((t) => t.id))
  return {
    write: tasks.filter((t) => t.day && events[t.id] !== calSig(t)),
    clear: Object.keys(events).filter((id) => !onCalendar.has(id)),
  }
}

export const hasCalendarWork = (tasks: Task[], events: Events) => {
  const w = calendarWork(tasks, events)
  return w.write.length + w.clear.length > 0
}
