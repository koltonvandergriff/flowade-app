# Swarm Orchestration — Architecture Reference

This document is the source of truth for how the FlowADE swarm runs. It
covers the layout of the pieces that move, the protocol they speak, the
state machine that holds them together, and the recovery semantics that
keep half-finished runs from poisoning the UI. If you're adding a new
MCP tool, debugging a stuck orchestrator, or wondering why a run ended
in `done-with-warnings`, start here.

## 1. Architecture at a glance

A swarm is a team of co-located terminal panes spawned in one workspace.
One pane is the **orchestrator**; one to four are **workers**; one is
the **user pane** that triggered the run. All four communicate over a
single Postgres-backed event channel keyed by `runId`.

```
                ┌─────────────────────────────────────────────┐
                │             User pane (ownerType=user)      │
                │   (drives the swarm via MCP tool calls)     │
                └──────────────────────┬──────────────────────┘
                                       │ flowade_swarm_start
                                       ▼
              ┌────────────────────────────────────────────────┐
              │ electron/swarmOrchestration.js  start()        │
              │  · resolves provider (claude/aider/…)          │
              │  · picks a team letter (A/B/C/D)               │
              │  · pre-allocates N+1 pane ids                  │
              │  · registers panes in paneRegistry             │
              │  · writes a meta.json under                    │
              │    {userData}/flowade-data/swarm-transcripts/  │
              │  · subscribes to the run's channel for nudges  │
              │  · posts the initial kind=plan + auto-confirm  │
              └─────────────┬──────────────────┬───────────────┘
                            │                  │
                            ▼                  ▼
            ┌─────────────────────┐   ┌─────────────────────┐
            │  Orchestrator pane  │   │     Worker panes    │
            │  (ownerType=orch)   │   │  (ownerType=agent)  │
            │  · reads channel    │   │  · receive dispatch │
            │  · validates plan   │   │    via terminal     │
            │  · dispatches       │   │    write            │
            │  · reviews diffs    │   │  · post kind=done   │
            │  · posts summary    │   │    with diff path   │
            └──────────┬──────────┘   └──────────┬──────────┘
                       │                         │
                       └──────────┬──────────────┘
                                  ▼
                ┌─────────────────────────────────┐
                │  swarm_channel_events (cloud)   │
                │  (run_id, token_id) unique key  │
                │  + EventEmitter event:run:<id>  │
                └─────────────────────────────────┘
```

Three persistence stores back this:

| Store | Path | Contents |
|---|---|---|
| Channel events | Supabase table `swarm_channel_events` | Append-only event log keyed by `(run_id, token_id)`. Single source of truth for plan / progress / diff / done / finish posts. |
| Transcript archive | `{userData}/flowade-data/swarm-transcripts/{runId}/` | Per-run dir: `meta.json` (status, summary, panes) + one `.log` per terminal (raw pty bytes). |
| Memory audit | Memory store (cloud) `type=audit`, category `Swarm/Audit` | Spawn / kill / claim / cancel / state-transition events, surfaced in the user's vault. |

## 2. Channel protocol

`electron/swarmChannel.js` defines the wire format. Every event is a
row in `swarm_channel_events`:

```
{ run_id, worker_id, kind, payload, token_id, posted_at }
```

`token_id` is a per-run monotonic integer allocated in
`_postOnce`. Concurrent posts to the same run are serialized via a
per-`runId` promise chain in `_postChain`; if a dup-key still slips
through (stale local counter after a process restart),
`_resyncNextToken` re-reads the DB max and the retry succeeds.

### Event kinds

| Kind | Who posts | Meaning |
|---|---|---|
| `plan` | `system` (run open), then `orchestrator` | The initial run shape (task, workerCount, teamId). Orchestrator's repost is the validated plan with `subtasks`, `contracts`, `mergeOrder`. |
| `intent` | worker | Worker declares what file/range it's about to write. Lets siblings detect collisions early. |
| `claim` | worker | File lease grab through `leaseRegistry`. |
| `progress` | any | Free-form note. `workerId='user'` + `payload.source='user-inject'` is the "Inject note to swarm" pane action; the orchestration listener nudges the orchestrator pty with the note. |
| `blocker` | worker / orchestrator / system | Something stopped a worker. `payload.reason` keys: `cross-run`, `rate-limit`, `low-parallelism`, `workers-silent`, `unplannable`, `edit-loop`. |
| `diff` | orchestrator | Per-worker review summary. Posted after Phase 5 review passes. |
| `done` | worker | Worker reports complete. Optional `payload.diffPath`, `payload.testsRun`, `payload.testsPassed`. |
| `review-fail` | orchestrator | Worker's diff failed Phase 5 review (or the orchestrator's own summary failed Phase 7 validation). `payload.notes` explains. |
| `cancel` | system / user | Run cancelled. `payload.reason` is the human label. |
| `finish` | orchestrator | Run done. `payload.summary` is the markdown the user pane will see. `payload.crashed: true` is what `swarmRecovery.recoverOrphans` posts for runs marked CRASHED on startup. |

