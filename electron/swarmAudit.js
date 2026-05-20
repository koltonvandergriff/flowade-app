// swarmAudit — thin helper around memoryStore for swarm-run audit entries.
//
// All swarm lifecycle events (spawn / kill / claim / release / confirm /
// cancel / plan-rejected) and run-record entries (start / finish) are
// persisted as type='audit' memories so the dashboard can show a unified
// timeline. The actual sync (local-first + cloud upsert) lives in
// memoryStore; this module is just the right-shaped wrapper.
//
// memoryStore is constructed in main.js, not exported as a singleton, so
// we accept it via setMemoryStore() during startup. Any audit call made
// before setMemoryStore() runs is swallowed with a console.error — the
// swarm itself must never be blocked by audit failure.

import { supabase } from './supabaseClient.js';

const AUDIT_PATH = ['Swarm', 'Audit'];
const RUNS_PATH  = ['Swarm', 'Runs'];

let _store = null;
let _auditCategoryId = null;
let _runsCategoryId = null;

export function setMemoryStore(store) {
  _store = store;
}

// Resolve a category id by walking the path (e.g. ['Swarm','Audit']) from
// root to leaf. Returns null if the chain is incomplete — the audit memory
// is then written without categoryId, which is intentional: the Swarm
// category tree is auto-created lazily by the categorization flow, and
// uncategorized audit entries still surface via type='audit' filters.
async function resolveCategoryId(segments) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return null;
    const userId = session.user.id;
    const { data, error } = await supabase
      .from('memory_categories')
      .select('id, name, parent_id')
      .eq('user_id', userId)
      .is('deleted_at', null);
    if (error || !data) return null;
    let parentId = null;
    for (const name of segments) {
      const row = data.find(r => r.name === name && (r.parent_id ?? null) === parentId);
      if (!row) return null;
      parentId = row.id;
    }
    return parentId;
  } catch {
    return null;
  }
}

async function writeAudit({ title, payload, tags, runs = false }) {
  if (!_store) {
    console.error('[swarmAudit] memoryStore not initialized; dropping event:', title);
    return null;
  }
  try {
    let categoryId;
    if (runs) {
      categoryId = _runsCategoryId ?? (_runsCategoryId = await resolveCategoryId(RUNS_PATH));
    } else {
      categoryId = _auditCategoryId ?? (_auditCategoryId = await resolveCategoryId(AUDIT_PATH));
    }
    const entry = _store.create({
      type: 'audit',
      title,
      content: JSON.stringify(payload, null, 2),
      tags,
      categoryId: categoryId || undefined,
    });
    if (entry && entry.error) {
      console.error('[swarmAudit] create returned error:', entry.error);
      return null;
    }
    return entry;
  } catch (err) {
    console.error('[swarmAudit] write failed:', err?.message || err);
    return null;
  }
}

export async function auditSpawn({ runId, terminalId, ownerType, teamId, provider, workspace, sessionName, spawnedBy }) {
  return writeAudit({
    title: `spawn ${ownerType} ${terminalId}`,
    payload: { event: 'spawn', runId, terminalId, ownerType, teamId, provider, workspace, sessionName, spawnedBy, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, ownerType],
  });
}

export async function auditKill({ runId, terminalId, reason }) {
  return writeAudit({
    title: `kill ${terminalId}`,
    payload: { event: 'kill', runId, terminalId, reason, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, 'kill'],
  });
}

export async function auditClaim({ runId, workerId, path, result }) {
  return writeAudit({
    title: `claim ${path}`,
    payload: { event: 'claim', runId, workerId, path, result, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, 'claim'],
  });
}

export async function auditRelease({ runId, workerId, path }) {
  return writeAudit({
    title: `release ${path}`,
    payload: { event: 'release', runId, workerId, path, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, 'release'],
  });
}

export async function auditConfirm({ runId, decision, by }) {
  return writeAudit({
    title: `confirm ${decision}`,
    payload: { event: 'confirm', runId, decision, by, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, 'confirm'],
  });
}

export async function auditCancel({ runId, reason, by }) {
  return writeAudit({
    title: `cancel ${runId}`,
    payload: { event: 'cancel', runId, reason, by, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, 'cancel'],
  });
}

export async function auditPlanRejected({ runId, reason, details }) {
  return writeAudit({
    title: `plan rejected ${runId}`,
    payload: { event: 'plan-rejected', runId, reason, details, at: new Date().toISOString() },
    tags: ['swarm', 'audit', `run:${runId}`, 'plan-rejected'],
  });
}

export async function recordRunStart({ runId, task, workerCount, teamId, orchestratorTerminalId, workerTerminalIds }) {
  return writeAudit({
    title: `swarm run ${runId} started`,
    payload: { event: 'run-start', runId, task, workerCount, teamId, orchestratorTerminalId, workerTerminalIds, at: new Date().toISOString() },
    tags: ['swarm', 'run', `run:${runId}`, 'started'],
    runs: true,
  });
}

export async function recordRunFinish({ runId, summary, durationMs, status }) {
  return writeAudit({
    title: `swarm run ${runId} ${status || 'finished'}`,
    payload: { event: 'run-finish', runId, summary, durationMs, status, at: new Date().toISOString() },
    tags: ['swarm', 'run', `run:${runId}`, status || 'finished'],
    runs: true,
  });
}

