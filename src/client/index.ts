/**
 * Browser half of dsh-no-workspace: registers the "No workspace (read-only
 * session)" entry into the workspace-picker menu through the registry the
 * patches/apply.mjs script injects into the official picker bundle. The pick
 * reads the isolated root from the `dsh-no-workspace` settings namespace,
 * creates the session through the official RPC (with the hidden preset), and
 * opens it.
 * @module dsh-no-workspace/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The workspace-picker menu registry contract shared with patches/apply.mjs:
 * an array of factories; each result is one extra menu entry. The patch
 * initializes the array and merges the entries into the picker menu.
 */
export interface WorkspacePickerExtraEntry {
  id: string
  label: string
  onPick: () => void
}

declare global {
  interface Window {
    __DSH_WORKSPACE_PICKER_EXTRA_ITEMS__?: Array<() => WorkspacePickerExtraEntry>
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-no-workspace-client'

/** No hard service dependencies: the connection handle and sessions face are read off ctx. */
export const inject: readonly string[] = []

/** The settings namespace the host half publishes the isolated root in. */
const SETTINGS_NS = 'dsh-no-workspace'

/** The hidden preset id the create RPC must name. */
const PRESET_ID = 'no-workspace'

/** Minimal structural face of the connection handle's API client. */
interface MenuApi {
  settings: {
    describe(payload: unknown): Promise<{
      result: { ok: boolean; value?: { namespaces?: Array<{ ns: string; value?: Record<string, unknown> }> } }
    }>
  }
  sessions: {
    create(payload: unknown): Promise<{ result: { ok: boolean; value?: { sessionId?: string } } }>
  }
}

/** Read the isolated root published by the host half. */
async function isolatedRoot(ctx: ClientContext): Promise<string | undefined> {
  const connection = ctx.get('connection') as { api: MenuApi } | undefined
  if (connection === undefined) return undefined
  const described = await connection.api.settings.describe({})
  if (!described.result.ok) return undefined
  const ns = described.result.value?.namespaces?.find(entry => entry.ns === SETTINGS_NS)
  const root = ns?.value?.isolatedRoot
  return typeof root === 'string' && root.length > 0 ? root : undefined
}

/** Create the read-only session through the official RPC and open it. */
async function startReadonlySession(ctx: ClientContext): Promise<void> {
  const connection = ctx.get('connection') as { api: MenuApi } | undefined
  const root = await isolatedRoot(ctx)
  if (connection === undefined || root === undefined) return
  const cwd = `${root.replace(/[\\/]+$/, '')}/session-${crypto.randomUUID()}`
  const created = await connection.api.sessions.create({ cwd, agentPreset: PRESET_ID })
  if (!created.result.ok) return
  const sessionId = created.result.value?.sessionId
  if (sessionId === undefined) return
  // The sessions face is declared through the runtime's cordis Context merge;
  // open() is its navigation entry point.
  ;(ctx as unknown as { sessions: { open(id: string): void } }).sessions.open(sessionId)
}

/**
 * Register the menu entry. If the picker patch is not applied (registry
 * absent), the plugin degrades silently to the `/readonly-session` command.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const registry = window.__DSH_WORKSPACE_PICKER_EXTRA_ITEMS__
  if (registry === undefined) return
  registry.push(() => ({
    id: '::no-workspace',
    label: 'No workspace (read-only session)',
    onPick: () => { void startReadonlySession(ctx) },
  }))
}
