// On-startup orphan recovery.
//
// If Electron crashes mid-run (or the user kills the process), runs
// stranded in non-terminal state never get their meta.json finalized —
// Swarm Runs UI then shows them as "Planning" forever. This module
// reconciles on each app boot: any run with a non-terminal status whose
// last update was >1h ago gets transitioned to CRASHED so the UI tells
// the truth. Recovery itself never throws — failures are logged.

import { SwarmState, TERMINAL_STATES } from './swarmStates.js';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1h

function pickTimestamp(meta) {
  // updatedAt is the canonical "last write" stamp from swarmTranscriptStore.
  // Fall back to startedAt + mtime (already on the row from listRuns).
  if (meta?.updatedAt) {
    const t = Date.parse(meta.updatedAt);
    if (!Number.isNaN(t)) return t;
  }
  if (meta?.lastTransitionAt) {
    const t = Date.parse(meta.lastTransitionAt);
    if (!Number.isNaN(t)) return t;
  }
  if (meta?.startedAt) {
    const t = Date.parse(meta.startedAt);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof meta?.mtime === 'number') return meta.mtime;
  return 0;
}

// recoverOrphans({ swarmChannel, transition, listRuns })
//
// Returns { scanned, recovered, errors } so callers can log a summary.
export async function recoverOrphans(deps = {}) {
  const { swarmChannel, transition, listRuns } = deps;
  const out = { scanned: 0, recovered: 0, errors: [] };

  if (typeof listRuns !== 'function') {
    console.warn('[swarm:recovery] listRuns not provided; skipping orphan scan');
    return out;
  }

  let rows;
  try { rows = listRuns(); }
  catch (err) {
    console.error('[swarm:recovery] listRuns threw:', err?.message || err);
    return out;
  }
  if (!Array.isArray(rows)) return out;

  const now = Date.now();
  for (const meta of rows) {
    out.scanned++;
    if (!meta?.runId) continue;
    const status = meta.status || null;
    if (status && TERMINAL_STATES.has(status)) continue;
    const ts = pickTimestamp(meta);
    if (!ts || (now - ts) < STALE_THRESHOLD_MS) continue;

    const reason = `orphan-recovery: last update ${new Date(ts).toISOString()} (${Math.round((now - ts) / 60000)}m ago)`;
    try {
      if (typeof transition === 'function') {
        await transition({
          runId: meta.runId,
          to: SwarmState.CRASHED,
          reason,
          extra: { recoveredAt: new Date().toISOString(), previousStatus: status },
        });
      }
      if (swarmChannel && typeof swarmChannel.post === 'function') {
        try {
          await swarmChannel.post({
            runId: meta.runId,
            workerId: 'system',
            kind: 'finish',
            payload: { crashed: true, reason, recoveredAt: new Date().toISOString() },
          });
        } catch (chErr) {
          // channel may be down on a cold boot — that's fine, the
          // meta.json transition is the durable record.
          console.warn('[swarm:recovery] channel post failed for', meta.runId, ':', chErr?.message || chErr);
        }
      }
      out.recovered++;
      console.log(`[swarm:recovery] marked ${meta.runId} CRASHED (was ${status || 'no-status'})`);
    } catch (err) {
      console.error('[swarm:recovery] transition failed for', meta.runId, ':', err?.message || err);
      out.errors.push({ runId: meta.runId, error: err?.message || String(err) });
    }
  }

  return out;
}
