// Calls to Google Calendar, made from the browser with the access token from Google sign-in.
import type { Task } from './schedule'
import { eventBody, eventId } from './sync'

const API = 'https://www.googleapis.com/calendar/v3'

/** Google no longer accepts the access token. The person has to connect the calendar again. */
export class TokenExpired extends Error {}
/** The Taskeex calendar was deleted in Google Calendar. */
export class CalendarMissing extends Error {}

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new TokenExpired()
  return res
}

const fail = async (what: string, res: Response) =>
  new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)

/** Make the calendar that holds Taskeex's events and return its id. */
export async function createCalendar(token: string, timeZone: string) {
  const res = await call(token, 'POST', '/calendars', { summary: 'Taskeex', timeZone })
  if (!res.ok) throw await fail('Creating the Taskeex calendar', res)
  return ((await res.json()) as { id: string }).id
}

export async function removeCalendar(token: string, calendarId: string) {
  await call(token, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}`)
}

/** Create the task's event, or rewrite it if it exists. Also brings back an event deleted earlier. */
export async function writeEvent(token: string, calendarId: string, task: Task, timeZone: string) {
  const events = `/calendars/${encodeURIComponent(calendarId)}/events`
  const id = eventId(task.id)
  const body = eventBody(task, timeZone)
  let res = await call(token, 'PUT', `${events}/${id}`, body)
  if (res.status === 404) {
    res = await call(token, 'POST', events, { ...body, id })
    if (res.status === 404) throw new CalendarMissing()
    // Another device made it a moment ago.
    if (res.status === 409) res = await call(token, 'PUT', `${events}/${id}`, body)
  }
  if (!res.ok) throw await fail('Saving the calendar event', res)
}

export async function removeEvent(token: string, calendarId: string, taskId: string) {
  const res = await call(token, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${eventId(taskId)}`)
  // Already gone is fine.
  if (!res.ok && res.status !== 404 && res.status !== 410) throw await fail('Removing the calendar event', res)
}
