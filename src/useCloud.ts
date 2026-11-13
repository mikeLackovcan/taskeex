import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarMissing, TokenExpired, createCalendar, removeCalendar, removeEvent, writeEvent } from './calendar'
import { cloudConfigured } from './firebase-config'
import type { Task } from './schedule'
import { applyDiff, calSig, calendarWork, diff, hasCalendarWork, sameTasks, union, type Events } from './sync'

type Api = typeof import('./cloud')
type Account = import('./cloud').Account

/** The account's tasks as this device last heard them, kept so that changes made before the
 * server answers (or with no connection) are told apart from changes made on other devices. */
const SYNCED_KEY = 'taskeex.synced'

function loadSynced(uid: string): Task[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? 'null')
    return saved?.uid === uid ? saved.tasks : null
  } catch {
    return null
  }
}

function saveSynced(uid: string | null, tasks: Task[] = []) {
  try {
    if (uid) localStorage.setItem(SYNCED_KEY, JSON.stringify({ uid, tasks }))
    else localStorage.removeItem(SYNCED_KEY)
  } catch {
    // Without storage, a device is treated as new to the account each time it opens.
  }
}
const PUSH_DELAY_MS = 400

export type CalendarState =
  /** Every task on the calendar has an up-to-date event. */
  | 'ok'
  /** Events are being written. */
  | 'working'
  /** Google access ran out; a tap is needed before events can be written again. */
  | 'reconnect'

export type Cloud = {
  /** False when no Firebase project is set up: tasks then stay on this device. */
  configured: boolean
  /** Null while signed out, undefined until it is known. */
  account: Account | null | undefined
  calendar: CalendarState
  error: string | null
  signIn: () => void
  signOut: () => void
  reconnect: () => void
}

/**
 * Keeps the tasks on this device and in the signed-in account the same, and keeps the
 * account's tasks and Google Calendar the same.
 */
export function useCloud(tasks: Task[], setTasks: (tasks: Task[]) => void): Cloud {
  const [api, setApi] = useState<Api | null>(null)
  const [account, setAccount] = useState<Account | null | undefined>(cloudConfigured ? undefined : null)
  const [calendar, setCalendar] = useState<CalendarState>('ok')
  const [error, setError] = useState<string | null>(null)

  /** The account's tasks as last heard from the server. Null until the first answer. */
  const synced = useRef<Task[] | null>(null)
  const events = useRef<Events>({})
  const calendarId = useRef<string | null>(null)
  const latest = useRef(tasks)
  latest.current = tasks
  /** Counts answers from the server, so that saving is looked at again after each one. */
  const [heard, setHeard] = useState(0)
  const calendarTimer = useRef<number | undefined>(undefined)
  const busy = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (!cloudConfigured) return
    let stop = () => {}
    import('./cloud').then((m) => {
      setApi(m)
      stop = m.onAccount(setAccount)
    })
    return () => stop()
  }, [])

  const say = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  // Write to Google Calendar whatever it is missing. Runs one at a time.
  const reconcile = useCallback(async () => {
    if (!api || !account || !synced.current) return
    if (busy.current) {
      again.current = true
      return
    }
    if (!hasCalendarWork(synced.current, events.current)) return setCalendar('ok')
    const token = api.googleToken()
    if (!token) return setCalendar('reconnect')
    busy.current = true
    setCalendar('working')
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      let id = calendarId.current
      if (!id) {
        const made = await createCalendar(token, timeZone)
        // If another device made one at the same moment, both settle on the same calendar.
        id = await api.claimCalendar(account.uid, made)
        if (id !== made) await removeCalendar(token, made)
        calendarId.current = id
      }
      const work = calendarWork(synced.current, events.current)
      for (const taskId of work.clear) {
        await removeEvent(token, id, taskId)
        await api.setEvent(account.uid, taskId, null)
      }
      for (const t of work.write) {
        await writeEvent(token, id, t, timeZone)
        await api.setEvent(account.uid, t.id, calSig(t)!)
      }
      setCalendar('ok')
      setError(null)
    } catch (e) {
      if (e instanceof TokenExpired) {
        api.dropGoogleToken()
        setCalendar('reconnect')
      } else if (e instanceof CalendarMissing) {
        // Make a new calendar on the next run.
        calendarId.current = null
        await api.setCalendarId(account.uid, null)
        await api.clearEvents(account.uid)
        again.current = true
      } else {
        say(e)
      }
    } finally {
      busy.current = false
      if (again.current) {
        again.current = false
        void reconcile()
      }
    }
  }, [api, account])

  // Hear about the account's tasks, from this and every other device.
  useEffect(() => {
    if (!api || !account) return
    synced.current = null
    /** What this device last heard, from an earlier visit. Null on a device new to the account. */
    let remembered = loadSynced(account.uid)
    let first = true
    const stop = api.listen(
      account.uid,
      (snapshot) => {
        const local = latest.current
        const base = first ? remembered : synced.current
        let next = snapshot.tasks
        if (base === null) {
          // A device new to this account adds its own tasks to it.
          next = union(snapshot.tasks, local)
        } else if (local !== base) {
          // Changes made here that are not saved yet stay on top of what arrived.
          next = applyDiff(snapshot.tasks, diff(base, local))
        }
        first = false
        remembered = null
        saveSynced(account.uid, snapshot.tasks)
        events.current = snapshot.events
        calendarId.current = snapshot.calendarId
        if (sameTasks(next, local)) {
          // Nothing to show. If it also matches the server, remember this list as saved.
          synced.current = sameTasks(snapshot.tasks, local) ? local : snapshot.tasks
        } else {
          synced.current = sameTasks(next, snapshot.tasks) ? next : snapshot.tasks
          setTasks(next)
        }
        setHeard((n) => n + 1)
        // The device in use writes to Google Calendar first. The others look a little later,
        // and by then usually find nothing left to do.
        window.clearTimeout(calendarTimer.current)
        calendarTimer.current = window.setTimeout(reconcile, document.hasFocus() ? 300 : 3000 + Math.random() * 2000)
      },
      say,
    )
    return () => {
      stop()
      window.clearTimeout(calendarTimer.current)
    }
  }, [api, account, reconcile, setTasks])

  // Save changes made on this device, a moment after the last one.
  useEffect(() => {
    if (!api || !account || synced.current === null || tasks === synced.current) return
    const timer = window.setTimeout(() => {
      const d = diff(synced.current ?? [], tasks)
      if (d.upserts.length + d.removes.length) api.push(account.uid, d).catch(say)
    }, PUSH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [api, account, tasks, heard])

  const signIn = useCallback(() => {
    api
      ?.signIn()
      .then(() => setError(null))
      .catch(say)
  }, [api])

  const reconnect = useCallback(() => {
    api
      ?.signIn(account?.email)
      .then(() => reconcile())
      .catch(say)
  }, [api, account, reconcile])

  const signOut = useCallback(() => {
    // Signing in again later merges this device's tasks with the account's.
    saveSynced(null)
    synced.current = null
    setCalendar('ok')
    api?.signOut().catch(say)
  }, [api])

  return { configured: cloudConfigured, account, calendar, error, signIn, signOut, reconnect }
}
