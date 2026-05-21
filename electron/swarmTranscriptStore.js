// File-backed store for swarm run transcripts. Each run gets its own
// directory under {userData}/flowade-data/swarm-transcripts/{runId}/:
//   - meta.json          (task, status, summary, panes[], timestamps)
//   - {terminalId}.log   (raw pty scrollback for each pane)
//
// Intentionally NOT in the memory store: memory is curated
// facts/decisions, not operational logs. This store is the source of
// truth for the future Swarm Runs UI page (roadmap).

import { app } from 'electron';
import { join } from 'path';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'fs';

function rootDir() {
  return join(app.getPath('userData'), 'flowade-data', 'swarm-transcripts');
}

function runDir(runId) {
  return join(rootDir(), runId);
}

function ensureRoot() {
  const r = rootDir();
  if (!existsSync(r)) mkdirSync(r, { recursive: true });
  return r;
}

function ensureRunDir(runId) {
  const d = runDir(runId);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function safeRead(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

// Write or merge a run's meta.json. Called twice per run (open at start,
// final at finish/cancel) so we overlay rather than overwrite.
export function writeRunMeta(runId, partial) {
  ensureRunDir(runId);
  const path = join(runDir(runId), 'meta.json');
  let existing = {};
  const raw = safeRead(path);
  if (raw) {
    try { existing = JSON.parse(raw); } catch { existing = {}; }
  }
  const merged = { ...existing, ...partial, runId, updatedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// Write a pane's transcript to {runId}/{terminalId}.log. Raw bytes —
// the future UI strips ANSI escapes on render.
export function writeTranscript(runId, terminalId, content) {
  ensureRunDir(runId);
  const path = join(runDir(runId), `${terminalId}.log`);
  writeFileSync(path, content || '', 'utf8');
  return path;
}

// List all runs, newest first by directory mtime. Each entry returns
// meta + a `transcriptCount`. Used by the future Swarm Runs page.
export function listRuns() {
  const r = ensureRoot();
  let dirs;
  try {
    dirs = readdirSync(r, { withFileTypes: true }).filter(d => d.isDirectory());
  } catch {
    return [];
  }
  const rows = [];
  for (const d of dirs) {
    const id = d.name;
    const dir = join(r, id);
    let meta = {};
    const raw = safeRead(join(dir, 'meta.json'));
    if (raw) {
      try { meta = JSON.parse(raw); } catch { meta = {}; }
    }
    let mtime = 0;
    let transcriptCount = 0;
    try {
      mtime = statSync(dir).mtimeMs;
      transcriptCount = readdirSync(dir).filter(f => f.endsWith('.log')).length;
    } catch {}
    rows.push({ runId: id, ...meta, transcriptCount, mtime });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}

export function getRun(runId) {
  if (!runId) return null;
  const dir = runDir(runId);
  if (!existsSync(dir)) return null;
  let meta = {};
  const raw = safeRead(join(dir, 'meta.json'));
  if (raw) {
    try { meta = JSON.parse(raw); } catch { meta = {}; }
  }
  let transcripts = [];
  try {
    transcripts = readdirSync(dir)
      .filter(f => f.endsWith('.log'))
      .map(f => f.replace(/\.log$/, ''));
  } catch {}
  return { runId, ...meta, transcripts };
}

export function getTranscript(runId, terminalId) {
  if (!runId || !terminalId) return null;
  const path = join(runDir(runId), `${terminalId}.log`);
  return safeRead(path);
}

// Terminal statuses that are safe to delete. Anything outside this set
// is a run still in-flight, so we leave it alone even if the dir mtime
// is stale (covers the orphan-recovery race window). Keeps the purge
// safe to schedule on a timer.
const TERMINAL_PURGE_STATUSES = new Set([
  'done', 'done-with-warnings', 'cancelled', 'failed', 'crashed',
]);

// Purge run directories whose mtime is older than retentionDays AND
// whose meta.json reports a terminal status. Returns { purged, scanned,
// errors[] } so callers can log a summary. Never throws — disk failures
// are logged per-run and the loop continues.
export function purgeOldRuns({ retentionDays } = {}) {
  const days = Number.isFinite(retentionDays) ? Math.max(1, retentionDays) : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const root = ensureRoot();
  const report = { purged: 0, scanned: 0, errors: [], retentionDays: days };

  let dirs;
  try { dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); }
  catch { return report; }

  for (const d of dirs) {
    report.scanned++;
    const id = d.name;
    const dir = join(root, id);
    let mtime = 0;
    try { mtime = statSync(dir).mtimeMs; } catch { continue; }
    if (mtime >= cutoff) continue;

    // Safety: skip dirs whose meta.json is missing or status is
    // non-terminal. A run still in flight should never get purged by a
    // background timer, regardless of how stale its dir looks.
    let status = null;
    const raw = safeRead(join(dir, 'meta.json'));
    if (raw) {
      try { status = JSON.parse(raw).status || null; } catch { status = null; }
    }
    if (!status || !TERMINAL_PURGE_STATUSES.has(status)) continue;

    try {
      rmSync(dir, { recursive: true, force: true });
      report.purged++;
    } catch (err) {
      report.errors.push({ runId: id, error: err?.message || String(err) });
    }
  }

  return report;
}
