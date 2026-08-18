/**
 * The lock mechanism: a zero-length turn pair makes a session non-blank
 * under the upstream blank fold, which is what permanently disables the
 * preset switch guard. This pins the exact fold semantics the plugin relies
 * on (sessionBlank = no turn/start in the log).
 */

import { describe, expect, it } from 'vitest'

interface SessionEvent { type: string }

/** The upstream blank predicate this plugin's lock targets (mirror of dsh-apiproxy). */
function sessionBlank(events: readonly SessionEvent[]): boolean {
  return !events.some(event => event.type === 'turn/start')
}

describe('the zero-length turn lock', () => {
  it('a fresh session is blank', () => {
    expect(sessionBlank([])).toBe(true)
  })

  it('a standalone plugin event keeps a session blank (goals, titles, plan)', () => {
    expect(sessionBlank([{ type: 'goal/round' }, { type: 'session/title' }])).toBe(true)
  })

  it('turn/start alone makes the session non-blank (the lock takes effect)', () => {
    expect(sessionBlank([{ type: 'turn/start' }])).toBe(false)
  })

  it('a closed zero-length turn pair keeps the session non-blank (the lock holds)', () => {
    expect(sessionBlank([{ type: 'turn/start' }, { type: 'turn/end' }])).toBe(false)
  })

  it('later real turns cannot revert blankness (the lock is permanent)', () => {
    const events = [
      { type: 'turn/start' },
      { type: 'turn/end' },
      { type: 'user/message' },
      { type: 'turn/start' },
      { type: 'turn/end' },
    ]
    expect(sessionBlank(events)).toBe(false)
  })
})
