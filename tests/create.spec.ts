/**
 * createReadonlySession: isolated directory cwd, the preset mounted, and the
 * low-effort model default. The lock and permission seeds are owned by
 * lockReadonlySession (applied at session/created and on preset switches by
 * the plugin), tested separately below.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import { createReadonlySession, lockReadonlySession } from '../src/index.ts'

const temps: string[] = []

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-no-workspace-')))
  temps.push(dir)
  return dir
}

describe('createReadonlySession', () => {
  it('creates a session on the preset with the isolated cwd and the low-effort model default', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const isolatedRoot = tempRoot()
    const mounted: string[] = []
    let seenOptions: unknown
    ctx.provide('agentPresets', {
      mount: (_agentCtx: unknown, id?: string) => { mounted.push(id ?? ''); return Promise.resolve({ id: id ?? '' }) },
    } as never)
    ctx.agents.setFactory({
      async createAgent(_ownerCtx, options) {
        seenOptions = options.agentOptions
        const session = ctx.sessions.create(
          options.sessionId,
          options.meta === undefined ? {} : { meta: options.meta },
        )
        const agent = { id: session.id, session } as never
        const agentCtx = ctx.extend({ agent })
        await options.setup?.(agentCtx)
        ctx.agents.register(agent)
        return { agent, dispose: () => Promise.resolve() }
      },
      async resume() {
        throw new Error('not implemented')
      },
    } as never)

    const session = await createReadonlySession(ctx, isolatedRoot, {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'low',
    })

    expect(mounted).toEqual(['no-workspace'])
    expect(seenOptions).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'low',
    })
    expect(session.header.agentPreset).toBe('no-workspace')
    expect(session.header.cwd).toBe(join(isolatedRoot, session.id))
  })
})

describe('lockReadonlySession', () => {
  it('locks a no-workspace session: the turn pair plus the permission seeds', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create('session-lock-1', { meta: { agentPreset: 'no-workspace' } })
    lockReadonlySession(session)
    expect(session.events.some(event => event.type === 'turn/start')).toBe(true)
    expect(session.events.some(event => event.type === 'turn/end')).toBe(true)
    expect(session.events.find(event => event.type === 'sandbox/mode')?.data.mode).toBe('read-only')
    expect(session.events.find(event => event.type === 'approval/policy')?.data.policy).toBe('ask')
  })

  it('is idempotent: an already-locked session is not touched again', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create('session-lock-2', { meta: { agentPreset: 'no-workspace' } })
    lockReadonlySession(session)
    lockReadonlySession(session)
    expect(session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'sandbox/mode')).toHaveLength(1)
  })

  it('leaves other sessions untouched', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create('session-lock-3', { meta: { agentPreset: 'standard' } })
    lockReadonlySession(session)
    expect(session.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(session.events.some(event => event.type === 'sandbox/mode')).toBe(false)
  })

  it('locks a session switched onto the preset while blank (the log selection wins over the header)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    // Created on another preset, then switched while blank — the header still
    // names the creation preset; the lock must follow the log, not the header.
    const session = ctx.sessions.create('session-lock-4', { meta: { agentPreset: 'standard' } })
    session.append('agent-preset/selected', { agentPreset: 'no-workspace' })
    lockReadonlySession(session)
    expect(session.events.some(event => event.type === 'turn/start')).toBe(true)
    expect(session.events.find(event => event.type === 'sandbox/mode')?.data.mode).toBe('read-only')
  })

  it('does not lock a blank session that switched onto another preset', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create('session-lock-5', { meta: { agentPreset: 'no-workspace' } })
    session.append('agent-preset/selected', { agentPreset: 'standard' })
    lockReadonlySession(session)
    expect(session.events.some(event => event.type === 'turn/start')).toBe(false)
  })
})
