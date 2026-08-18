/**
 * The read-only `glob` tool over the packaged ripgrep binary, reusing the
 * upstream `dsh-tool-fs-search` command builders and runner. Relative roots
 * resolve inside the session's isolated directory; absolute roots require
 * explicit per-call user approval.
 * @module dsh-no-workspace/tools/glob
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildGlobCommand,
  parseGlobArgs,
  runRipgrep,
  toWorkdirRelative,
} from '@deepseek-ai/dsh-tool-fs-search'
import { requireReadApproval } from '../approval.ts'

const RAW_OUTPUT_MAX_BYTES = 20_000_000
const GRACE_MS = 3000
const STDERR_MAX_BYTES = 65_536

/**
 * Register the `glob` tool into the current scope (the preset's layer).
 * @param ctx - the preset-scoped plugin context; execution uses the `subprocess` seam.
 */
export function applyGlobTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'glob',
    description: 'Find files whose paths match a glob pattern. Returns matching file paths — never directories. '
      + 'Relative paths resolve inside this session\'s isolated directory; absolute roots require explicit user approval.',
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js"). '
          + 'A pattern with no "/" matches the basename at any depth, so "*" and "*.ts" both search the whole tree; include a separator to anchor the depth.',
      },
      path: { type: 'string', description: 'Directory to search in. Defaults to the session\'s isolated directory; a relative path resolves against it.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.paths.length === 0 ? 'No files found.' : value.paths.join('\n') }],
    },
    async execute(args, exec) {
      const input = parseGlobArgs(args)
      if (input.path !== undefined && isAbsolute(input.path)) {
        await requireReadApproval(ctx, exec, 'glob', input.path)
      }
      const run = await runRipgrep(ctx, exec, 'glob', buildGlobCommand(input), RAW_OUTPUT_MAX_BYTES, GRACE_MS, STDERR_MAX_BYTES)
      const root = input.path === undefined ? '.' : toWorkdirRelative(input.path, run.workdir)
      if (run.noMatches) return { root, paths: [] }
      const paths: string[] = []
      for (const line of run.stdout.split('\n')) {
        if (line.length === 0) continue
        paths.push(toWorkdirRelative(line, run.workdir))
      }
      return { root, paths }
    },
    presentCall(args) {
      return { card: 'generic', title: `Glob ${args.pattern}${args.path === undefined ? '' : ` in ${args.path}`}`, kind: 'search' }
    },
  }))
}
