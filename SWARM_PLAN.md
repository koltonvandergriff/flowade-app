# Phase 5 — Swarm Orchestration Plan

**Started:** 2026-05-14
**Branch:** `phase-5-swarm` (worktree at `C:\Users\kolto\Desktop\Claude\FlowADE-app-swarm`)
**Source branch:** `feature/glasshouse-tokens` @ `887bd06` (Phase 4m baseline)
**Goal:** Add multi-agent swarm orchestration to FlowADE — natural-language invocation, N+1 topology (orchestrator auto-added), file-lease + contract-first cohesion, end-of-run summary to user pane.

---

## Topology

```
PAGE (16 panes hard cap)
└─ Team A: 👤 User → spawns 👑 Orch + 🤖 W1 ... 🤖 Wn   (n = user-specified, 1 orchestrator auto-added)
└─ Team B: ... (up to 4 teams concurrent, capacity permitting)
```

**Caps:**
- `maxConcurrentSwarmsPerPage` = 4 (default), 1-4 slider
- `maxWorkersPerSwarm` = 8 default, 1-14 hard cap, soft-warn >4
- Total panes per page = 16 hard
- One swarm per user pane; further `/swarm`-equivalents queue
- `requirePlanConfirm` = ON (orchestrator pauses for user yes/no after planning)

---

## Invocation

**No slash command.** User-pane agent maps natural prose → `flowade_swarm_start` MCP call.

Example utterances → tool calls in `mcp-server/prompts/user_pane.md` (Stage 12).

Rule: user says N → tool called with `workerCount: N` → tool internally spawns N+1 panes (orch + N workers). NEVER double-add the +1.

---

## Cohesion mechanics (hard + soft)

| Layer | Mechanism | Strength |
|---|---|---|
| Hard | File-lease registry (global, cross-run aware) | Two workers cannot write the same file |
| Hard | Plan-time `expectedFiles` overlap check (orchestrator must declare upfront) | Plan rejected if any two subtasks share files |
| Hard | Contract-first commits (stubs land BEFORE workers spawn) | Type/signature drift eliminated |
| Hard | Dependency graph dispatch in topological waves (only when deps exist) | Order violations prevented |
| Hard | Parallelism floor ≥0.75 (largest wave / total workers) | Plan rejected if too serial — protects "5 agents working as 1" failure |
| Soft | Shared channel — kind=intent/progress/blocker/diff/done/review-fail | Workers see siblings' work in flight |
| Soft | Orchestrator pre-merge review per worker diff (contract + dedupe + sibling-conflict scan) | Catches semantic drift |
| Soft | Re-plan budget = 1 per run | One mid-run correction if blockers indicate drift |
| Soft | Rate-limit detection in worker prompt | Pause + retry after window, surface to user |

---

## MCP tool surface (additive — zero edits to existing 9 tools)

| # | Tool | Purpose |
|---|---|---|
| 1 | `flowade_swarm_start` | Spawn orch + N workers, return runId + IDs |
| 2 | `flowade_swarm_finish` | Mark run done, post summary to user pane |
| 3 | `flowade_swarm_confirm` | User yes/no decision relay |
| 4 | `flowade_swarm_cancel` | Tear down team, release leases, summary |
| 5 | `flowade_swarm_post` | Append to channel |
| 6 | `flowade_swarm_read` | Tail channel with filters |
| 7 | `flowade_claim_file` | Acquire write lease (returns conflict + runId on collision) |
| 8 | `flowade_release_file` | Release lease |
| 9 | `flowade_list_leases` | Snapshot leases (path / runId filters) |
| 10 | `flowade_validate_plan` | Plan-time overlap + parallelism-floor check |
| 11 | `flowade_spawn_terminal` | Low-level pane spawn (used internally) |
| 12 | `flowade_list_terminals` | Pane snapshot (filters: workspace, ownerType, state) |
| 13 | `flowade_send_to_terminal` | Write text to pane PTY |
| 14 | `flowade_read_terminal` | Tail PTY output (token-paginated) |
| 15 | `flowade_wait_terminal` | Long-poll until state transition |
| 16 | `flowade_kill_terminal` | Terminate pane |

---

## Auth + cost model

Each pane is a real `claude` CLI process. Inherits whatever auth the user logged Claude Code in with — Pro/Max subscription or API key. FlowADE does not proxy inference. User-parity guaranteed.

