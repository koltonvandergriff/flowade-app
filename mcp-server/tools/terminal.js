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
    content: [{ type: 'text', text: `terminal error: ${err.message || String(err)}` }],
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

const providerEnum = z.enum(['claude', 'codex', 'aider', 'shell']);
const ownerTypeEnum = z.enum(['user', 'orchestrator', 'agent']);
const teamIdEnum = z.enum(['A', 'B', 'C', 'D']);
const stateEnum = z.enum(['idle', 'busy', 'done', 'crashed']);

export function registerTerminalTools(mcpServer) {
  mcpServer.tool(
    'flowade_spawn_terminal',
    "Spawn a single terminal pane and optionally send an initial prompt. Low-level primitive — for spawning a coordinated swarm of workers use flowade_swarm_start instead (it adds the orchestrator and handles planning). Returns { terminalId, label }.",
    {
      provider: providerEnum,
      prompt: z.string(),
      workspace: z.string().optional(),
      sessionName: z.string().optional(),
      ownerType: ownerTypeEnum.optional(),
      teamId: teamIdEnum.optional(),
      spawnedBy: z.string().optional(),
    },
    async (input) => routed('terminal.spawn', input)
  );

  mcpServer.tool(
    'flowade_list_terminals',
    "List terminal panes with optional filters. Low-level inspector for the same pane registry that backs flowade_swarm_start — use that to launch a coordinated swarm. Returns [{ id, label, ownerType, teamId, state, provider, sessionName }].",
    {
      workspace: z.string().optional(),
      ownerType: ownerTypeEnum.optional(),
      state: stateEnum.optional(),
      teamId: teamIdEnum.optional(),
    },
    async (input) => routed('terminal.list', input)
  );

  mcpServer.tool(
    'flowade_send_to_terminal',
    "Write text to a pane's PTY. If submit=true, append a newline so the agent in the pane processes the input. Low-level pane I/O; for swarm orchestration use flowade_swarm_start which handles the +1 orchestrator and routing.",
    {
      terminalId: z.string(),
      text: z.string(),
      submit: z.boolean().optional(),
    },
    async (input) => routed('terminal.send', input)
  );

  mcpServer.tool(
    'flowade_read_terminal',
    "Tail recent PTY output from a pane since a token id. Low-level pane read; flowade_swarm_start manages the +1 orchestrator and aggregates output for you. Returns { chunks, tokenId, dropped, state }.",
    {
      terminalId: z.string(),
      sinceTokenId: z.number().int().nonnegative().optional(),
      maxBytes: z.number().int().positive().optional(),
    },
    async (input) => routed('terminal.read', input)
  );

  mcpServer.tool(
    'flowade_wait_terminal',
    "Long-poll until the pane reaches the requested state or timeout. Low-level pane sync; use flowade_swarm_start for full swarm orchestration which adds the +1 orchestrator. Returns { state, tokenId, timedOut }.",
    {
      terminalId: z.string(),
      untilState: z.enum(['done', 'idle', 'crashed']),
      timeoutMs: z.number().int().positive().optional(),
    },
    async (input) => routed('terminal.wait', { ...input, timeoutMs: input.timeoutMs ?? 60000 })
  );

  mcpServer.tool(
    'flowade_kill_terminal',
    "Terminate a pane's PTY and remove it from the registry. Low-level pane shutdown; flowade_swarm_start handles tearing down whole swarms including the +1 orchestrator. Returns { ok }.",
    {
      terminalId: z.string(),
    },
    async (input) => routed('terminal.kill', input)
  );
}
