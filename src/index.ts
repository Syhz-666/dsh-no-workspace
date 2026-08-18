/**
 * dsh-no-workspace host plugin: the "start a read-only session without
 * choosing a workspace" entry point. Owns the isolated directory, the
 * `/readonly-session` command, the preset install into the user roster, the
 * roster-hide decoration, and the settings namespace exposing the isolated
 * root to the browser half. The read-only tool set registers through the
 * preset row (`./tools` subpath), so it lands in the preset's scope layer.
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
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { installHide } from './hide.ts'

/** The preset id this plugin installs and locks sessions to. */
export const PRESET_ID = 'no-workspace'

/** Settings namespace carrying the isolated root to the browser half. */
export const SETTINGS_NS = settingsNamespace('dsh-no-workspace')

/** Plugin config: deployment overrides for the isolation root and defaults. */
export interface Config {
  /** Isolated directory root; defaults to `$DSH_HOME/.dsh-no-workspace`. */
  isolatedRoot?: string
  /** Roster ids hidden from pickers; defaults to this plugin's own preset id. */
  hiddenPresets?: string[]
  /** Default model for created sessions; defaults to deepseek-v4-flash + low effort. */
  defaultModel?: {
    provider?: string
    model?: string
    reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  }
}

export const Config: z<Config> = z.object({
  isolatedRoot: z.string(),
  hiddenPresets: z.array(String),
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
  const agent = await ctx.agents.create({
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
  // Lock the composition: a closed zero-length turn makes the session
  // non-blank, so the upstream switch guard permanently refuses any preset
  // change — the read-only tool surface is structurally fixed from birth.
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  // Permission stance: read-only + interactive approval (fail-closed without
  // an answerer). The knobs remain switchable, but no mutating tool exists to
  // consume a wider sandbox mode, so a switch has no effect.
  setSandboxMode(agent.session, 'read-only')
  setApprovalPolicy(agent.session, 'ask')
  return agent.session
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-no-workspace'

/** Services required by the host plugin. */
export const inject = ['commands', 'agents', 'sessions', 'agentPresets', 'settings']

/**
 * Mount the host plugin: preset install, roster hide, settings namespace,
 * and the `/readonly-session` command.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const isolatedRoot = config.isolatedRoot ?? dshHomePath('.dsh-no-workspace')
  const hiddenPresets = config.hiddenPresets ?? [PRESET_ID]
  const defaultModel = config.defaultModel ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }

  ctx.effect(() => {
    void installPreset(ctx)
  }, 'dsh-no-workspace: preset install into the user roster')

  // The roster-hide decoration: pickers and settings see the hidden preset
  // ids removed, while resolve/mount keep serving them (session resume and
  // the command's own create depend on that). Disposal restores the original
  // method, so unloading the plugin undoes the decoration completely.
  ctx.effect(() => installHide(ctx, hiddenPresets), 'dsh-no-workspace: roster hide decoration')

  // The isolated root is a browser-visible fact: the workspace-picker menu
  // entry needs it to issue the create RPC itself.
  const settingsSchema: z<{ isolatedRoot: string }> = z.object({ isolatedRoot: z.string().required() })
  installSettingsSection(ctx, SETTINGS_NS, settingsSchema, { isolatedRoot }, {
    setSource: () => {},
    onChange: () => {},
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
