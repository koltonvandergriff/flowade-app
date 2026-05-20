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
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'fs';

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
