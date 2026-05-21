#!/usr/bin/env node
// Phase 5 Stage 14 — DRY end-to-end smoke for swarm orchestration.
//
// This script verifies as much of the swarm surface as can be tested
// outside the live Electron runtime, in order of decreasing confidence:
//
//   1. Syntactic — every new .js file parses (node --check style).
//   2. Pure-Node modules — paneRegistry + leaseRegistry imported and
//      exercised in-process (register, list, claim, conflict, release,
//      validate_plan including overlap rejection + parallelism factor
//      + cycle detection).
//   3. Asset shape — migrations 009/010 contain the required statements
//      (create table + RLS + grants; type CHECK widening); prompt MDs
//      mention the required tool names and contracts.
//
// Modules that touch the Electron `app` global (swarmChannel,
// swarmAudit, swarmOrchestration) cannot be safely loaded from a plain
// Node process — they are checked syntactically only, with a logged
// note. A future live-bridge smoke (running under `electron .`) will
// pick up where this stops.
//
// Exits 0 on green with "SMOKE ✓"; exits 1 with diagnostics on red.

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const fileUrl    = (rel) => pathToFileURL(join(ROOT, rel)).href;

const failures = [];
const fail = (m) => { failures.push(m); process.stderr.write(`  ✗ ${m}\n`); };
const ok   = (m) => process.stdout.write(`  ✓ ${m}\n`);
const note = (m) => process.stdout.write(`  · ${m}\n`);
const section = (m) => process.stdout.write(`\n[${m}]\n`);

// ---------- 1. Syntactic ----------

section('1. node --check every new module');

const TARGETS = [
  'electron/paneRegistry.js',
  'electron/swarmBridge.js',
  'electron/swarmTerminalHandlers.js',
  'electron/leaseRegistry.js',
  'electron/swarmChannel.js',
  'electron/swarmAudit.js',
  'electron/swarmOrchestration.js',
  'mcp-server/swarmClient.js',
  'mcp-server/tools/terminal.js',
  'mcp-server/tools/leases.js',
  'mcp-server/tools/channel.js',
  'mcp-server/tools/swarm.js',
  'src/lib/swarmTheme.js',
];

for (const rel of TARGETS) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) { fail(`missing file: ${rel}`); continue; }
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    ok(`syntax ok — ${rel}`);
  } catch (e) {
    fail(`syntax error in ${rel}: ${e.stderr ? e.stderr.toString() : e.message}`);
  }
}

// ---------- 2. Pure-Node modules ----------

section('2. paneRegistry exercise');

try {
  const { paneRegistry, PaneRegistry, RING_SIZE } = await import(fileUrl('electron/paneRegistry.js'));
  if (typeof PaneRegistry !== 'function') fail('PaneRegistry class not exported');
  if (typeof RING_SIZE !== 'number' || RING_SIZE <= 0) fail('RING_SIZE export missing or invalid');

  // Fresh registry for clean assertions.
  const reg = new PaneRegistry();
  const seenEvents = [];
  reg.on('pane:state-change', (e) => seenEvents.push({ ev: 'state', ...e }));
  reg.on('pane:closed', (e) => seenEvents.push({ ev: 'closed', ...e }));

  reg.register('pane-1', { provider: 'claude', sessionName: 'orch', workspace: 'smoke-ws', ownerType: 'orchestrator', teamId: 'A' });
  reg.register('pane-2', { provider: 'claude', sessionName: 'W1',   workspace: 'smoke-ws', ownerType: 'agent',        teamId: 'A', spawnedBy: 'pane-1' });
  reg.register('pane-3', { provider: 'claude', sessionName: 'W2',   workspace: 'smoke-ws', ownerType: 'agent',        teamId: 'A', spawnedBy: 'pane-1' });

  if (reg.size() !== 3) fail(`expected 3 panes, got ${reg.size()}`);
  if (reg.list({ ownerType: 'orchestrator' }).length !== 1) fail('orchestrator filter broken');
  if (reg.list({ ownerType: 'agent' }).length !== 2) fail('agent filter broken');
  if (reg.list({ teamId: 'A' }).length !== 3) fail('teamId filter broken');
  if (reg.list({ teamId: 'B' }).length !== 0) fail('teamId B filter should be empty');

  reg.appendOutput('pane-1', Buffer.from('hello world\n'));
  const r1 = reg.readSince('pane-1', 0, 1024);
  if (!r1 || !Array.isArray(r1.chunks)) fail('readSince shape wrong');
  if (r1.tokenId !== 12) fail(`expected tokenId=12, got ${r1.tokenId}`);

  reg.setState('pane-2', 'busy');
  if (!seenEvents.some(e => e.ev === 'state' && e.paneId === 'pane-2' && e.newState === 'busy')) {
    fail('pane:state-change event not emitted for pane-2');
  }

  reg.unregister('pane-3');
  if (reg.size() !== 2) fail('unregister did not shrink');
  if (!seenEvents.some(e => e.ev === 'closed' && e.paneId === 'pane-3')) fail('pane:closed event missing');

  ok('paneRegistry: register/list/filters/readSince/setState/unregister all green');
} catch (e) {
  fail(`paneRegistry threw: ${e.stack || e.message}`);
}

section('3. leaseRegistry exercise');