### Polling discipline

Orchestrators tail the channel via `flowade_swarm_read`. **Do not**
insert `sleep`, `Monitor`, or `setTimeout` between reads — each one
triggers a permission prompt that stalls the run waiting on human
approval. Back-to-back reads with the latest `sinceTokenId` are the
sanctioned pattern. The orchestrator.md prompt enforces this.

## 3. State machine

States are defined in `electron/swarmStates.js`. Every run lives in
exactly one state at a time; `writeRunMeta` persists it under
`meta.json`. The full list:

```
CREATED → AWAITING_CONFIRM → PLANNING → DISPATCHING → WORKING
                              ↓             ↓           ↓
                              └──────┬──────┴───────────┘
                                     ▼
                                REVIEWING → SUMMARIZING → DONE
                                                  ↓
                                                  └────→ DONE_WITH_WARNINGS

  (universal exits, reachable from any non-terminal state)
   CANCELLED   FAILED   CRASHED
```

Terminal states (`TERMINAL_STATES` in `swarmStates.js`):

- `done` — Phase 7 summary passed validation, file integrity check
  passed, run closed cleanly.
- `done-with-warnings` — summary accepted but at least one of:
  required Phase 7 field missing after the retry budget,
  or `Files (...):` bullets listed paths that don't exist on disk.
  `meta.summaryWarnings` and `meta.integrityIssues` carry the detail.
- `cancelled` — `flowade_swarm_cancel` or `confirm({decision:'cancel'})`.
- `failed` — `swarmErrors.handle({ severity: 'fail' })` — disk error,
  channel down, unrecoverable.
- `crashed` — set by `swarmRecovery.recoverOrphans` for non-terminal
  runs whose `meta.updatedAt` is older than 1h on app boot.

The state machine is enforced softly: `transition()` warns on illegal
edges (e.g. `DONE → PLANNING`) but applies them anyway. A model glitch
shouldn't be able to brick a production run; the warning gives us a
breadcrumb in the console.

## 4. Error taxonomy

`electron/swarmErrors.js` defines the kinds + severities. The handler
posts to the channel, transitions the state, and writes an audit
memory — in that order, with each step wrapped in its own try/catch so
a downstream failure can't swallow an upstream one.

| Kind | Severity | What handle() does |
|---|---|---|
| `worker-stuck` | retry | blocker post, state unchanged |
| `worker-crashed` | escalate | blocker post, state unchanged (human decides) |
| `channel-down` | fail | (channel post skipped) state → FAILED |
| `orchestrator-silent` | escalate | blocker post |
| `pane-closed` | escalate | blocker post |
| `disk-error` | fail | blocker post, state → FAILED |
| `network-down` | retry | blocker post |
| `unrecoverable` | fail | blocker post, state → FAILED |
| `summary-invalid` | retry | blocker post (orchestrator gets re-nudged in finish() itself) |

`cancel`-severity routes don't fire from `handle()` directly today;
user cancels flow through `swarm.cancel()` which writes a `kind=cancel`
event and transitions to CANCELLED via the same `transition()` helper.

## 5. Transcript layout

Per-run directory under `{userData}/flowade-data/swarm-transcripts/{runId}/`:

```
{runId}/
├── meta.json                — { runId, status, task, summary, panes[],
│                                durationMs, startedAt, finishedAt,
│                                updatedAt, integrityIssues?,
│                                summaryWarnings?, … }
├── pane-abc123.log          — raw pty ring buffer for one pane
├── pane-def456.log          — …
└── …
```

`meta.json` is read by:

- `swarm:listRuns` IPC → Swarm Runs page master list
- `swarm:getRun` IPC → detail page
- `swarmRecovery.recoverOrphans` on app boot
- `purgeOldRuns` to decide whether a stale dir is safe to delete

`writeRunMeta` overlays partial updates (open at start, final at
finish/cancel) rather than overwriting, so a transition that bumps
`status` won't blank the `panes` array a finish() call already wrote.

## 6. Recovery semantics

`swarmRecovery.recoverOrphans` runs once after the swarm bridge starts
in `main.js`. For each row in `listSwarmRuns()`:

