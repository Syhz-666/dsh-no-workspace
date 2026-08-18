/**
 * dsh-no-workspace host plugin: the "read-only session" entry point. Owns the
 * isolated directory, the `/readonly-session` command, the preset install
 * into the user roster (visible in every picker), the settings namespace
 * exposing the isolated root, and the structural lock that makes a
 * no-workspace session permanently read-only. The read-only tool set
 * registers through the preset row (`./tools` subpath), so it lands in the
 * preset's scope layer.
 * @module dsh-no-workspace
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pull the ctx merges for the services this plugin consumes.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

// The published 0.1.0-rc.7 typings predate the upstream `agent-preset/selected`
// event declaration; the running host (built from source) emits it. Declaring
// it here mirrors the upstream declaration exactly, so the listener types.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

/** The preset id this plugin installs and locks sessions to. */
export const PRESET_ID = 'no-workspace'

/** Settings namespace carrying the isolated root to consumers. */
export const SETTINGS_NS = settingsNamespace('dsh-no-workspace')

/** Plugin config: deployment overrides for the isolation root and defaults. */
export interface Config {
  /** Isolated directory root; defaults to `$DSH_HOME/.dsh-no-workspace`. */
  isolatedRoot?: string
  /** Default model for created sessions; defaults to deepseek-v4-flash + low effort. */
  defaultModel?: {
    provider?: string
    model?: string
    reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  }
}

export const Config: z<Config> = z.object({
  isolatedRoot: z.string(),
  defaultModel: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.union(['off', 'low', 'high', 'max'] as const),
  }),
})

/** The plugin's own preset directory inside this package (presets/<id>/). */
const PRESET_SOURCE = fileURLToPath(new URL('../presets/no-workspace', import.meta.url))

/** Whether a directory exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Install the preset into the user roster root (`$DSH_HOME/.agent-presets`),
 * idempotently. The user root is scanned by the default `includeUserRoot`
 * roster configuration, so the preset becomes mountable without touching the
 * deployment's own preset directories or the roster config. An existing
 * directory is never overwritten — a user edit wins.
 * @param ctx - plugin context (for the home path capability).
 */
async function installPreset(ctx: Context): Promise<void> {
  const target = join(dshHomePath('.agent-presets', PRESET_ID))
  if (await exists(target)) return
  await mkdir(dshHomePath('.agent-presets'), { recursive: true })
  await cp(PRESET_SOURCE, target, { recursive: true })
}

/**
 * Create one read-only session: an isolated empty directory as its cwd, the
 * `no-workspace` preset mounted, the low-effort model default, the
 * read-only/ask permission stance seeded, and a zero-length turn pair that
 * makes the session permanently non-blank — the upstream preset-switch lock
 * (`agent-preset-locked`) then refuses every later composition change.
 * @param ctx - plugin context.
 * @param isolatedRoot - the isolation root directory.
 * @param model - the model default (provider/model/effort).
 * @param sessionId - optional preallocated id.
 * @returns the created session.
 */
export async function createReadonlySession(
  ctx: Context,
  isolatedRoot: string,
  model: NonNullable<Config['defaultModel']>,
  sessionId?: SessionId,
): Promise<import('@deepseek-ai/dsh-session').Session> {
  await mkdir(isolatedRoot, { recursive: true })
  const id = sessionId ?? (`session-${randomUUID()}` as SessionId)
  const cwd = join(isolatedRoot, id)
  await mkdir(cwd, { recursive: true })
  const handle = await ctx.agents.create({
    sessionId: id,
    meta: { cwd, agentPreset: PRESET_ID },
    agentOptions: {
      provider: model.provider ?? 'deepseek-official',
      model: model.model ?? 'deepseek-v4-flash',
      ...(model.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: model.reasoningEffort as never }),
    },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, PRESET_ID).then(() => undefined),
  })
  // The lock and the permission seeds are applied by the session/created
  // listener (see apply), so every creation path — this command AND the
  // workspace-picker menu's direct RPC create — is covered identically.
  return handle.agent.session
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-no-workspace'

/** Services required by the host plugin. */
export const inject = ['commands', 'agents', 'sessions', 'agentPresets', 'settings']

/**
 * Apply the read-only lock and permission seeds to one no-workspace session.
 * The zero-length turn pair makes the session permanently non-blank, so the
 * upstream switch guard refuses any preset change — the read-only tool
 * surface is structurally fixed from birth. The knobs remain switchable, but
 * no mutating tool exists to consume a wider sandbox mode, so a switch has no
 * effect. Idempotent: a session already carrying a turn is left untouched.
 * The preset is read from the LOG, not the header: a session switched to this
 * preset while blank (via the picker) has a different creation-time header.
 * @param session - the session to lock; only `no-workspace` sessions are touched.
 */
export function lockReadonlySession(session: import('@deepseek-ai/dsh-session').Session): void {
  if (resolveSessionPreset(session) !== PRESET_ID) return
  if (session.events.some(event => event.type === 'turn/start')) return
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  setSandboxMode(session, 'read-only')
  setApprovalPolicy(session, 'ask')
}

/**
 * Mount the host plugin: preset install, roster hide, settings namespace,
 * and the `/readonly-session` command.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const isolatedRoot = config.isolatedRoot || dshHomePath('.dsh-no-workspace')
  const defaultModel = config.defaultModel ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }

  // The preset install has nothing to undo; the disposer is the empty function.
  ctx.effect(() => {
    void installPreset(ctx)
    return () => {}
  }, 'dsh-no-workspace: preset install into the user roster')

  // The isolated root is published for consumers (the tool set reads it to
  // decide which relative reads may skip approval).
  const settingsSchema: z<{ isolatedRoot: string }> = z.object({ isolatedRoot: z.string().required() })
  installSettingsSection(ctx, SETTINGS_NS, settingsSchema, { isolatedRoot }, {
    setSource: () => {},
    onChange: () => {},
  })

  // Every no-workspace session gets the lock and the permission seeds at
  // publication, whichever path created it: this command, a direct RPC create,
  // or a later resume.
  ctx.on('session/created', (session) => {
    lockReadonlySession(session)
  })

  // A session switched to this preset while blank (picker) locks the same way:
  // the zero-length turn pair lands immediately, so the upstream switch guard
  // refuses every later composition change. The event fires synchronously
  // inside the session/event publication of the selection itself — appending
  // the turn pair right there would reenter the store's append — so the lock
  // is deferred one microtask, after the publication closes.
  ctx.on('agent-preset/selected', (sessionId, agentPreset) => {
    if (agentPreset !== PRESET_ID) return
    queueMicrotask(() => {
      const session = ctx.sessions.get(sessionId)
      if (session === undefined) return
      lockReadonlySession(session)
    })
  })

  ctx.commands.register({
    name: 'readonly-session',
    description: 'Start a read-only session without choosing a workspace',
    handler: async ({ agent }) => {
      void agent
      try {
        const session = await createReadonlySession(ctx, isolatedRoot, defaultModel)
        return { kind: 'success', text: `created read-only session ${session.id}` }
      } catch (error: unknown) {
        return { kind: 'error', text: `failed to create read-only session: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}
