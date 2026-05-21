import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { paneRegistry } from './paneRegistry.js';
import { leaseRegistry } from './leaseRegistry.js';
import { swarmChannel } from './swarmChannel.js';
import { resolveProvider, checkAvailable, isSwarmCapable } from './providerRegistry.js';
import {
  auditSpawn,
  auditKill,
  auditCancel,
  auditConfirm,
  recordRunStart,
  recordRunFinish,
} from './swarmAudit.js';
import { writeRunMeta, writeTranscript } from './swarmTranscriptStore.js';
import { SwarmState, TERMINAL_STATES, transition as stateTransition } from './swarmStates.js';
import { SwarmErrorKind, handle as handleSwarmError } from './swarmErrors.js';

const TEAM_LETTERS = ['A', 'B', 'C', 'D'];
const MAX_PANES_PER_WORKSPACE = 16;

const runs = new Map();

// Lightweight audit shim. swarmAudit's helpers are use-case-specific
// (auditSpawn, auditKill, etc.); state transitions + error events need a
// pass-through. We write them as type='audit' memories through the same
// store, but bypassing the typed helpers so we don't fork their schemas.
async function auditPassthrough({ title, payload, tags }) {
  try {
    const { _store } = await import('./swarmAudit.js').then(m => ({ _store: null })).catch(() => ({ _store: null }));
    // swarmAudit.js doesn't export its store directly. We rely on its
    // internal write path via re-using auditSpawn's shape. For now, just
    // log — the explicit audit calls in spawn/kill/etc still fire.
    console.log(`[swarm:audit] ${title}`, payload && payload.event);
  } catch (_) { /* never block */ }
}

function buildTransition({ writeRunMeta: writeMeta }) {
  return async ({ runId, to, reason, extra }) => stateTransition(
    { runId, to, reason, extra },
    {
      writeRunMeta: writeMeta,
      audit: auditPassthrough,
      getCurrentState: (id) => runs.get(id)?.status || null,
    }
  );
}

const transition = buildTransition({ writeRunMeta });

async function handleError({ runId, kind, details, retries }) {
  return handleSwarmError(
    { runId, kind, details, retries },
    { swarmChannel, transition, audit: auditPassthrough }
  );
}

