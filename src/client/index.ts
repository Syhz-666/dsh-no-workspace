/**
 * Browser half of dsh-no-workspace: registers the "不使用工作区（只读会话）"
 * entry into the workspace-picker menu through the registry the host half
 * injects into the official picker bundle at serve time (see
 * ../picker-inject.ts — nothing is written to the official bundle). The pick
 * reads the isolated root from the `dsh-no-workspace` settings namespace,
 * creates the session through the official RPC (with the preset), waits for
 * the host's `session-added` frame to land the new session in the client
 * list, and opens it.
 * @module dsh-no-workspace/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The workspace-picker menu registry contract shared with src/picker-inject.ts:
 * an array of factories; each result is one extra menu entry. The host
 * injection initializes the array and merges the entries into the picker
 * menu.
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

/** The preset id the create RPC must name. */
const PRESET_ID = 'no-workspace'

/** How long to wait for the host's session-added frame before giving up on the auto-open. */
const LIST_WAIT_MS = 3000

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

/** The sessions face the runtime injects as `ctx.sessions` (narrow read face). */
interface SessionsFace {
  list: { getSnapshot(): { ids: string[] } }
  open(id: string): void
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

/**
 * Wait until the new session id appears in the client session list. The bare
 * create RPC does not merge the summary locally; the host's `session-added`
 * frame does (host/events stream). Opening before that frame lands would
 * throw "unknown session" and the click would appear dead.
 * @param sessions - the sessions face.
 * @param sessionId - the just-created session id.
 * @returns true when the session became addressable in time.
 */
async function waitForSessionListed(sessions: SessionsFace, sessionId: string): Promise<boolean> {
  const deadline = Date.now() + LIST_WAIT_MS
  for (;;) {
    if (sessions.list.getSnapshot().ids.includes(sessionId)) return true
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * Create the read-only session and open it. The creation names the preset
 * directly, so the host half's creation-path lock fixes it read-only from
 * birth; the auto-open waits for the session-added frame so the follow-up
 * `open()` can address the session. A wait timeout still leaves the session
 * created and listed — the user can open it manually.
 * @param ctx - client root context.
 */
async function startReadonlySession(ctx: ClientContext): Promise<void> {
  const connection = ctx.get('connection') as { api: MenuApi } | undefined
  const root = await isolatedRoot(ctx)
  if (connection === undefined || root === undefined) return
  const sessions = (ctx as unknown as { sessions: SessionsFace }).sessions
  const cwd = `${root.replace(/[\\/]+$/, '')}/session-${crypto.randomUUID()}`
  const created = await connection.api.sessions.create({ cwd, agentPreset: PRESET_ID })
  if (!created.result.ok) return
  const sessionId = created.result.value?.sessionId
  if (sessionId === undefined) return
  if (await waitForSessionListed(sessions, sessionId)) sessions.open(sessionId)
}

/**
 * Register the menu entry. If the host injection is absent (bundle anchors
 * changed, non-web surface), the plugin degrades silently to the visible
 * preset and the `/readonly-session` command.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const registry = window.__DSH_WORKSPACE_PICKER_EXTRA_ITEMS__
  if (registry === undefined) return
  registry.push(() => ({
    id: '::no-workspace',
    label: '不使用工作区（只读会话）',
    onPick: () => { void startReadonlySession(ctx) },
  }))
}
