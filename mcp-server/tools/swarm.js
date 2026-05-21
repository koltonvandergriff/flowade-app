import { z } from 'zod';
import { swarmClient } from '../swarmClient.js';

// Map swarmClient.call rejections into MCP error results. SWARM_UNAVAILABLE
// errors get a user-facing hint pointing at the Settings → Integrations toggle
// so the LLM tells the user how to fix it instead of just bailing.
function unavailableResult(err) {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Swarm bridge unavailable: ${err.message}. Make sure FlowADE is running with 'Allow agent spawn' enabled in Settings → Integrations.`,
    }],
  };
}

function errorResult(err) {
  return {
    isError: true,
    content: [{ type: 'text', text: `swarm error: ${err.message || String(err)}` }],
  };
}

function okResult(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

async function routed(method, params) {
  try {
    const result = await swarmClient.call(method, params);
    return okResult(result);
  } catch (err) {
    if (err && err.code === 'SWARM_UNAVAILABLE') return unavailableResult(err);
    return errorResult(err);
  }
}

const providerEnum = z.enum(['claude', 'codex', 'aider']);
const teamIdEnum = z.enum(['A', 'B', 'C', 'D']);
const decisionEnum = z.enum(['yes', 'edit', 'cancel']);

export function registerSwarmTools(server) {
  server.tool(
    'flowade_swarm_start',
    [
      'Launch a swarm of worker agents to accomplish a task in parallel.',
      'Use when the user says "launch N agents to X", "spawn N agents for X",',
      '"get N agents on X", or similar. workerCount = the count the user said —',
      'the orchestrator is added automatically by this tool, DO NOT include it',
      'in workerCount. If the user did not specify a count or a task, ask them',
      'for the missing piece before calling this tool.',
      'Returns { runId, teamId, orchestratorTerminalId, workerTerminalIds }.',
    ].join(' '),
    {
      task: z.string().min(1),
      workerCount: z.number().int().min(1).max(14),
      workspace: z.string().optional(),
      provider: providerEnum.default('claude'),
      teamId: teamIdEnum.optional(),
    },
    async (input) => routed('swarm.start', input)
  );

  server.tool(
    'flowade_swarm_finish',
    [
      "Mark a swarm run as completed and post the orchestrator's final summary",
      'to the originating user pane. Called by the orchestrator after all',
      'workers complete and the merge passes smoke. Returns { ok }.',
    ].join(' '),
    {
      runId: z.string(),
      summary: z.string(),
      durationMs: z.number().optional(),
    },
    async (input) => routed('swarm.finish', input)
  );

  server.tool(
    'flowade_swarm_confirm',
    [
      "Relay the user's plan-confirmation decision to the orchestrator after",
      'it has posted its plan to the channel (kind=plan, status=awaiting-confirm).',
      'Call this on "yes" / "confirm" / "go ahead" (decision=\'yes\'), on requested',
      'edits (decision=\'edit\' with notes describing changes), or on "cancel"',
      "(decision='cancel'). Returns { ok }.",
    ].join(' '),
    {
      runId: z.string(),
      decision: decisionEnum,
      notes: z.string().optional(),
    },
    async (input) => routed('swarm.confirm', input)
  );

  server.tool(
    'flowade_swarm_cancel',
    [
      'Cancel a swarm run. Kills all team panes except the user pane, releases',
      'all leases held by this run, and posts a cancellation summary. Use when',
      'the user says "cancel", "kill it", "stop the swarm", etc. Returns { ok,',
      'killedTerminalIds, releasedLeases }.',
    ].join(' '),
    {
      runId: z.string(),
      reason: z.string().optional(),
    },
    async (input) => routed('swarm.cancel', input)
  );
}
