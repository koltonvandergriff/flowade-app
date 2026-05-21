import { z } from 'zod';
import { swarmClient } from '../swarmClient.js';

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
    content: [{ type: 'text', text: `channel error: ${err.message || String(err)}` }],
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

const kindEnum = z.enum([
  'plan', 'intent', 'claim', 'progress', 'blocker',
  'diff', 'done', 'review-fail', 'cancel', 'finish',
]);

export function registerChannelTools(mcpServer) {
  mcpServer.tool(
    'flowade_swarm_post',
    "Append an event to a swarm run's shared channel. Used by workers to broadcast intent/progress/blockers and by the orchestrator to publish plans, reviews, and the final summary. Kinds: plan, intent, claim, progress, blocker, diff, done, review-fail, cancel, finish.",
    {
      runId: z.string(),
      workerId: z.string(),
      kind: kindEnum,
      payload: z.object({}).passthrough().optional(),
    },
    async (input) => routed('channel.post', input)
  );

  mcpServer.tool(
    'flowade_swarm_read',
    "Tail a swarm run's shared channel since a token id. Returns { events, latestTokenId }. Use this in the user-pane agent to relay live progress, and in workers to read what siblings are doing before nontrivial steps.",
    {
      runId: z.string(),
      sinceTokenId: z.number().int().nonnegative().optional(),
      kinds: z.array(z.string()).optional(),
      limit: z.number().int().positive().optional(),
    },
    async (input) => routed('channel.read', input)
  );
}
