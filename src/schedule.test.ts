import { describe, expect, it } from 'vitest'
import { freeStartAt, moveToDay, setDay, nextFreeSlot, placeAt, resize, rollOver, schedule, setStart, unschedule, weekStart, dayKey, occursOn, onDay, toggleDoneOn, moveCopy, setRepeat, type Task } from './schedule'

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

describe('placeAt', () => {
  it('snaps to the nearest quarter hour', () => {
    expect(freeStartAt([{ id: 'x', title: 'x', duration: 30 }], 'x', '2026-11-12', 547)).toBe(540)
    expect(freeStartAt([{ id: 'x', title: 'x', duration: 30 }], 'x', '2026-11-12', 553)).toBe(555)
  })
  it('moves past a task that is running at that time', () => {
    const out = placeAt([t('a', 540, 60), { id: 'x', title: 'x', duration: 30 }], 'x', '2026-11-12', 570)
    expect(out[1]).toMatchObject({ day: '2026-11-12', start: 600 })
  })
  it('pushes a task that starts inside the new one', () => {
    const out = placeAt([t('a', 600, 30), { id: 'x', title: 'x', duration: 60 }], 'x', '2026-11-12', 570)
    expect(out.map((x) => x.start)).toEqual([630, 570])
  })
  it('stays inside the day', () => {
    expect(freeStartAt([{ id: 'x', title: 'x', duration: 60 }], 'x', '2026-11-12', 1500)).toBe(1380)
    expect(freeStartAt([{ id: 'x', title: 'x', duration: 60 }], 'x', '2026-11-12', -40)).toBe(0)
  })
})

describe('day tasks without a set time', () => {
  const loose: Task = { id: 'x', title: 'x', duration: 30 }
  it('setDay gives a day and no time', () => {
    expect(setDay([t('a', 540, 30)], 'a', '2026-11-13')[0]).toEqual({ id: 'a', title: 'a', duration: 30, day: '2026-11-13' })
  })
  it('timed tasks ignore them when finding a slot', () => {
    const day = [{ ...loose, id: 'u', day: '2026-11-12' }, loose]
    expect(placeAt(day, 'x', '2026-11-12', 540)[1].start).toBe(540)
    expect(schedule(day, 'x', '2026-11-12', new Date(2026, 10, 1))[1].start).toBe(540)
  })
  it('moveToDay keeps the time of a timed task', () => {
    expect(moveToDay([t('a', 600, 30)], 'a', '2026-11-14')[0]).toMatchObject({ day: '2026-11-14', start: 600 })
  })
  it('moveToDay keeps a loose bubble without a time', () => {
    expect(moveToDay([loose], 'x', '2026-11-14')[0]).toEqual({ ...loose, day: '2026-11-14' })
  })
  it('a rolling day task rolls over without getting a time', () => {
    const out = rollOver([{ ...loose, day: '2026-11-10', rolling: true }], new Date(2026, 10, 14, 8, 0))
    expect(out[0]).toEqual({ ...loose, day: '2026-11-14', rolling: true })
  })
})

describe('repeating tasks', () => {
  const r = (id: string, day: string, repeat: Task['repeat'], start?: number): Task => ({ id, title: id, duration: 60, day, start, repeat })
  it('show on matching days from their first day on', () => {
    const daily = r('d', '2026-11-12', 'daily', 600) // Thursday
    const weekly = r('w', '2026-11-12', 'weekly', 600)
    const weekdays = r('k', '2026-11-12', 'weekdays', 600)
    expect(occursOn(daily, '2026-11-11')).toBe(false)
    expect(occursOn(daily, '2026-11-15')).toBe(true)
    expect(occursOn(weekly, '2026-11-19')).toBe(true)
    expect(occursOn(weekly, '2026-11-20')).toBe(false)
    expect(occursOn(weekdays, '2026-11-14')).toBe(false) // Saturday
    expect(occursOn(weekdays, '2026-11-16')).toBe(true)
  })
  it('are done one day at a time', () => {
    let ts: Task[] = [r('d', '2026-11-12', 'daily', 600)]
    ts = toggleDoneOn(ts, 'd', '2026-11-13')
    expect(onDay(ts, '2026-11-13')[0].done).toBe(true)
    expect(onDay(ts, '2026-11-14')[0].done).toBe(false)
    expect(toggleDoneOn(ts, 'd', '2026-11-13')[0].doneOn).toBeUndefined()
  })
  it('take up their time on every day they show', () => {
    const ts = [r('d', '2026-11-12', 'daily', 540), { id: 'x', title: 'x', duration: 30 }]
    expect(schedule(ts, 'x', '2026-11-20').find((t) => t.id === 'x')!.start).toBe(600)
  })
  it('hold their time when a one-off task pushes others down', () => {
    const ts: Task[] = [
      r('d', '2026-11-12', 'daily', 660), // 11:00 to 12:00 every day
      { id: 'a', title: 'a', duration: 60, day: '2026-11-13', start: 600 },
      { id: 'b', title: 'b', duration: 60, day: '2026-11-13' },
    ]
    const next = placeAt(ts, 'b', '2026-11-13', 570)
    expect(next.find((t) => t.id === 'd')!.start).toBe(660)
    expect(next.find((t) => t.id === 'a')!.start).toBe(720) // pushed past 10:30, then past the daily task
  })
  it('move as a whole when one day is dragged', () => {
    const ts = [r('w', '2026-11-12', 'weekly', 600)]
    const moved = moveCopy(ts, 'w', '2026-11-19', '2026-11-20', (x, day) => placeAt(x, 'w', day, 720))
    expect(moved[0]).toMatchObject({ day: '2026-11-13', start: 720 }) // now every Friday at 12:00
  })
  it('a weekday task dropped on a weekend only changes its time', () => {
    const ts = [r('k', '2026-11-12', 'weekdays', 600)]
    const moved = moveCopy(ts, 'k', '2026-11-13', '2026-11-14', (x, day) => placeAt(x, 'k', day, 720))
    expect(moved[0]).toMatchObject({ day: '2026-11-12', start: 720 })
  })
  it('a weekday repeat set on a weekend starts on Monday', () => {
    const ts: Task[] = [{ id: 's', title: 's', duration: 30, day: '2026-11-14', rolling: true }]
    expect(setRepeat(ts, 's', 'weekdays')[0]).toEqual({ id: 's', title: 's', duration: 30, day: '2026-11-16', repeat: 'weekdays' })
  })
  it('do not roll over', () => {
    const ts = [{ ...r('d', '2026-11-10', 'daily', 600), rolling: true }]
    expect(rollOver(ts, new Date('2026-11-12T12:00'))).toEqual(ts)
  })
})
