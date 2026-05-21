// Swarm error taxonomy + central handler.
//
// Before this module, errors during a run were either swallowed in a
// try/catch (silent failure) or thrown out of an event listener (loud
// crash that bricked the orchestration). This file declares the kinds
// of failure we know about, what severity each carries, and a single
// `handle()` that decides the response: post to the channel, transition
// the run state, surface to the user pane. Callers don't make those
// decisions ad-hoc.

import { SwarmState } from './swarmStates.js';

export const SwarmErrorKind = Object.freeze({
  WORKER_STUCK:        'worker-stuck',
  WORKER_CRASHED:      'worker-crashed',
  CHANNEL_DOWN:        'channel-down',
  ORCHESTRATOR_SILENT: 'orchestrator-silent',
  PANE_CLOSED:         'pane-closed',
  DISK_ERROR:          'disk-error',
  NETWORK_DOWN:        'network-down',
  UNRECOVERABLE:       'unrecoverable',
  SUMMARY_INVALID:     'summary-invalid',
});

// severity:
//   'retry'    → log + nudge, keep running
//   'fail'     → transition FAILED + cancel channel
//   'cancel'   → transition CANCELLED + cancel channel (user-driven shape)
//   'escalate' → blocker to channel + leave run state alone (human decides)
const KIND_META = {
  [SwarmErrorKind.WORKER_STUCK]:        { severity: 'retry',    humanLabel: 'Worker stuck' },
  [SwarmErrorKind.WORKER_CRASHED]:      { severity: 'escalate', humanLabel: 'Worker crashed' },
  [SwarmErrorKind.CHANNEL_DOWN]:        { severity: 'fail',     humanLabel: 'Channel offline' },
  [SwarmErrorKind.ORCHESTRATOR_SILENT]: { severity: 'escalate', humanLabel: 'Orchestrator silent' },
  [SwarmErrorKind.PANE_CLOSED]:         { severity: 'escalate', humanLabel: 'Pane closed unexpectedly' },
  [SwarmErrorKind.DISK_ERROR]:          { severity: 'fail',     humanLabel: 'Disk write failed' },
  [SwarmErrorKind.NETWORK_DOWN]:        { severity: 'retry',    humanLabel: 'Network unreachable' },
  [SwarmErrorKind.UNRECOVERABLE]:       { severity: 'fail',     humanLabel: 'Unrecoverable error' },
  [SwarmErrorKind.SUMMARY_INVALID]:     { severity: 'retry',    humanLabel: 'Summary rejected — missing required fields' },
};

export function describeKind(kind) {
  return KIND_META[kind] || { severity: 'escalate', humanLabel: kind || 'unknown' };
}

// handle({ runId, kind, details, retries }, { swarmChannel, transition, audit })
//
// Returns { action, reason }. Caller is free to read the return value to
// decide whether to keep iterating (e.g. retry the post that triggered
// the error). All side effects (channel post, state transition, audit
// memory) happen inside this function.
export async function handle({ runId, kind, details, retries = 0 }, deps = {}) {
  const { swarmChannel, transition, audit } = deps;
  const meta = describeKind(kind);
  const reason = details?.reason || meta.humanLabel;

  // Best-effort audit. Never blocks the response.
  if (typeof audit === 'function') {
    try {
      await audit({
        title: `error ${kind} ${runId}`,
        payload: { event: 'error', runId, kind, severity: meta.severity, details, retries, at: new Date().toISOString() },
        tags: ['swarm', 'audit', `run:${runId}`, 'error', kind],
      });
    } catch (err) {
      console.error('[swarm:errors] audit failed:', err?.message || err);
    }
  }

  // Channel post — wrapped in try/catch because CHANNEL_DOWN means the
  // post itself will fail. We still attempt it for the other kinds.
  if (swarmChannel && typeof swarmChannel.post === 'function' && kind !== SwarmErrorKind.CHANNEL_DOWN) {
    try {
      if (meta.severity === 'cancel') {
        await swarmChannel.post({
          runId, workerId: 'system', kind: 'cancel',
          payload: { reason, errorKind: kind, details },
        });
      } else if (meta.severity === 'fail' || meta.severity === 'escalate' || meta.severity === 'retry') {
        await swarmChannel.post({
          runId, workerId: 'system', kind: 'blocker',
          payload: { reason, errorKind: kind, severity: meta.severity, details, retries },
        });
      }
    } catch (err) {
      console.error('[swarm:errors] channel post failed for', kind, ':', err?.message || err);
    }
  }

  // State transition — only for terminal severities. retry/escalate
  // leave the run state alone so the orchestrator can recover.
  if (typeof transition === 'function') {
    try {
      if (meta.severity === 'fail') {
        await transition({ runId, to: SwarmState.FAILED, reason, extra: { errorKind: kind, errorDetails: details } });
      } else if (meta.severity === 'cancel') {
        await transition({ runId, to: SwarmState.CANCELLED, reason, extra: { errorKind: kind, errorDetails: details } });
      }
    } catch (err) {
      console.error('[swarm:errors] transition failed for', kind, ':', err?.message || err);
    }
  }

  return { action: meta.severity, reason };
}
