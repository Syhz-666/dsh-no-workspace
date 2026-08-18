/**
 * The per-call approval gate for absolute-path file access in a read-only
 * session. Mirrors the upstream escalation choreography's fail-closed
 * ordering: a missing approval service, an agent-less call, a rejection, a
 * cancellation, or an unanswerable ask all throw before anything is read.
 * @module dsh-no-workspace/approval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

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
