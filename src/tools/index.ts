/**
 * The preset-row entry for the read-only tool set: registers `read`, `glob`,
 * and `grep` into the preset's scope layer, plus the model-facing guidance
 * section. Mounted by the `no-workspace` preset via the `dsh-no-workspace/tools`
 * subpath, so these tools exist only for sessions on that preset — the
 * official `dsh-tool-fs` (read/write/edit) and shell tools are never mounted.
 * @module dsh-no-workspace/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-fs'
import { applyReadTool } from './read.ts'
import { applyGlobTool } from './glob.ts'
import { applyGrepTool } from './grep.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-no-workspace/tools'

/** Services required by the read-only tool set. */
export const inject = ['tools', 'systemPrompt', 'fs']

/**
 * Register the read-only tools and their guidance section.
 * @param ctx - the preset-scoped plugin context.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:no-workspace-read',
    order: 100,
    text: 'This session is read-only: use the read/glob/grep tools for files. '
      + 'Relative paths resolve inside the session\'s isolated directory; absolute paths require user approval before every read.',
  })
  applyReadTool(ctx)
  applyGlobTool(ctx)
  applyGrepTool(ctx)
}
