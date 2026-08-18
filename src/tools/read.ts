/**
 * The read-only `read` tool. Relative paths resolve inside the session's
 * isolated directory (no approval needed — the directory is empty and
 * session-owned) when the session directory actually sits inside the
 * isolated root; absolute paths — and relative reads from any other
 * directory — require explicit per-call user approval.
 * @module dsh-no-workspace/tools/read
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { relativeReadGated, requireReadApproval } from '../approval.ts'

const DEFAULT_LIMIT = 2000

/** Resolve options for one read: session cwd for relative paths, none for absolute. */
function resolveOptions(cwd: string | undefined, filePath: string, signal: AbortSignal): { cwd?: string; signal: AbortSignal } {
  return isAbsolute(filePath) ? { signal } : { cwd, signal }
}

/**
 * Register the `read` tool into the current scope (the preset's layer).
 * @param ctx - the preset-scoped plugin context; execution uses its `fs` service.
 * @param isolatedRoot - the isolation root, read from settings at apply time
 * (undefined fails closed: relative reads gate too).
 */
export function applyReadTool(ctx: Context, isolatedRoot: string | undefined): void {
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content. '
      + 'Relative paths resolve inside this session\'s isolated directory; absolute paths require explicit user approval.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read. Relative paths resolve against the session\'s isolated directory.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${DEFAULT_LIMIT}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n${value.lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n</content>`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
      const cwd = exec.agent?.session.header.cwd
      if (isAbsolute(args.file_path)) {
        // The approval gate runs before any resolution or I/O.
        await requireReadApproval(ctx, exec, 'read', args.file_path)
      } else {
        // Relative resolution needs a real session directory to resolve
        // against; without one the call cannot run safely at all.
        if (cwd === undefined) throw new Error('this session has no isolated directory')
        if (relativeReadGated(cwd, isolatedRoot)) {
          await requireReadApproval(ctx, exec, 'read', args.file_path)
        }
      }
      const target = await ctx.fs.resolve(args.file_path, resolveOptions(cwd, args.file_path, exec.signal))
      const info = await ctx.fs.stat(target)
      if (info === undefined) throw new Error(`file not found: ${target.displayPath}`)
      if (info.type !== 'file') throw new Error(`not a regular file: ${target.displayPath}`)
      const content = await ctx.fs.readText(target, exec.signal)
      const offset = Math.max(1, Math.floor(args.offset ?? 1))
      const limit = Math.min(Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT)), DEFAULT_LIMIT)
      const all = content.split('\n')
      const lines = all.slice(offset - 1, offset - 1 + limit).map((text, index) => ({ number: offset + index, text }))
      return { path: target.displayPath, offset, lines, totalLines: all.length }
    },
    presentCall(args) {
      return { card: 'generic', title: `Read ${args.file_path}`, kind: 'read' }
    },
  }))
}
