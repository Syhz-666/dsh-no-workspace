/**
 * Roster-hide decoration: list filters the hidden ids, resolve/mount are
 * untouched, and disposal restores the original method exactly.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installHide } from '../src/hide.ts'

interface PresetRow { id: string }

function roster(list: () => Promise<PresetRow[]>): { service: unknown; list: () => Promise<PresetRow[]> } {
  const service = { list }
  return { service, list: () => service.list() }
}

describe('installHide', () => {
  it('filters the hidden ids from list and keeps the rest', async () => {
    const ctx = new Context()
    const { service } = roster(async () => [{ id: 'standard' }, { id: 'no-workspace' }, { id: 'minimal' }])
    ctx.provide('agentPresets', service as never)
    const dispose = installHide(ctx, ['no-workspace'])
    try {
      const rows = await (ctx.get('agentPresets') as unknown as { list(): Promise<PresetRow[]> }).list()
      expect(rows.map(row => row.id)).toEqual(['standard', 'minimal'])
    } finally {
      dispose()
    }
  })

  it('restores the original method on disposal', async () => {
    const ctx = new Context()
    const original = vi.fn(async () => [{ id: 'no-workspace' }])
    const { service } = roster(original)
    ctx.provide('agentPresets', service as never)
    const dispose = installHide(ctx, ['no-workspace'])
    await (ctx.get('agentPresets') as unknown as { list(): Promise<PresetRow[]> }).list()
    dispose()
    await (ctx.get('agentPresets') as unknown as { list(): Promise<PresetRow[]> }).list()
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('is a no-op without the roster service or an empty hide list', () => {
    const ctx = new Context()
    expect(installHide(ctx, ['no-workspace'])).toBeTypeOf('function')
    expect(() => installHide(ctx, [])).not.toThrow()
  })
})
