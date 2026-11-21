import { describe, expect, it } from 'vitest'
import { friendlyError } from './useCloud'

const err = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

describe('friendlyError', () => {
  it('stays quiet when the person closes the Google window', () => {
    expect(friendlyError(err('auth/popup-closed-by-user'))).toBeNull()
  })
  it('explains sign-in that is not switched on', () => {
    expect(friendlyError(err('auth/configuration-not-found'))).toMatch(/not switched on/)
  })
  it('explains a disabled database', () => {
    expect(friendlyError(new Error('Cloud Firestore API has not been used in project x'))).toMatch(/Sync is not switched on/)
  })
  it('never shows raw Firebase text', () => {
    expect(friendlyError(err('auth/internal-error'))).not.toMatch(/Firebase/)
  })
})