Internal automation (memory categorization, embeddings) keeps using `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from keychain — untouched by swarm.

---

## Stage table

Each stage: build → unit/sanity check → `npx vite build` smoke → commit on green → next.

| # | Stage | Status | Gate | Last good commit |
|---|---|---|---|---|
| 1 | Pre-flight (commit 4m, worktree, baseline) | ✓ DONE | `887bd06` Phase 4m pushed. vite build green 2.92s. Worktree created. | `887bd06` |
| 2 | Pane registry + ring buffer (`electron/paneRegistry.js`) | ✓ DONE | vite build green 2.38s; node --check passes; ESM module; not yet wired into ptyManager | `f74531f` |
| 3 | WS bridge server + auth token (`electron/swarmBridge.js`) | ✓ DONE | vite build green 2.37s; node --check passes; gated by settingsStore.swarm.allowAgentSpawn; standalone, not yet wired into main.js | `b4d2118` |
| 4 | MCP swarm client (`mcp-server/swarmClient.js`) | ✓ DONE | vite build green 2.33s; node --check passes; lazy connect; SWARM_UNAVAILABLE error code on missing bridge/token; not wired into index.js yet | `02a46e1` |
| 5 | MCP terminal tools (6) (`mcp-server/tools/terminal.js`) | ✓ DONE | vite build green; node --check passes; bridge handlers separated into electron/swarmTerminalHandlers.js for clean wiring | `3238bb5` |
| 6 | File-lease registry + claim/release/list/validate_plan | ✓ DONE | vite build green; cross-run conflict surfaces isCrossRun flag; validatePlan computes parallelismFactor + waves | `81534da` |
| 7 | Swarm channel + post/read + migration 009 | ✓ DONE | vite build green; migration idempotent; local 1k buffer + cloud fallback; realtime publication added | `516b549` |
| 8 | Audit + migration 010 | ✓ DONE | vite build green; 7 audit + 2 run helpers; memoryStore injected via setMemoryStore to dodge circular import; type CHECK widened idempotently | `1c03380` |
| 9 | swarm_start / _finish / _confirm / _cancel | ✓ DONE | vite build green; +1 orchestrator added internally; teamId auto-picked from A-D; 16-pane capacity enforced; releaseAll on cancel | `a2c8e32` |
| 10 | Orchestrator prompt template | ✓ DONE | 7-phase playbook with validate_plan gate + re-plan budget 1 + soft-warn at N>4 | `65c019a` |
| 11 | Worker prompt template | ✓ DONE | 13-step protocol; intent-then-claim-then-edit; cross-run vs intra-run blocker handling distinct | `65c019a` |
| 12 | User-pane agent prompt snippet | ✓ DONE | Phrase-to-tool table; workerCount = user's N (never +1); SWARM_UNAVAILABLE relay | `65c019a` |
| 13 | Frontend badges + tints + Reclaim | ✓ DONE | vite build green; PaneBadge + swarmTheme additive; TerminalGrid wiring left for user review (no existing file modified) | `66c7288` |
| 13b | Settings toggle + caps + SwarmOverlay | ✓ DONE | vite build green; SwarmOverlay (4-tree, ESC close) + SwarmSettingsPanel (master toggle + 2 sliders + plan-confirm toggle); SWARM_SETTING_KEYS exported | `f9b75f8` |
| 14 | End-to-end DRY smoke (no real worker code) | ✓ DONE | scripts/smoke-swarm.js green; node --check on 13 new modules; paneRegistry + leaseRegistry exercised in-process; migrations + prompt MDs grep-validated; Electron-dependent modules syntax-only (live bridge smoke deferred to morning) | `53fca07` |

---

## Stop conditions (loop halts → silent)

- `npx vite build` red after any stage
- Two consecutive build/test reds on same stage
- Bridge or MCP startup error not recovered in 3 retries
- Total wall time > 6h from first tick
- Stage 14 smoke fails
- User-pane / orchestrator / worker prompt validation fails

On halt: append reason + last-good commit + recent stderr to `## Halt log` section below. Push branch. Stop.

---

## Halt log

_(empty — append on halt)_

---

## Operator notes (after run)

- Worktree path: `C:\Users\kolto\Desktop\Claude\FlowADE-app-swarm`
- Branch: `phase-5-swarm` (off `feature/glasshouse-tokens` @ `887bd06`)
- Resume: `cd FlowADE-app-swarm && git log --oneline` to see progress, `cat SWARM_PLAN.md` to see current stage status
- If green through Stage 14: PR `phase-5-swarm` → `main` opened automatically (gh authed)
- Halt: branch pushed, PR NOT opened, see Halt log above