1. Skip if `status` is terminal.
2. Pick the freshest available timestamp: `updatedAt` → `lastTransitionAt` → `startedAt` → directory `mtime`.
3. If that timestamp is fresher than 1h ago, skip — the run might still be in flight.
4. Otherwise: call `transition({to: CRASHED})` and post a `kind=finish, payload.crashed: true` event to the channel (best-effort; channel failures are swallowed because the meta.json transition is the durable record).

This reconciliation is idempotent — a run already marked CRASHED is
filtered out by step 1 on subsequent boots.

## 7. Adding a new MCP tool

MCP tool definitions live in `mcp-server/tools/`. Each file exports a
factory that takes the `client` (WS bridge to the Electron main
process) and returns an array of tools. For a new tool:

1. **Define the schema.** Use Zod via `mcpDef()`. Keep names
   lowercase + snake_case starting with `flowade_`.
2. **Pick or add a bridge method.** `client.call('namespace.method', params)`
   maps to a registered handler in main.js (e.g. `swarmOrchestration`,
   `swarmChannel`, `swarmTerminalHandlers`, `leaseRegistry`).
3. **Register the handler.** If you're adding a new bridge method,
   wire it through one of the `register*Handlers` calls in main.js's
   `app.whenReady` block. The handler runs in the main process and
   has full Node access — be paranoid about params (the bridge token
   gates auth, but a malformed payload should error, not crash).
4. **Update `mcp-server/index.js`.** Add your tool factory to the
   tools list so it surfaces to the model.

For tools that call into the swarm lifecycle, prefer the existing
`flowade_swarm_*` helpers rather than poking `swarmChannel.post`
directly — the centralized helpers fire audit events the dashboard
expects.

## 8. Known limitations

- **Phase 7 model variance.** The orchestrator's summary obeys the
  shape in `mcp-server/prompts/orchestrator.md` about 70% of the time
  on Sonnet 4.6. The server-side validation in
  `swarmOrchestration.finish()` rejects + re-nudges on the first
  failure, then accepts-with-warnings after one retry to avoid an
  infinite loop. Keep an eye on the `done-with-warnings` rate in
  Swarm Runs — if it climbs above ~15%, revisit either the prompt or
  the model choice.
- **Agent pane lockdown.** The xterm `disableStdin` + bottom-input-box
  hide land on orchestrator + worker panes by default. A human can
  override via the hamburger "Force input (advanced)" toggle, but
  that's an escape hatch, not a workflow — manual writes mid-run can
  easily corrupt the orchestrator's state.
- **Provider parity.** Worker panes can spawn under any swarm-capable
  provider (claude, aider, api/openai, shell), but the orchestrator's
  prompt + tool grammar assumes a claude-shaped model. Cross-provider
  swarms work but the orchestrator's nudges are tuned for claude CLI
  output.
- **One workspace, one window.** The pane registry is process-global
  but workspaces are not — a swarm started in workspace A and viewed
  from workspace B will still post + finish correctly, but the
  visible panes only mount in their original workspace. This is by
  design; cross-workspace pane mirroring would require a deeper
  rework of `WorkspaceContext`.
- **Channel retention.** `swarm_channel_events` rows are never pruned
  server-side. Long-running deployments accumulate them indefinitely.
  The on-disk transcript store has retention (Settings → Memory),
  but the channel table doesn't — add a cron + `delete from
  swarm_channel_events where posted_at < now() - interval '90 days'`
  if it becomes a problem.

## 9. File map

Quick reference for where things live:

```
electron/
├── swarmOrchestration.js   start / confirm / cancel / finish + per-run
│                           channel listener that nudges the orchestrator
│                           between phases. Phase 7 validation lives here.
├── swarmChannel.js         Channel post/read + per-runId mutex +
│                           DB-resync retry on dup-key.
├── swarmStates.js          State enum + validTransitions + transition().
├── swarmErrors.js          Error kind enum + central handle().
├── swarmRecovery.js        Orphan recovery on app boot.
├── swarmTranscriptStore.js meta.json + transcript file layout + purge.
├── swarmAudit.js           Audit memory helpers (spawn/kill/claim/etc).
├── swarmTerminalHandlers.js MCP-side terminal spawn/read/wait.
├── paneRegistry.js         All panes (user + swarm). Ring buffer per pane.
├── leaseRegistry.js        File leases keyed by (path, runId).
└── main.js                 IPC + bridge wiring + boot-time recovery+purge.

src/components/glasshouse/
└── SwarmRunsGlasshouse.jsx Runs UI: master list, Summary/Timeline/
                           Transcripts tabs, sort + search + keyboard.

mcp-server/
├── prompts/orchestrator.md System prompt for orchestrator panes.
├── prompts/worker.md       System prompt for worker panes.
└── tools/                  swarm.js, channel.js, terminal.js, leases.js.
```
