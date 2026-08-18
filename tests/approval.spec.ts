/**
 * Approval gate: fail-closed ordering (no service / no agent / rejection /
 * no answerer) and the allowed-once path, plus the isolated-directory gate
 * that decides which relative reads may skip approval.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { relativeReadGated, requireReadApproval } from '../src/approval.ts'

/** A minimal agent whose session carries an open turn (the audit precondition). */
function openTurnAgent(): Agent {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [{ type: 'turn/start' }]
  return {
    id: 'agent-test',
    session: {
      header: { id: 'session-test' },
      events,
      append: (type: string, data: Record<string, unknown>) => { events.push({ type, data }) },
    },
  } as unknown as Agent
}

const exec = (agent?: Agent) => ({
  agent,
  callId: 'call-1' as CallId,
  signal: new AbortController().signal,
})

describe('requireReadApproval', () => {
  it('fails closed without an approval service', async () => {
    const ctx = new Context()
    await expect(requireReadApproval(ctx, exec(openTurnAgent()) as never, 'read', '/abs/x')).rejects.toThrow(
      'no approval service is composed',
    )
  })

  it('fails closed without an agent', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    await expect(requireReadApproval(ctx, exec() as never, 'read', '/abs/x')).rejects.toThrow(
      'no agent to route it through',
    )
  })

  it('fails closed when the human rejects', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const reject = ctx.on('approval/request', () => Promise.resolve('rejected' as const), { prepend: true })
    try {
      await expect(requireReadApproval(ctx, exec(openTurnAgent()) as never, 'read', '/abs/x')).rejects.toThrow(
        'the user rejected this filesystem read',
      )
    } finally {
      reject()
    }
  })

  it('fails closed when no answerer answers', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    await expect(requireReadApproval(ctx, exec(openTurnAgent()) as never, 'read', '/abs/x')).rejects.toThrow(
      'the user rejected this filesystem read',
    )
  })

  it('resolves when the human allows the exact call', async () => {
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    const allow = ctx.on('approval/request', () => Promise.resolve('allowed-once' as const), { prepend: true })
    try {
      await expect(requireReadApproval(ctx, exec(openTurnAgent()) as never, 'read', '/abs/x')).resolves.toBeUndefined()
    } finally {
      allow()
    }
  })
})

describe('relativeReadGated', () => {
  const root = join('C:', 'x', '.dsh-no-workspace')
  const inside = join(root, 'session-1')
  const prefixTwin = join('C:', 'x', '.dsh-no-workspace-evil', 'session-1')

  it('allows relative reads when the session directory sits inside the isolated root', () => {
    expect(relativeReadGated(inside, root)).toBe(false)
  })

  it('allows the isolated root itself as the session directory', () => {
    expect(relativeReadGated(root, root)).toBe(false)
  })

  it('gates a directory that merely shares the root prefix', () => {
    expect(relativeReadGated(prefixTwin, root)).toBe(true)
  })

  it('gates a user-chosen workspace directory', () => {
    expect(relativeReadGated(join('C:', 'work'), root)).toBe(true)
  })

  it('gates a session without any directory', () => {
    expect(relativeReadGated(undefined, root)).toBe(true)
  })

  it('fails closed when the isolated root is unknown', () => {
    expect(relativeReadGated(inside, undefined)).toBe(true)
  })
})
