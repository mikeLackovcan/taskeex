import { describe, expect, it } from 'vitest'
import type { Task } from './schedule'
import { applyDiff, calSig, calendarWork, diff, eventBody, eventId, sameTasks, union } from './sync'

const t = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, duration: 30, at: id.charCodeAt(0), ...extra })

describe('diff', () => {
  it('finds new, changed and removed tasks', () => {
    const d = diff([t('a'), t('b'), t('c')], [t('a'), t('b', { title: 'B' }), t('d')])
    expect(d.upserts.map((x) => x.id)).toEqual(['b', 'd'])
    expect(d.removes.map((x) => x.id)).toEqual(['c'])
  })
  it('sees a field that was removed', () => {
    expect(diff([t('a', { day: '2026-11-12' })], [t('a')]).upserts).toHaveLength(1)
  })
  it('is empty for equal lists', () => {
    expect(diff([t('a')], [t('a')])).toEqual({ upserts: [], removes: [] })
    expect(sameTasks([t('a')], [t('a')])).toBe(true)
  })
})

describe('applyDiff', () => {
  it('replays local changes on top of newer account data', () => {
    const base = [t('a'), t('b')]
    const local = [t('a', { done: true }), t('c')] // marked a done, removed b, added c
    const remote = [t('a'), t('b'), t('z')] // another device added z meanwhile
    expect(applyDiff(remote, diff(base, local))).toEqual([t('a', { done: true }), t('c'), t('z')])
  })
})

it('union adds this device’s tasks to the account’s and keeps the account’s version', () => {
  expect(union([t('a', { title: 'remote' })], [t('a', { title: 'local' }), t('b')])).toEqual([
    t('a', { title: 'remote' }),
    t('b'),
  ])
})

describe('calendar', () => {
  it('eventId uses only characters Google allows and is stable', () => {
    expect(eventId('3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90')).toBe('tx3f2a9c1e5b7d4e8a9c217d4e5f6a8b90')
    expect(eventId('welcome')).toMatch(/^tx[0-9a-v]+$/)
    expect(eventId('welcome')).toBe(eventId('welcome'))
  })
  it('a timed task becomes an event with a reminder', () => {
    const e = eventBody(t('a', { day: '2026-11-12', start: 9 * 60 + 30, duration: 45 }), 'Europe/Prague')
    expect(e.start).toEqual({ dateTime: '2026-11-12T09:30:00', timeZone: 'Europe/Prague' })
    expect(e.end).toEqual({ dateTime: '2026-11-12T10:15:00', timeZone: 'Europe/Prague' })
    expect(e.reminders.overrides).toEqual([{ method: 'popup', minutes: 10 }])
  })
  it('a task that ends at midnight ends on the next day', () => {
    const e = eventBody(t('a', { day: '2026-11-30', start: 23 * 60, duration: 60 }), 'UTC')
    expect(e.end).toEqual({ dateTime: '2026-12-01T00:00:00', timeZone: 'UTC' })
  })
  it('a task with no set time becomes an all-day event', () => {
    const e = eventBody(t('a', { day: '2026-12-31' }), 'UTC')
    expect(e.start).toEqual({ date: '2026-12-31' })
    expect(e.end).toEqual({ date: '2027-01-01' })
  })
  it('a done task is ticked and has no reminder', () => {
    const e = eventBody(t('a', { day: '2026-11-12', start: 600, done: true }), 'UTC')
    expect(e.summary).toBe('✓ a')
    expect(e.reminders.overrides).toEqual([])
  })
  it('finds the events that are out of date', () => {
    const fresh = t('a', { day: '2026-11-12', start: 600 })
    const tasks = [
      fresh, // up to date
      t('b', { day: '2026-11-12', start: 660 }), // never written
      t('c', { day: '2026-11-12', start: 700 }), // changed since
      t('d'), // taken off the calendar
      t('e'), // a loose bubble
    ]
    const work = calendarWork(tasks, { a: calSig(fresh)!, c: 'old', d: 'old', gone: 'old' })
    expect(work.write.map((x) => x.id)).toEqual(['b', 'c'])
    expect(work.clear).toEqual(['d', 'gone']) // "gone" is a deleted task
  })
  it('a deleted task that is brought back keeps its event', () => {
    const a = t('a', { day: '2026-11-12', start: 600 })
    expect(calendarWork([a], { a: calSig(a)! })).toEqual({ write: [], clear: [] })
    // If the event was already removed, it is written again.
    expect(calendarWork([a], {}).write).toEqual([a])
  })
})

describe('repeating tasks in Google Calendar', () => {
  it('get a repeat rule', () => {
    expect(eventBody(t('a', { day: '2026-11-12', start: 600, repeat: 'weekdays' }), 'UTC').recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    ])
    expect(eventBody(t('a', { day: '2026-11-12', start: 600 }), 'UTC').recurrence).toEqual([])
  })
  it('a day marked done does not change the event, a new repeat does', () => {
    const a = t('a', { day: '2026-11-12', start: 600, repeat: 'daily' })
    expect(calSig({ ...a, doneOn: ['2026-11-13'] })).toBe(calSig(a))
    expect(calSig({ ...a, repeat: 'weekly' })).not.toBe(calSig(a))
  })
  it('lists with equal done days are the same', () => {
    expect(sameTasks([t('a', { doneOn: ['2026-11-13'] })], [t('a', { doneOn: ['2026-11-13'] })])).toBe(true)
  })
})
