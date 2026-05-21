# Overnight Report — 2026-05-21

Started:  2026-05-21T05:37:08Z
Finished: 2026-05-21T06:04:33Z (~27 minutes wall-clock)

## Completed (all on phase-5-swarm unless noted)

- [x] Task 1 — Lifecycle state machine + error taxonomy + on-start recovery. Commit: `dd091e6`
- [x] Task 2 — Server-side Phase 7 summary validation + orchestrator.md callout. Commit: `457bf6c`
- [x] Task 3 — swarmChannel race-condition regression test (vitest wired up). Commit: `764eb88`
- [x] Task 4 — Swarm Runs UI polish (empty/error/skeleton, sort + search + keyboard). Commit: `72ebeaf`
- [x] Task 5 — Read-only agent panes + Force-input escape hatch. Commit: `9fbd72e`
- [x] Task 6 — "Inject note to swarm" pane action + orchestrator nudge. Commit: `da97dd3`
- [x] Task 7 — Configurable swarm transcript auto-purge retention. Commit: `3b09056`
- [x] Task 8 — `docs/swarm.md` architecture reference. Commit: `fec6902`
- [x] Task 9 — Glasshouse tokens refactor (other worktree, `feature/glasshouse-tokens`):
  - `baad7c9` SideNavGlasshouse
  - `820b248` HeaderGlasshouse
  - `b5ed872` NotificationCenter

## Blocked / Skipped

None — every task on the list landed and pushed.

## Notes for review

- **Tests pass.** `npm test` runs vitest against the new
  `electron/__tests__/swarmChannel.race.test.js` — both scenarios
  (4-way concurrent post + stale-counter dup-key recovery) are green.
  The supabase client is mocked at the module level so no real network
  hits.
- **Build is clean.** `npx vite build` succeeds at every commit on
  phase-5-swarm and on the three Glasshouse-tokens commits. The same
  500 kB chunk-size warning that was there before is still there —
  unrelated to this work.
- **No schema changes.** Confirmed `_bundle.sql` and `supabase/migrations/`
  are untouched. The new lifecycle states live in `meta.json` (file-backed
  transcript store), not in any DB table.
- **State machine soft-enforces.** `transition()` warns on illegal edges
  (e.g. DONE → PLANNING) but applies them anyway, so a misbehaving
  model can't brick a prod run. Worth keeping an eye on the console for
  any `[swarm:transition] illegal transition` log lines in the morning —
  none expected, but they're the breadcrumb.
- **Force input on agent panes** is gated behind the hamburger menu
  with a visible `FORCE INPUT ON` chip when active. The xterm
  `disableStdin` toggles at runtime via the new effect — no remount
  needed.
- **Inject-note IPC** is a new entry point for the renderer:
  `window.flowade.swarm.channel.post`. The MCP bridge has the same
  surface for agents; the renderer version is gated for user panes
  acting as active swarm roots (the menu item only renders then, and
  the runId is resolved via the new `swarm:listActiveRuns` IPC).
- **Purge safety.** `purgeOldRuns` only deletes runs whose
  `meta.status` is in the terminal set (`done`, `done-with-warnings`,
  `cancelled`, `failed`, `crashed`) AND whose dir mtime is older than
  retention. An in-flight run is never deleted even if its dir mtime
  somehow drifted.
- **Tokens refactor scope.** Bounded to 3 components (SideNav, Header,
  NotificationCenter) per the task spec's "stop after 3" rule. Each
  pulls from `tokens.css`; new tokens added: cy/gn alpha ramps,
  hover-overlay neutrals, sidenav gradient endpoints, type-size
  ladder, mint + ink-divider greys, glass-strong/bar surfaces. Visual
  diff intended to be zero across all three.
- **Memory file** at `~/.claude/projects/.../memory/project_flowade_swarm.md`
  is now stale — the "What's actually shipped vs roadmap" table and
  "Soft known issues" still describe the pre-overnight state. Worth a
  follow-up update once the user reviews + accepts these commits.

## Files added this overnight

```
electron/swarmStates.js
electron/swarmErrors.js
electron/swarmRecovery.js
electron/__tests__/swarmChannel.race.test.js
vitest.config.js
docs/swarm.md
OVERNIGHT_REPORT.md     (this file)
```

## Push status

All commits are on `origin/phase-5-swarm` and `origin/feature/glasshouse-tokens`.
No force-pushes, no amends, no hook skips.
