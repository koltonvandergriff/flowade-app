import { z } from 'zod';
import { swarmClient } from '../swarmClient.js';

function asText(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function asError(obj) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

async function callBridge(method, params) {
  try {
    const result = await swarmClient.call(method, params);
    return asText(result);
  } catch (err) {
    if (err && err.code === 'SWARM_UNAVAILABLE') {
      return asError({ error: 'swarm bridge unavailable', detail: err.message });
    }
    return asError({ error: err && err.message ? err.message : String(err) });
  }
}

function registerLeaseTools(mcpServer) {
  mcpServer.tool(
    'flowade_claim_file',
    'Acquire an exclusive write lease on a file for the duration of a swarm run. Returns { ok, renewed, expiresAt } on success, or { ok:false, conflict:{ runId, workerId, isCrossRun } } if held by another worker.',
    {
      runId: z.string().describe('Swarm run identifier'),
      workerId: z.string().describe('Worker identifier within the run'),
      path: z.string().describe('Absolute file path to lock'),
      ttlMs: z.number().int().positive().optional().describe('Lease lifetime in ms (clamped 30_000..1_800_000)'),
    },
    async (input) => callBridge('lease.claim', input)
  );

  mcpServer.tool(
    'flowade_release_file',
    'Release a previously-claimed write lease.',
    {
      runId: z.string(),
      workerId: z.string(),
      path: z.string(),
    },
    async (input) => callBridge('lease.release', input)
  );

  mcpServer.tool(
    'flowade_list_leases',
    'Snapshot the lease registry, optionally filtered by path / runId / workerId.',
    {
      path: z.string().optional(),
      runId: z.string().optional(),
      workerId: z.string().optional(),
      excludeExpired: z.boolean().optional(),
    },
    async (input) => callBridge('lease.list', input)
  );

  mcpServer.tool(
    'flowade_validate_plan',
    "Validate a swarm plan's file partitioning and dependency graph. Rejects plans with overlapping expectedFiles between workers. Returns { ok, parallelismFactor, waves, filesPerWorker } on success or { ok:false, overlap:{ path, workers } } / { ok:false, error } on rejection.",
    {
      subtasks: z.array(z.object({
        workerId: z.string(),
        expectedFiles: z.array(z.string()),
        dependsOn: z.array(z.string()).optional(),
      })),
    },
    async (input) => callBridge('lease.validatePlan', input)
  );
}

export { registerLeaseTools };
