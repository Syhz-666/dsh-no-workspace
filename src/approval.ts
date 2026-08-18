/**
 * The per-call approval gate for absolute-path file access in a read-only
 * session. Mirrors the upstream escalation choreography's fail-closed
 * ordering: a missing approval service, an agent-less call, a rejection, a
 * cancellation, or an unanswerable ask all throw before anything is read.
 * @module dsh-no-workspace/approval
 */

import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Whether one file-access call must pass the approval gate. Absolute paths
 * always gate. Relative resolution is approval-free only when the session
 * directory exists and sits inside the isolated root (the empty
 * session-owned tree); anywhere else — a user-chosen workspace, or a session
 * without a directory — the call gates. A missing isolated-root setting
 * fails closed (relative access gates too).
 * @param cwd - the session's cwd (its header value, possibly undefined).
 * @param isolatedRoot - the configured isolation root, or undefined when the
 * settings read is unavailable.
 * @returns true when the call must be approved first.
 */
export function relativeReadGated(cwd: string | undefined, isolatedRoot: string | undefined): boolean {
  if (cwd === undefined) return true
  if (isolatedRoot === undefined) return true
  if (cwd === isolatedRoot) return false
  return !cwd.startsWith(`${isolatedRoot}${sep}`)
}

/**
 * Ask the human to allow one absolute-path file access before anything
 * executes.
 * @param ctx - the plugin context; the optional `approval` service is read per call.
 * @param exec - the tool-execution context (agent, callId, signal).
 * @param toolName - the tool name, for the approval audit trail.
 * @param target - the raw path, shown in the ask's reason.
 */
export async function requireReadApproval(ctx: Context, exec: ToolExecution, toolName: string, target: string): Promise<void> {
  const approval = ctx.get('approval')
  if (approval === undefined) {
    throw new Error('this read requires approval, but no approval service is composed')
  }
  if (exec.agent === undefined) {
    throw new Error('this read requires approval, but the call has no agent to route it through')
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    callId: exec.callId,
    reason: `read ${target}: this read-only session requires explicit user approval for absolute-path access`,
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw new Error('the user rejected this filesystem read')
  }
}
