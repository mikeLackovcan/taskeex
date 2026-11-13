import { describe, expect, it } from 'vitest'
import { applyPlan, cleanRule, describeRule, planSpread, readRule } from './spread'
import type { Task } from './schedule'

// Thursday 12 November 2026, 10:00
const now = new Date('2026-11-12T10:00')
const loose = (id: string, duration = 60): Task => ({ id, title: id, duration })

describe('reading a sentence', () => {
  it("reads Mike's example", () => {
    const { rule, understood } = readRule('every other day from 6 to 8 pm, each task only one day', now)
    expect(understood).toBe(true)
    expect(rule).toMatchObject({ everyDays: 2, perDay: 1, windowStart: 18 * 60, windowEnd: 20 * 60, from: '2026-11-12' })
  })
  it('reads times in several forms', () => {
    expect(readRule('18:00-20:30', now).rule).toMatchObject({ windowStart: 1080, windowEnd: 1230 })
    expect(readRule('between 9 and 11am', now).rule).toMatchObject({ windowStart: 540, windowEnd: 660 })
    expect(readRule('after 5pm', now).rule).toMatchObject({ windowStart: 1020 })
    expect(readRule('evenings', now).rule).toMatchObject({ windowStart: 1020, windowEnd: 1260 })
  })
  it('reads days', () => {
    expect(readRule('weekdays, mornings', now).rule.weekdays).toEqual([1, 2, 3, 4, 5])
    expect(readRule('on the weekend', now).rule.weekdays).toEqual([0, 6])
    expect(readRule('mondays and wednesdays', now).rule.weekdays).toEqual([1, 3])
    expect(readRule('starting monday, one a day', now).rule).toMatchObject({ from: '2026-11-16', perDay: 1, weekdays: [] })
  })
  it('reads today, tomorrow, this week and next week', () => {
    expect(readRule('today', now).rule).toMatchObject({ from: '2026-11-12', until: '2026-11-12', perDay: 99 })
    expect(readRule('tomorrow afternoon', now).rule).toMatchObject({ from: '2026-11-13', until: '2026-11-13' })
    expect(readRule('two a day this week', now).rule).toMatchObject({ perDay: 2, until: '2026-11-15' })
    expect(readRule('next week', now).rule).toMatchObject({ from: '2026-11-16', until: '2026-11-22' })
  })
  it('says when it did not understand', () => {
    expect(readRule('whenever the moon is full', now).understood).toBe(false)
  })
})

describe('placing', () => {
  it('puts one task every other day in the window', () => {
    const tasks = [loose('a'), loose('b'), loose('c')]
    const rule = readRule('every other day from 6 to 8 pm, one a day', now).rule
    expect(planSpread(tasks, ['a', 'b', 'c'], rule, now)).toEqual([
      { id: 'a', day: '2026-11-12', start: 1080 },
      { id: 'b', day: '2026-11-14', start: 1080 },
      { id: 'c', day: '2026-11-16', start: 1080 },
    ])
  })
  it('works around what is already on the calendar', () => {
    const tasks: Task[] = [{ id: 'x', title: 'x', duration: 60, day: '2026-11-12', start: 1080 }, loose('a')]
    const rule = readRule('6 to 8 pm', now).rule
    expect(planSpread(tasks, ['a'], rule, now)).toEqual([{ id: 'a', day: '2026-11-12', start: 1140 }])
  })
  it('skips a day that is full', () => {
    const tasks: Task[] = [{ id: 'x', title: 'x', duration: 120, day: '2026-11-12', start: 1080 }, loose('a')]
    const rule = readRule('6 to 8 pm', now).rule
    expect(planSpread(tasks, ['a'], rule, now)[0].day).toBe('2026-11-13')
  })
  it('never places in the past', () => {
    const rule = readRule('mornings', now).rule // 8 to 12, and it is 10:00
    expect(planSpread([loose('a')], ['a'], rule, now)).toEqual([{ id: 'a', day: '2026-11-12', start: 600 }])
  })
  it('stops at the last day and leaves the rest', () => {
    const rule = readRule('today 6 to 8 pm', now).rule
    const plan = planSpread([loose('a'), loose('b'), loose('c')], ['a', 'b', 'c'], rule, now)
    expect(plan.map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('places on matching weekdays only', () => {
    const rule = readRule('weekdays evenings, one a day', now).rule
    const plan = planSpread([loose('a'), loose('b'), loose('c')], ['a', 'b', 'c'], rule, now)
    expect(plan.map((p) => p.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-16'])
  })
  it('applies a plan', () => {
    const tasks = applyPlan([loose('a'), loose('b')], [{ id: 'a', day: '2026-11-12', start: 600 }])
    expect(tasks[0]).toMatchObject({ day: '2026-11-12', start: 600 })
    expect(tasks[1].day).toBeUndefined()
  })
})

describe('saying it back', () => {
  it('describes a rule in a few words', () => {
    expect(describeRule(readRule('every other day 6 to 8 pm one a day', now).rule, now)).toBe('Every other day · 18:00–20:00 · one a day')
    expect(describeRule(readRule('tomorrow afternoon', now).rule, now)).toBe('12:00–17:00 · tomorrow')
  })
})

describe("checking Gemini's answer", () => {
  it('fills in gaps and rejects nonsense', () => {
    expect(cleanRule({ windowStart: 1080, windowEnd: 1200, everyDays: 2 }, now)).toMatchObject({ from: '2026-11-12', perDay: 1, everyDays: 2 })
    expect(cleanRule({ windowStart: 1200, windowEnd: 1080 }, now)).toBeNull()
    expect(cleanRule({ weekdays: [1, 9, 3] as number[] }, now)!.weekdays).toEqual([1, 3])
  })
})
