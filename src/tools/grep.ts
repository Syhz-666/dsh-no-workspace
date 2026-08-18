/**
 * The read-only `grep` tool over the packaged ripgrep binary, reusing the
 * upstream `dsh-tool-fs-search` command builders, parser, and runner.
 * Relative targets resolve inside the session's isolated directory; absolute
 * targets require explicit per-call user approval.
 * @module dsh-no-workspace/tools/grep
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildGrepCommand,
  formatGrepMatches,
  parseGrepArgs,
  parseGrepMatches,
  runRipgrep,
  toWorkdirRelative,
} from '@deepseek-ai/dsh-tool-fs-search'
import { requireReadApproval } from '../approval.ts'

const RAW_OUTPUT_MAX_BYTES = 20_000_000
const GRACE_MS = 3000
const STDERR_MAX_BYTES = 65_536

/**
 * Register the `grep` tool into the current scope (the preset's layer).
 * @param ctx - the preset-scoped plugin context; execution uses the `subprocess` seam.
 */
export function applyGrepTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'grep',
    description: 'Search file contents with a regular expression. '
      + 'Relative paths resolve inside this session\'s isolated directory; absolute targets require explicit user approval.',
    parameters: {
      pattern: { type: 'string', required: true, description: 'Ripgrep regular expression to match.' },
      path: { type: 'string', description: 'File or directory to search. Defaults to the session\'s isolated directory; a relative path resolves against it.' },
      include: { type: 'string', description: 'One positive glob filter (e.g. "*.ts"); comma-separated lists and negated values are rejected.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, lineNumber: { type: 'integer', required: true }, line: { type: 'string', required: true } } } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatGrepMatches(value.matches) }],
    },
    async execute(args, exec) {
      const input = parseGrepArgs(args)
      if (input.path !== undefined && isAbsolute(input.path)) {
        await requireReadApproval(ctx, exec, 'grep', input.path)
      }
      const run = await runRipgrep(ctx, exec, 'grep', buildGrepCommand(input), RAW_OUTPUT_MAX_BYTES, GRACE_MS, STDERR_MAX_BYTES)
      if (run.noMatches) return { matches: [] }
      const matches = parseGrepMatches(run.stdout)
      return {
        matches: matches.map(match => ({
          ...match,
          path: toWorkdirRelative(match.path, run.workdir),
        })),
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Grep ${args.pattern}${args.path === undefined ? '' : ` in ${args.path}`}`, kind: 'search' }
    },
  }))
}
