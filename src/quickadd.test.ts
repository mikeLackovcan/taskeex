import { describe, expect, it } from 'vitest'
import { readQuickAdd } from './quickadd'

// Thursday 12 November 2026, 10:00
const now = new Date('2026-11-12T10:00')

describe('quick add', () => {
  it('keeps a plain name as a bubble', () => {
    expect(readQuickAdd('Call mum', now)).toEqual({ title: 'Call mum' })
    expect(readQuickAdd('Read 3 chapters', now)).toEqual({ title: 'Read 3 chapters' })
  })
  it('reads day, time and length', () => {
    expect(readQuickAdd('Gym tomorrow 6pm 1h', now)).toEqual({ title: 'Gym', day: '2026-11-13', start: 1080, duration: 60 })
    expect(readQuickAdd('Dentist on friday at 14:30', now)).toEqual({ title: 'Dentist', day: '2026-11-13', start: 870 })
    expect(readQuickAdd('Taxes monday 90 min', now)).toEqual({ title: 'Taxes', day: '2026-11-16', duration: 90 })
  })
  it('puts a time with no day on its next occurrence', () => {
    expect(readQuickAdd('Run 7am', now)).toMatchObject({ title: 'Run', day: '2026-11-13', start: 420 })
    expect(readQuickAdd('Run at 6', now)).toMatchObject({ day: '2026-11-12', start: 1080 })
  })
  it('reads today and tonight', () => {
    expect(readQuickAdd('Shop today', now)).toEqual({ title: 'Shop', day: '2026-11-12' })
    expect(readQuickAdd('Film tonight', now)).toEqual({ title: 'Film', day: '2026-11-12', start: 1140 })
  })
  it('a weekday name means the next one, never today', () => {
    expect(readQuickAdd('Plan thursday', now).day).toBe('2026-11-19')
    expect(readQuickAdd('Pay rent on fri', now).day).toBe('2026-11-13')
    expect(readQuickAdd('Buy sun cream', now)).toEqual({ title: 'Buy sun cream' })
  })
  it('keeps the words when nothing else is left', () => {
    expect(readQuickAdd('tomorrow', now)).toEqual({ title: 'tomorrow' })
  })
})
