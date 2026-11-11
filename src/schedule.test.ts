import { describe, expect, it } from 'vitest'
import { nextFreeSlot, resize, rollOver, schedule, setStart, unschedule, weekStart, dayKey, type Task } from './schedule'

const t = (id: string, start: number, duration: number): Task => ({ id, title: id, duration, day: '2026-11-12', start })

describe('nextFreeSlot', () => {
  it('starts at 9:00 on an empty day', () => {
    expect(nextFreeSlot([], 30)).toBe(540)
  })
  it('goes after back-to-back tasks', () => {
    expect(nextFreeSlot([t('a', 540, 30), t('b', 570, 60)], 30)).toBe(630)
  })
  it('uses a gap that is big enough', () => {
    expect(nextFreeSlot([t('a', 540, 30), t('b', 600, 60)], 30)).toBe(570)
  })
  it('skips a gap that is too small', () => {
    expect(nextFreeSlot([t('a', 540, 30), t('b', 600, 60)], 60)).toBe(660)
  })
  it('rounds the earliest time up to a quarter hour', () => {
    expect(nextFreeSlot([], 30, 547)).toBe(555)
  })
})

describe('schedule', () => {
  const loose: Task = { id: 'x', title: 'x', duration: 30 }
  it('never schedules before now on today', () => {
    const now = new Date(2026, 10, 12, 14, 5)
    const out = schedule([loose], 'x', '2026-11-12', now)
    expect(out[0].start).toBe(14 * 60 + 15)
  })
  it('starts at 9:00 on another day', () => {
    const now = new Date(2026, 10, 12, 14, 5)
    expect(schedule([loose], 'x', '2026-11-13', now)[0].start).toBe(540)
  })
  it('unschedule turns it back into a bubble', () => {
    expect(unschedule([t('a', 540, 30)], 'a')[0]).toEqual({ id: 'a', title: 'a', duration: 30 })
  })
})

it('weekStart is the Monday', () => {
  expect(dayKey(weekStart(new Date(2026, 10, 15)))).toBe('2026-11-09')
  expect(dayKey(weekStart(new Date(2026, 10, 9)))).toBe('2026-11-09')
})

describe('resize', () => {
  it('keeps the start and pushes later tasks down', () => {
    const out = resize([t('a', 540, 30), t('b', 570, 30), t('c', 720, 30)], 'a', 120)
    expect(out.map((x) => x.start)).toEqual([540, 660, 720])
  })
  it('pushes a chain of tasks', () => {
    const out = resize([t('a', 540, 30), t('b', 570, 30), t('c', 600, 30)], 'a', 60)
    expect(out.map((x) => x.start)).toEqual([540, 600, 630])
  })
  it('only changes the length of a loose bubble', () => {
    expect(resize([{ id: 'x', title: 'x', duration: 30 }], 'x', 60)[0]).toEqual({ id: 'x', title: 'x', duration: 60 })
  })
})

describe('setStart', () => {
  it('moves the task and pushes the ones from that time on', () => {
    const out = setStart([t('a', 540, 30), t('b', 600, 30), t('c', 630, 30)], 'a', 600)
    expect(out.map((x) => x.start)).toEqual([600, 630, 660])
  })
  it('leaves earlier tasks alone', () => {
    const out = setStart([t('a', 540, 30), t('b', 600, 30)], 'b', 720)
    expect(out.map((x) => x.start)).toEqual([540, 720])
  })
})

describe('rollOver', () => {
  const now = new Date(2026, 10, 14, 8, 0)
  it('moves an undone rolling task from a past day to today', () => {
    const out = rollOver([{ ...t('a', 600, 30), rolling: true }], now)
    expect(out[0]).toMatchObject({ day: '2026-11-14', start: 540 })
  })
  it('leaves done, plain and future tasks where they are', () => {
    const tasks = [
      { ...t('a', 600, 30), rolling: true, done: true },
      t('b', 600, 30),
      { ...t('c', 600, 30), rolling: true, day: '2026-11-20' },
    ]
    expect(rollOver(tasks, now)).toEqual(tasks)
  })
})
