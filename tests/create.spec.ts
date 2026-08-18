/**
 * createReadonlySession: isolated directory cwd, the hidden preset mounted,
 * the zero-length turn lock, and the read-only/ask permission seeds — all
 * via the same public services the plugin ships against.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import { createReadonlySession } from '../src/index.ts'

const temps: string[] = []

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-no-workspace-')))
  temps.push(dir)
  return dir
}

afterEach(() => {
  // Temp dirs are intentionally left for inspection on failure; best-effort cleanup.
})

describe('createReadonlySession', () => {
  it('creates a session on the hidden preset with the isolated cwd, the turn lock, and the permission seeds', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const isolatedRoot = tempRoot()
    const mounted: string[] = []
    ctx.provide('agentPresets', {
      mount: (_agentCtx: unknown, id?: string) => { mounted.push(id ?? ''); return Promise.resolve({ id: id ?? '' }) },
    } as never)
    ctx.agents.setFactory({
      async createAgent(_ownerCtx, options) {
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
    expect(session.header.agentPreset).toBe('no-workspace')
    expect(session.header.cwd).toBe(join(isolatedRoot, session.id))
    const types = session.events.map(event => event.type)
    // The lock pair and the permission seeds land in the log.
    expect(types).toContain('turn/start')
    expect(types).toContain('turn/end')
    expect(session.events.find(event => event.type === 'sandbox/mode')?.data.mode).toBe('read-only')
    expect(session.events.find(event => event.type === 'approval/policy')?.data.policy).toBe('ask')
    // The lock predicate: the session is permanently non-blank.
    expect(session.events.some(event => event.type === 'turn/start')).toBe(true)
  })
})