// Parse the absolute paths from the "Files (N total):" section of the
// summary and return ones that don't currently exist on disk. Used at
// finish() time to bump DONE → DONE_WITH_WARNINGS so the UI can flag a
// summary that lies about the artifacts it claims to have produced.
function checkSummaryFileIntegrity(summary) {
  if (typeof summary !== 'string') return [];
  const missing = [];
  const lines = summary.split('\n');
  let inFiles = false;
  for (const line of lines) {
    if (/^\s*Files\s*\(/i.test(line)) { inFiles = true; continue; }
    if (inFiles) {
      // Section ends at next blank line followed by another header, or
      // any line starting with a non-bullet "Word:" pattern.
      if (/^\s*$/.test(line)) continue;
      if (/^\s*-\s+/.test(line)) {
        // Grab the first token that looks like an absolute path.
        const m = line.match(/[-*]\s+([A-Za-z]:[\\/][^\s·]+|\/[^\s·]+)/);
        if (m && m[1]) {
          const p = m[1].replace(/[`'"]+$/, '');
          try {
            if (!existsSync(p)) missing.push(`missing: ${p}`);
          } catch (_) { /* skip if existsSync throws on weird paths */ }
        }
      } else if (/^[A-Z][A-Za-z ]+:/.test(line)) {
        // Next header — leave the Files section.
        inFiles = false;
      }
    }
  }
  return missing;
}

// Prompt templates live in mcp-server/prompts/. Read once at module load
// and reused per swarm spawn — they're system prompts, not per-run.
const __dirname_swarm = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname_swarm, '..', 'mcp-server', 'prompts');

let _orchestratorTemplate = null;
let _workerTemplate = null;

function loadTemplate(filename) {
  try {
    return readFileSync(join(PROMPTS_DIR, filename), 'utf8');
  } catch (err) {
    console.error('[swarm] failed to load prompt template', filename, err?.message);
    return '';
  }
}

function getOrchestratorTemplate() {
  if (_orchestratorTemplate == null) _orchestratorTemplate = loadTemplate('orchestrator.md');
  return _orchestratorTemplate;
}

function getWorkerTemplate() {
  if (_workerTemplate == null) _workerTemplate = loadTemplate('worker.md');
  return _workerTemplate;
}

function buildOrchestratorPrompt({ runId, teamId, workerCount, workerTerminalIds, task }) {
  const tpl = getOrchestratorTemplate();
  return [
    tpl,
    '',
    '---',
    '',
    '# Your runtime context',
    `runId: ${runId}`,
    `teamId: ${teamId}`,
    `workerCount: ${workerCount}`,
    `workerTerminalIds: ${JSON.stringify(workerTerminalIds)}`,
    '',
    `# Task`,
    task,
    '',
    'Begin Phase 1 — plan. Use flowade_swarm_read to confirm the plan event, then post your planned subtasks back to the channel with kind=plan.',
  ].join('\n');
}

function buildWorkerPrompt({ runId, teamId, workerId }) {
  const tpl = getWorkerTemplate();
  return [
    tpl,
    '',
    '---',
    '',
    '# Your runtime context',
    `runId: ${runId}`,
    `teamId: ${teamId}`,
    `workerId: ${workerId}`,
    '',
    'Wait. The orchestrator will send your dispatch packet to this terminal shortly. Do not start work until it arrives.',
  ].join('\n');
}

function pickTeamId(workspace) {
  const orchestrators = paneRegistry.list({ workspace, ownerType: 'orchestrator' });
  const used = new Set();
  for (const rec of orchestrators) {
    if (rec.teamId) used.add(rec.teamId);
  }
  for (const letter of TEAM_LETTERS) {
    if (!used.has(letter)) return letter;
  }
  throw new Error('All 4 teams in use for this workspace');
}

function checkCapacity({ workspace, workerCount }) {
  const panesInUse = paneRegistry.list({ workspace }).length;
  const need = workerCount + 1;
  if (panesInUse + need > MAX_PANES_PER_WORKSPACE) {
    throw new Error(`not enough free panes: need ${need}, have ${MAX_PANES_PER_WORKSPACE - panesInUse}`);
  }
}

function requirePty(ptyManager) {
  if (!ptyManager) throw new Error('ptyManager not wired');
  return ptyManager;
}

function newPaneId() {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerVisiblePane(paneId, { provider, workspace, sessionName, ownerType, teamId, spawnedBy, initialPrompt }) {
  // Visible flow: register with the prompt already staged. main.js
  // forwards `pane:register` to the renderer; WorkspaceContext upserts
  // a tile; TerminalPane mounts and calls terminal:spawn, which creates
  // the pty + boots the provider + injects the staged prompt at +4.5s.
  paneRegistry.register(paneId, {
    provider, sessionName, workspace, ownerType, teamId, spawnedBy, initialPrompt,
  });
  return paneId;
}

async function start(params, { ptyManager }) {
  requirePty(ptyManager);
  const task = params && params.task;
  const workerCount = params && params.workerCount;
  const workspace = params && params.workspace;
  // userTerminalId: caller may pass it explicitly; otherwise infer the
  // most ACTIVE user pane in this workspace (highest pty tokenSeq = the
  // pane that has been emitting output, i.e. the one the user is
  // actually typing in). Falls back to most-recent createdAt if no pane
  // has any tokens yet. Used at finish() to write `[swarm summary]`
  // back to the originating pane and at render time for the "from"
  // footer badge. Explicit param still wins for explicit callers.
  let userTerminalId = (params && params.userTerminalId) || null;
  if (!userTerminalId && workspace) {
    const userPanes = paneRegistry.list({ workspace, ownerType: 'user' });
    if (userPanes.length > 0) {
      // Prefer the pane the user just typed in. Falls back to tokenSeq
      // (for headless panes) and finally createdAt so the first swarm
      // from a fresh workspace still has a target.
      const sorted = [...userPanes].sort((a, b) => {
        const li = (b.lastInputAt || 0) - (a.lastInputAt || 0);
        if (li !== 0) return li;
        const t = (b.tokenSeq || 0) - (a.tokenSeq || 0);
        return t !== 0 ? t : (b.createdAt || 0) - (a.createdAt || 0);
      });
      userTerminalId = sorted[0].id;
    }
  }

  // Resolve provider via inheritance chain:
  //   explicit param > parent pane provider > most-recent user pane in
  //   this workspace > 'claude'. Throws if explicit provider is not
  //   swarm-capable (api / shell / custom).
  const provider = resolveProvider({
    requested: params && params.provider,
    parentPaneId: userTerminalId,
    parentWorkspace: workspace,
    paneRegistry,
    defaultProvider: 'claude',
  });

  // Verify the CLI binary exists before spawning N+1 panes the user
  // will then have to manually close. Cached for 60s.
  const availability = await checkAvailable(provider);
  if (!availability.available) {
    throw new Error(`provider '${provider}' unavailable: ${availability.reason}`);
  }

  checkCapacity({ workspace, workerCount });
  const chosenTeamId = (params && params.teamId) || pickTeamId(workspace);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  // Pre-allocate all pane ids so the orchestrator's prompt can reference
  // the worker ids without a second-pass setInitialPrompt. Register
  // orchestrator FIRST so it lands adjacent to its source user pane in
  // the grid (the team reads left→right: user · orch · W1 · W2). Worker
  // panes boot a moment later than the orchestrator but the orchestrator
  // explicitly waits for `Plan acknowledged` before dispatching, so the
  // boot-order gap is benign.
  const orchestratorTerminalId = newPaneId();
  const workerTerminalIds = [];
  for (let i = 1; i <= workerCount; i++) workerTerminalIds.push(newPaneId());

  registerVisiblePane(orchestratorTerminalId, {
    provider,
    workspace,
    sessionName: 'orch',
    ownerType: 'orchestrator',
    teamId: chosenTeamId,
    spawnedBy: userTerminalId,
    initialPrompt: buildOrchestratorPrompt({
      runId, teamId: chosenTeamId, workerCount, workerTerminalIds, task,
    }),
  });
  await auditSpawn({
    runId,
    terminalId: orchestratorTerminalId,
    ownerType: 'orchestrator',
    teamId: chosenTeamId,
    provider,
    workspace,
    sessionName: 'orch',
    spawnedBy: userTerminalId,
  });

  for (let i = 0; i < workerCount; i++) {
    const sessionName = `W${i + 1}`;
    const wid = workerTerminalIds[i];
    registerVisiblePane(wid, {
      provider,
      workspace,
      sessionName,
      ownerType: 'agent',
      teamId: chosenTeamId,
      spawnedBy: orchestratorTerminalId,
      initialPrompt: buildWorkerPrompt({ runId, teamId: chosenTeamId, workerId: sessionName }),
    });
    await auditSpawn({
      runId,
      terminalId: wid,
      ownerType: 'agent',
      teamId: chosenTeamId,
      provider,
      workspace,
      sessionName,
      spawnedBy: orchestratorTerminalId,
    });
  }

  runs.set(runId, {
    runId,
    teamId: chosenTeamId,
    task,
    workerCount,
    provider,
    workspace,
    orchestratorTerminalId,
    workerTerminalIds,
    userTerminalId,
    status: SwarmState.AWAITING_CONFIRM,
    startedAt,
    workersDone: new Set(),
    phaseNudged: { plan: false, allDone: false },
    finishRetries: 0,
  });

  // Per-run channel listener that pushes phase-transition nudges into
  // the orchestrator pane's pty. Claude in the orchestrator pane treats
  // these as fresh user input and keeps moving instead of ending its
  // turn between phases. Cleaned up on run end (finish/cancel) via the
  // shared `runs.delete`-then-`channelListener?.()` pattern.
  const onRunEvent = (event) => {
    try {
      _runEventHandler(event);
    } catch (err) {
      console.error('[swarm:onRunEvent]', runId, err?.message || err);
      // Route to centralized error handler so the run can recover or
      // surface to the user instead of silently dying mid-orchestration.
      handleError({
        runId,
        kind: SwarmErrorKind.UNRECOVERABLE,
        details: { reason: 'channel-listener-threw', message: err?.message || String(err) },
      }).catch(() => {});
    }
  };
  const _runEventHandler = (event) => {
    const r = runs.get(runId);
    if (!r) return;
    const writePty = (text) => {
      try {
        if (ptyManager && typeof ptyManager.write === 'function') {
          ptyManager.write(orchestratorTerminalId, text);
          setTimeout(() => { try { ptyManager.write(orchestratorTerminalId, '\r'); } catch (_) {} }, 300);
        }
      } catch (_) { /* pty may be gone */ }
    };

    // Orchestrator just posted its plan. Auto-confirm has already been
    // emitted from start(); nudge it to read the channel + dispatch
    // workers in the same turn rather than ending.
    if (event.kind === 'plan' && event.workerId === 'orchestrator' && !r.phaseNudged.plan) {
      r.phaseNudged.plan = true;
      writePty(
        '\n\n[orchestration] Plan acknowledged. Auto-confirm is in the channel — do NOT wait. ' +
        'Right now in this turn: (1) read the channel for confirm via flowade_swarm_read({runId:"' + runId + '",sinceTokenId:0,kinds:["progress"]}). ' +
        '(2) Write any contracts to disk. (3) For each worker in your plan call flowade_send_to_terminal({terminalId, text:<dispatch packet JSON>}) — terminalIds are: ' +
        JSON.stringify(workerTerminalIds) + '. ' +
        '(4) Poll workers by calling flowade_swarm_read back-to-back with the latest sinceTokenId — NEVER use Bash sleep, Monitor, or setTimeout (those trigger permission prompts that stall the run). ' +
        '(5) Post kind=diff for each. (6) Call flowade_swarm_finish with the run summary. Do not stop or ask for confirmation.'
      );
    }

    // Worker reported done — track it. When the last worker reports
    // done, nudge the orchestrator to review + merge + finish.
    if (event.kind === 'done' && event.workerId && event.workerId !== 'orchestrator' && event.workerId !== 'user' && event.workerId !== 'system') {
      r.workersDone.add(event.workerId);
      if (r.workersDone.size >= r.workerCount && !r.phaseNudged.allDone) {
        r.phaseNudged.allDone = true;
        writePty(
          '\n\n[orchestration] All workers reported done. Now in this turn: ' +
          '(1) Run flowade_read_terminal on each worker to verify their output. ' +
          '(2) For each, post flowade_swarm_post({runId,workerId,kind:"diff",payload:{summary}}). ' +
          '(3) Compose the Phase 7 summary in EXACTLY the shape from orchestrator.md. Required fields, none omitted: ' +
          'header line (✓ Swarm run <runId> complete · <wallTime> · <N> workers · team <teamId>), ' +
          'Task: <verbatim>, ' +
          'Project context: cwd (absolute), repo (absolute path or "no git repo"), branch + HEAD short-sha + commit subject (omit if no repo), project (<name@version> from manifest or "none — scratch directory"), ' +
          'Files (<N> total): one bullet per file with <absolute path> · <bytes> B · <new|modified|unchanged> · <one-line purpose>, ' +
          'Verify with: one bullet per runnable command (e.g. "node hello.js"), ' +
          'Worker outcomes: one bullet per worker, honest about engagement — if a worker went idle and you wrote the file, say so, ' +
          'Tests: "<X>/<Y> green" or "not run — task did not request tests" (never claim tests passed unless you ran them), ' +
          'Follow-ups: list real TODOs/untested edges or write "none". ' +
          'To gather the context: read cwd, run `git rev-parse --is-inside-work-tree`, `git rev-parse --show-toplevel`, `git rev-parse --abbrev-ref HEAD`, `git log -1 --format=\'%h %s\'`, stat each touched file for bytes, check for package.json/pyproject.toml/Cargo.toml up to repo root for name@version. ' +
          '(4) Call flowade_swarm_finish({runId:"' + runId + '",summary:<your summary>}). Do not stop.'
        );
      }
    }
  };
  swarmChannel.on(`event:run:${runId}`, onRunEvent);
  const r = runs.get(runId);
  if (r) r._channelListener = () => swarmChannel.off(`event:run:${runId}`, onRunEvent);

  await recordRunStart({
    runId,
    task,
    workerCount,
    teamId: chosenTeamId,
    orchestratorTerminalId,
    workerTerminalIds,
  });

  // Open the transcript store entry for this run so the future Swarm
  // Runs UI can list it even mid-run. Finish/cancel overlay status +
  // summary + duration onto the same meta.json.
  try {
    writeRunMeta(runId, {
      task,
      workerCount,
      provider,
      workspace,
      teamId: chosenTeamId,
      orchestratorTerminalId,
      workerTerminalIds,
      userTerminalId,
      startedAt,
    });
    await transition({ runId, to: SwarmState.AWAITING_CONFIRM, reason: 'run-created' });
  } catch (err) {
    console.error('[swarm] writeRunMeta failed:', err?.message || err);
  }

  await swarmChannel.post({
    runId,
    workerId: 'system',
    kind: 'plan',
    payload: { task, workerCount, teamId: chosenTeamId, status: 'awaiting-confirm' },
  });

  // Auto-confirm unless caller explicitly asked to gate. User already
  // expressed intent by invoking `flowade_swarm_start` — making them
  // type a separate `flowade_swarm_confirm` is a fossil from the
  // multi-step plan-review workflow. Callers can pass `requireConfirm:
  // true` to keep the gate (e.g. for high-risk runs that want a plan
  // review). Posts the same channel event confirm() would, so the
  // orchestrator's poll loop in orchestrator.md doesn't need to change.
  const requireConfirm = !!(params && params.requireConfirm);
  if (!requireConfirm) {
    await auditConfirm({ runId, decision: 'yes', by: 'auto' });
    await swarmChannel.post({
      runId,
      workerId: 'user',
      kind: 'progress',
      payload: { confirm: 'yes', notes: 'auto-confirmed on start' },
    });
    const r = runs.get(runId);
    if (r) r.status = SwarmState.PLANNING;
    await transition({ runId, to: SwarmState.PLANNING, reason: 'auto-confirmed' });
  }

  return { runId, teamId: chosenTeamId, orchestratorTerminalId, workerTerminalIds, autoConfirmed: !requireConfirm };
}

async function confirm(params) {
  const runId = params && params.runId;
  const decision = params && params.decision;
  const notes = params && params.notes;
  const run = runs.get(runId);
  if (!run) throw new Error('unknown run');

  await auditConfirm({ runId, decision, by: 'user' });

  const kind = decision === 'cancel' ? 'cancel' : 'progress';
  await swarmChannel.post({
    runId,
    workerId: 'user',
    kind,
    payload: { confirm: decision, notes },
  });

  if (decision === 'cancel') {
    return cancel({ runId, reason: notes || 'user cancelled at plan' }, { ptyManager: null });
  }

  run.status = SwarmState.PLANNING;
  await transition({ runId, to: SwarmState.PLANNING, reason: 'user-confirmed' });
  return { ok: true };
}

async function cancel(params, { ptyManager }) {
  const runId = params && params.runId;
  const reason = params && params.reason;
  const run = runs.get(runId);
  if (!run) return { ok: true, missing: true };

  // Capture transcripts to the file store BEFORE the kill loop — user
  // wants to see what each worker did at the moment of cancel. Same
  // store as finish() so future Swarm Runs UI doesn't branch on status.
  const RING_CAP = 256 * 1024;
  const terminals = [run.orchestratorTerminalId, ...run.workerTerminalIds].filter(Boolean);
  const durationMs = Date.now() - new Date(run.startedAt).getTime();
  const panes = [];
  for (const tid of terminals) {
    const rec = paneRegistry.get(tid);
    if (!rec) continue;
    let transcriptText = '';
    try {
      const slice = paneRegistry.readSince(tid, 0, RING_CAP);
      transcriptText = (slice.chunks || []).map((c) => (typeof c === 'string' ? c : c.toString('utf8'))).join('');
    } catch (_) { /* capture empty */ }
    try {
      writeTranscript(runId, tid, transcriptText);
    } catch (err) {
      console.error('[swarm] writeTranscript(cancel) failed:', err?.message || err);
    }
    panes.push({
      terminalId: tid,
      ownerType: rec.ownerType,
      teamId: rec.teamId,
      provider: rec.provider,
      sessionName: rec.sessionName,
      bytes: transcriptText.length,
    });
  }
  try {
    writeRunMeta(runId, {
      reason: reason || null,
      durationMs,
      panes,
    });
    await transition({
      runId, to: SwarmState.CANCELLED,
      reason: reason || 'cancelled',
      extra: { durationMs },
    });
  } catch (err) {
    console.error('[swarm] writeRunMeta(cancel) failed:', err?.message || err);
  }

  const killedTerminalIds = [];
  for (const terminalId of terminals) {
    try {
      if (ptyManager && typeof ptyManager.kill === 'function') {
        await ptyManager.kill(terminalId);
      }
      paneRegistry.unregister(terminalId);
      killedTerminalIds.push(terminalId);
      await auditKill({ runId, terminalId, reason: reason || 'cancelled' });
    } catch (_) {
      // continue
    }
  }

  const releaseRes = leaseRegistry.releaseAll({ runId }) || {};
  const releasedLeases = releaseRes.released || [];

  run.status = SwarmState.CANCELLED;
  await recordRunFinish({
    runId,
    summary: 'cancelled: ' + (reason || ''),
    durationMs,
    status: 'cancelled',
  });
  await auditCancel({ runId, reason, by: 'system' });
  await swarmChannel.post({
    runId,
    workerId: 'system',
    kind: 'cancel',
    payload: { reason },
  });

  try { runs.get(runId)?._channelListener?.(); } catch (_) {}
  runs.delete(runId);
  return { ok: true, killedTerminalIds, releasedLeases };
}

async function finish(params, { ptyManager }) {
  const runId = params && params.runId;
  const summary = params && params.summary;
  const durationMs = params && params.durationMs;
  const run = runs.get(runId);
  if (!run) throw new Error('unknown run');

  // File integrity check: parse the summary's "Files (...)" bullets and
  // verify the absolute paths actually exist. A summary that lists files
  // we can't find downgrades the run to DONE_WITH_WARNINGS so the UI can
  // surface the inconsistency.
  const integrityIssues = checkSummaryFileIntegrity(summary);
  const summaryWarnings = null;

  await recordRunFinish({ runId, summary, durationMs, status: 'done' });
  await swarmChannel.post({
    runId,
    workerId: 'orchestrator',
    kind: 'finish',
    payload: { summary },
  });

  // Capture pane transcripts BEFORE killing — the pty ring buffer dies
  // with the pane unregister. Written to the file-backed transcript
  // store, NOT memory: memory is curated facts, transcripts are raw
  // operational logs. Future Swarm Runs UI reads from this store.
  const RING_CAP = 256 * 1024;
  const teamTerminalIds = [run.orchestratorTerminalId, ...run.workerTerminalIds].filter(Boolean);
  const panes = [];
  for (const tid of teamTerminalIds) {
    const rec = paneRegistry.get(tid);
    if (!rec) continue;
    let transcriptText = '';
    try {
      const slice = paneRegistry.readSince(tid, 0, RING_CAP);
      transcriptText = (slice.chunks || []).map((c) => (typeof c === 'string' ? c : c.toString('utf8'))).join('');
    } catch (_) { /* capture empty */ }
    try {
      writeTranscript(runId, tid, transcriptText);
    } catch (err) {
      console.error('[swarm] writeTranscript failed:', err?.message || err);
    }
    panes.push({
      terminalId: tid,
      ownerType: rec.ownerType,
      teamId: rec.teamId,
      provider: rec.provider,
      sessionName: rec.sessionName,
      bytes: transcriptText.length,
    });
  }
  // Choose terminal state. Either summary-warnings or integrity-issues
  // demote DONE → DONE_WITH_WARNINGS so the run page UI can flag it
  // without losing the summary.
  const hasIssues = (integrityIssues && integrityIssues.length > 0) || (summaryWarnings && summaryWarnings.length > 0);
  const finalState = hasIssues ? SwarmState.DONE_WITH_WARNINGS : SwarmState.DONE;
  const extra = { summary, durationMs, panes };
  if (integrityIssues && integrityIssues.length > 0) extra.integrityIssues = integrityIssues;
  if (summaryWarnings && summaryWarnings.length > 0) extra.summaryWarnings = summaryWarnings;
  try {
    await transition({ runId, to: finalState, reason: 'finish', extra });
  } catch (err) {
    console.error('[swarm] transition(finish) failed:', err?.message || err);
  }

  // Auto-close: kill ptys + unregister panes. The paneRegistry emits
  // 'pane:closed' for each which main.js forwards to the renderer, so
  // the workspace's TerminalGrid removes them from the layout
  // automatically (see WorkspaceContext swarm pane subscription).
  const killedTerminalIds = [];
  for (const tid of teamTerminalIds) {
    try {
      if (ptyManager && typeof ptyManager.kill === 'function') {
        await ptyManager.kill(tid);
      }
      paneRegistry.unregister(tid);
      killedTerminalIds.push(tid);
    } catch (_) {
      // continue — best effort
    }
  }

  if (run.userTerminalId && ptyManager && typeof ptyManager.write === 'function') {
    try {
      // Phrase the summary as a system message the user-pane agent
      // should relay to the human. Enter is sent as a separate keystroke
      // after the paste settles so the claude CLI in the user pane
      // actually submits + renders the response (otherwise the text
      // sits in the input buffer waiting on a manual Enter).
      const note =
        `[swarm summary — Run ${runId}]\n` +
        `${summary}\n\n` +
        `Team auto-closed. Transcripts archived; open Swarm Runs to view. ` +
        `Relay this summary verbatim to the human and stand by.`;
      await ptyManager.write(run.userTerminalId, note);
      setTimeout(() => {
        try { ptyManager.write(run.userTerminalId, '\r'); } catch (_) {}
      }, 400);
    } catch (_) {
      // best effort
    }
  }

  run.status = finalState;
  try { runs.get(runId)?._channelListener?.(); } catch (_) {}
  runs.delete(runId);
  return {
    ok: true,
    killedTerminalIds,
    transcriptCount: panes.length,
    status: finalState,
    integrityIssues: integrityIssues || [],
    summaryWarnings: summaryWarnings || [],
  };
}

export function buildHandlers({ ptyManager } = {}) {
  return {
    'swarm.start':   async (p) => start(p, { ptyManager }),
    'swarm.confirm': async (p) => confirm(p),
    'swarm.cancel':  async (p) => cancel(p, { ptyManager }),
    'swarm.finish':  async (p) => finish(p, { ptyManager }),
  };
}

export function registerOrchestrationHandlers(bridge, deps) {
  const handlers = buildHandlers(deps);
  if (bridge && typeof bridge.registerMethod === 'function') {
    for (const [n, fn] of Object.entries(handlers)) bridge.registerMethod(n, fn);
  }
  return handlers;
}

export function _runsForTest() { return runs; }

// Surface in-memory runs to the renderer (via main.js IPC) so user panes
// can look up which runs they're rooting. Lightweight projection only —
// internal handles (_channelListener, workersDone Set) stay private.
export function listActiveRuns() {
  const out = [];
  for (const r of runs.values()) {
    out.push({
      runId: r.runId,
      teamId: r.teamId,
      task: r.task,
      workerCount: r.workerCount,
      status: r.status,
      orchestratorTerminalId: r.orchestratorTerminalId,
      workerTerminalIds: r.workerTerminalIds,
      userTerminalId: r.userTerminalId,
      startedAt: r.startedAt,
      finishRetries: r.finishRetries || 0,
    });
  }
  return out;
}
