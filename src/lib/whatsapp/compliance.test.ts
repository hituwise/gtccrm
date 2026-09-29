import { describe, it, expect } from 'vitest'
import { isOptOutMessage } from './compliance'

describe('WhatsApp compliance — opt-out handling', () => {
  it('detects standard opt-out keywords case-insensitively', () => {
    expect(isOptOutMessage('STOP')).toBe(true)
    expect(isOptOutMessage('stop')).toBe(true)
    expect(isOptOutMessage('Stop')).toBe(true)
    expect(isOptOutMessage('UNSUBSCRIBE')).toBe(true)
    expect(isOptOutMessage('unsubscribe')).toBe(true)
    expect(isOptOutMessage('CANCEL')).toBe(true)
    expect(isOptOutMessage('quit')).toBe(true)
    expect(isOptOutMessage('opt-out')).toBe(true)
    expect(isOptOutMessage('optout')).toBe(true)
    expect(isOptOutMessage('END')).toBe(true)
    expect(isOptOutMessage('stopall')).toBe(true)
    expect(isOptOutMessage('revoke')).toBe(true)
  })

  it('handles leading and trailing whitespace', () => {
    expect(isOptOutMessage('  STOP  \n')).toBe(true)
    expect(isOptOutMessage('\tunsubscribe ')).toBe(true)
  })

  it('does not flag normal conversational messages containing opt-out words', () => {
    expect(isOptOutMessage('Please do not stop the service')).toBe(false)
    expect(isOptOutMessage('Can you stop by tomorrow?')).toBe(false)
    expect(isOptOutMessage('Hello, how much is this?')).toBe(false)
    expect(isOptOutMessage('I want to cancel my appointment today')).toBe(false)
  })

  it('handles null, undefined, and empty string', () => {
    expect(isOptOutMessage(null)).toBe(false)
    expect(isOptOutMessage(undefined)).toBe(false)
    expect(isOptOutMessage('')).toBe(false)
    expect(isOptOutMessage('   ')).toBe(false)
  })
})