try {
  const { LeaseRegistry } = await import(fileUrl('electron/leaseRegistry.js'));
  const leases = new LeaseRegistry();

  const c1 = leases.claim({ runId: 'r1', workerId: 'W1', path: 'C:/proj/src/foo.js' });
  if (!c1.ok) fail('first claim should succeed');

  const c2 = leases.claim({ runId: 'r1', workerId: 'W2', path: 'c:\\proj\\src\\foo.js' });
  if (c2.ok) fail('conflicting claim should fail (path normalization not working)');
  if (c2.conflict && c2.conflict.isCrossRun) fail('isCrossRun should be false for same-run conflict');

  const c3 = leases.claim({ runId: 'r2', workerId: 'X1', path: 'C:/proj/src/foo.js' });
  if (c3.ok) fail('cross-run claim should fail');
  if (c3.conflict && !c3.conflict.isCrossRun) fail('isCrossRun should be true for different-run conflict');

  const rel = leases.release({ runId: 'r1', workerId: 'W1', path: 'C:/proj/src/foo.js' });
  if (!rel.ok) fail('release by holder should succeed');
  const c4 = leases.claim({ runId: 'r2', workerId: 'X1', path: 'C:/proj/src/foo.js' });
  if (!c4.ok) fail('claim after release should succeed');

  // validatePlan — disjoint, valid
  const p1 = leases.validatePlan({
    subtasks: [
      { workerId: 'W1', expectedFiles: ['a.js', 'b.js'] },
      { workerId: 'W2', expectedFiles: ['c.js', 'd.js'] },
    ],
  });
  if (!p1.ok) fail(`disjoint plan rejected: ${p1.error || p1.overlap?.path}`);
  if (p1.parallelismFactor !== 1) fail(`parallelism should be 1 for no deps, got ${p1.parallelismFactor}`);

  // validatePlan — overlap rejected
  const p2 = leases.validatePlan({
    subtasks: [
      { workerId: 'W1', expectedFiles: ['a.js'] },
      { workerId: 'W2', expectedFiles: ['a.js'] },
    ],
  });
  if (p2.ok) fail('overlapping plan should be rejected');
  if (p2.overlap && p2.overlap.workers && !(p2.overlap.workers.includes('W1') && p2.overlap.workers.includes('W2'))) {
    fail('overlap.workers should list both colliding workers');
  }

  // validatePlan — cycle detected
  const p3 = leases.validatePlan({
    subtasks: [
      { workerId: 'W1', expectedFiles: ['a.js'], dependsOn: ['W2'] },
      { workerId: 'W2', expectedFiles: ['b.js'], dependsOn: ['W1'] },
    ],
  });
  if (p3.ok) fail('cyclic plan should be rejected');

  leases.releaseAll({ runId: 'r2' });
  if (leases.list().length !== 0) fail('releaseAll did not clear');

  ok('leaseRegistry: claim/conflict/release/validatePlan(overlap/cycle/parallelism) all green');
} catch (e) {
  fail(`leaseRegistry threw: ${e.stack || e.message}`);
}

// ---------- 3. Asset shapes ----------

section('4. migration 009 / 010 + prompt MDs');

function grepFile(rel, patterns) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) { fail(`missing: ${rel}`); return; }
  const text = readFileSync(path, 'utf8');
  for (const [name, re] of patterns) {
    if (!re.test(text)) fail(`${rel} missing ${name} (/${re.source}/)`);
    else ok(`${rel}: ${name}`);
  }
}

grepFile('supabase/migrations/009_swarm_channel.sql', [
  ['create table swarm_channel_events', /create table.*swarm_channel_events/i],
  ['kind CHECK constraint',            /check.*\(kind in/i],
  ['enable row level security',        /enable row level security/i],
  ['supabase_realtime publication',    /alter publication supabase_realtime/i],
]);

grepFile('supabase/migrations/010_swarm_audit_categories.sql', [
  ['memories.type widen DO block',     /do \$\$/i],
  ['audit token in widened set',       /'audit'/i],
]);

grepFile('mcp-server/prompts/orchestrator.md', [
  ['references flowade_validate_plan', /flowade_validate_plan/],
  ['references kind=plan',             /kind\s*[:=]\s*['"`]?plan/i],
  ['references parallelism factor',    /parallelism/i],
  ['references re-plan budget',        /re-?plan budget/i],
]);

grepFile('mcp-server/prompts/worker.md', [
  ['references flowade_claim_file',    /flowade_claim_file/],
  ['references flowade_release_file',  /flowade_release_file/],
  ['references kind=intent',           /kind\s*[:=]\s*['"`]?intent/i],
  ['references isCrossRun handling',   /isCrossRun|cross-run/i],
  ['references rate-limit handling',   /rate.?limit/i],
]);

grepFile('mcp-server/prompts/user_pane.md', [
  ['references flowade_swarm_start',   /flowade_swarm_start/],
  ['workerCount = N (no +1 rule)',     /never\s+add\s+\+?1|workerCount[^.]*exactly/i],
  ['SWARM_UNAVAILABLE handling',       /SWARM_UNAVAILABLE/],
]);

// ---------- report ----------

section('summary');

if (failures.length > 0) {
  process.stderr.write(`\n✗ SMOKE FAILED with ${failures.length} issue(s):\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}

note('Electron-dependent modules (swarmChannel, swarmAudit, swarmOrchestration) were syntax-checked only.');
note('A live-bridge smoke under `electron .` would exercise swarm.start → cancel end-to-end; deferred to morning manual verify.');
process.stdout.write('\n✓ SMOKE ✓ — all syntactic, registry, migration, and prompt assertions pass\n');
process.exit(0);
