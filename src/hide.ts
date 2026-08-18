/**
 * The roster-hide decoration: `agentPresets.list()` (the data source of every
 * picker and the settings page) reports the hidden preset ids removed, while
 * `resolve()`/`mount()` keep serving them — session resume and creation
 * depend on the hidden preset staying mountable. The decoration is an
 * effect: disposal restores the original method.
 * @module dsh-no-workspace/hide
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'

/**
 * Install the hide decoration on `ctx.agentPresets.list`.
 * @param ctx - plugin context; the optional `agentPresets` service is read once.
 * @param hiddenIds - preset ids to hide from list views.
 * @returns the disposer restoring the original method.
 */
export function installHide(ctx: Context, hiddenIds: readonly string[]): () => void {
  const presets = ctx.get('agentPresets')
  if (presets === undefined || hiddenIds.length === 0) return () => {}
  const service = presets as unknown as { list: () => Promise<AgentPreset[]> }
  const original = service.list.bind(service)
  service.list = async () => {
    const rows = await original()
    return rows.filter(row => !hiddenIds.includes(row.id))
  }
  return () => { service.list = original }
}
