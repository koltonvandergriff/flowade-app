// Swarm lifecycle state machine.
//
// Before this module, status was an ad-hoc string written into meta.json
// at five different sites in swarmOrchestration.js — there was no
// authoritative list of states and no guard against illegal transitions
// (e.g. DONE → PLANNING). This file defines the canonical states + the
// legal edges, and a single `transition()` helper that orchestration
// code calls instead of writing the status field directly.
//
// Illegal transitions are warned + allowed so a model glitch can't brick
// a run in production. Audit entry is best-effort, never blocks.

export const SwarmState = Object.freeze({
  CREATED:            'created',
  PLANNING:           'planning',
  AWAITING_CONFIRM:   'awaiting-confirm',
  DISPATCHING:        'dispatching',
  WORKING:            'working',
  REVIEWING:          'reviewing',
  SUMMARIZING:        'summarizing',
  DONE:               'done',
  DONE_WITH_WARNINGS: 'done-with-warnings',
  CANCELLED:          'cancelled',
  FAILED:             'failed',
  CRASHED:            'crashed',
});

export const TERMINAL_STATES = new Set([
  SwarmState.DONE,
  SwarmState.DONE_WITH_WARNINGS,
  SwarmState.CANCELLED,
  SwarmState.FAILED,
  SwarmState.CRASHED,
]);

// validTransitions[from] = Set of allowed `to` states. Every terminal
// state is reachable from every non-terminal one (cancel/fail/crash can
// happen any time), so we encode the forward "happy path" edges and add
// the universal exits.
const HAPPY_PATH = {
  [SwarmState.CREATED]:          [SwarmState.AWAITING_CONFIRM, SwarmState.PLANNING],
  [SwarmState.AWAITING_CONFIRM]: [SwarmState.PLANNING],
  [SwarmState.PLANNING]:         [SwarmState.DISPATCHING],
  [SwarmState.DISPATCHING]:      [SwarmState.WORKING],
  [SwarmState.WORKING]:          [SwarmState.REVIEWING, SwarmState.SUMMARIZING],
  [SwarmState.REVIEWING]:        [SwarmState.WORKING, SwarmState.SUMMARIZING],
  [SwarmState.SUMMARIZING]:      [SwarmState.DONE, SwarmState.DONE_WITH_WARNINGS],
};

const UNIVERSAL_EXITS = [
  SwarmState.CANCELLED,
  SwarmState.FAILED,
  SwarmState.CRASHED,
];

export const validTransitions = (() => {
  const out = {};
  for (const state of Object.values(SwarmState)) {
    if (TERMINAL_STATES.has(state)) {
      out[state] = new Set();
    } else {
      out[state] = new Set([...(HAPPY_PATH[state] || []), ...UNIVERSAL_EXITS]);
    }
  }
  return out;
})();

function isLegal(from, to) {
  if (!from) return true; // first transition into a state is always legal
  const allowed = validTransitions[from];
  return allowed ? allowed.has(to) : true;
}

// transition({ runId, to, reason, extra }, { writeRunMeta, audit, getCurrentState })
//
// - writeRunMeta(runId, partial): persists state + extras to meta.json.
// - audit({ title, payload, tags }): best-effort memory entry; never throws.
// - getCurrentState(runId): optional. If provided, used to detect illegal
//   edges and emit a warning before applying.
//
// Returns the merged meta partial that was written.
export async function transition({ runId, to, reason, extra }, deps = {}) {
  const { writeRunMeta, audit, getCurrentState } = deps;
  if (!runId) throw new Error('transition: runId required');
  if (!to || !Object.values(SwarmState).includes(to)) {
    throw new Error(`transition: invalid target state "${to}"`);
  }

  let from = null;
  if (typeof getCurrentState === 'function') {
    try { from = getCurrentState(runId) || null; } catch { from = null; }
  }

  if (from && !isLegal(from, to)) {
    console.warn(`[swarm:transition] illegal transition ${runId}: ${from} → ${to} (allowed anyway)`);
  }

  const at = new Date().toISOString();
  const partial = { status: to, ...(extra || {}) };
  if (reason) partial.transitionReason = reason;
  partial.lastTransitionAt = at;
  if (TERMINAL_STATES.has(to) && !partial.finishedAt) partial.finishedAt = at;

  if (typeof writeRunMeta === 'function') {
    try { writeRunMeta(runId, partial); }
    catch (err) { console.error('[swarm:transition] writeRunMeta failed:', err?.message || err); }
  }

  if (typeof audit === 'function') {
    try {
      await audit({
        title: `state ${from || '(initial)'} → ${to} ${runId}`,
        payload: { event: 'state-transition', runId, from, to, reason, extra, at },
        tags: ['swarm', 'audit', `run:${runId}`, 'state'],
      });
    } catch (err) {
      console.error('[swarm:transition] audit failed:', err?.message || err);
    }
  }

  return partial;
}
