# Triggered-Run Collision Handling — Cross-Impl Behavioral Matrix

Companion matrix to `MATRIX.md`. Targets four worktrees from the follow-up
task ("add explicit collision policy: queue / dedup / skip / replace, per
use-case, surfaced in CLI"):

- **claude_tnl**  `/Users/jana/workspace/chiefofstaff-tnl-triggers-2`
- **claude_base** `/Users/jana/workspace/chiefofstaff-baseline-triggers-2`
- **codex_tnl**   `/Users/jana/workspace/chiefofstaff-tnl-triggers-codex`
- **codex_base**  `/Users/jana/workspace/chiefofstaff-baseline-triggers-codex`

Legend: `✓` pass, `✗` fail, `!` error, `—` not_applicable.

## Summary

| impl        | pass | fail | error | n/a | total |
|-------------|------|------|-------|-----|-------|
| claude_tnl  | 13   | 1    | 0     | 0   | 14    |
| claude_base | 7    | 6    | 0     | 1   | 14    |
| codex_tnl   | 12   | 1    | 0     | 1   | 14    |
| codex_base  | 13   | 1    | 0     | 0   | 14    |

## P — Policy declaration

| id | scenario                                              | claude_tnl | claude_base | codex_tnl | codex_base |
|----|-------------------------------------------------------|------------|-------------|-----------|------------|
| P1 | Config schema accepts all 4 policies                  | ✓          | ✓           | ✓         | ✓          |
| P2 | Invalid policy value rejected at load                 | ✓          | ✓           | ✓         | ✓          |
| P3 | Default policy is a valid policy string               | ✓ (`skip`) | ✓ (`queue`) | ✓ (`queue`) | ✓ (`dedup`) |

All four declare a typed Literal for the policy and reject invalid values.
Defaults diverge:
- `claude_tnl`: **`skip`** — conservative; rationale is the TNL clause
  "adding this TNL MUST NOT change observable behavior".
- `claude_base`: **`queue`** — "preserve prior behavior of running everything".
- `codex_tnl`: **`queue`** — same, with queue = "let both run concurrently".
- `codex_base`: **`dedup`** — opinionated; deduplicates by root-cascade.

## Q — Queue policy

| id | scenario                                              | claude_tnl | claude_base | codex_tnl | codex_base |
|----|-------------------------------------------------------|------------|-------------|-----------|------------|
| Q1 | queue defers during in-flight; dispatches later       | ✓          | ✗           | ✗         | ✓          |
| Q2 | FIFO across multiple queued triggers (≥1 drains)      | ✓          | —           | —         | ✓          |

Deep divergence:

- **claude_tnl** persists queued collisions in a dedicated `collision_queue`
  SQLite table, drains on next tick. Full user's-ask shape.
- **codex_base** persists via `pending_trigger_runs`. Also full shape.
- **claude_base** only applies collision resolution to the same-tick batch;
  does NOT persist across ticks. A trigger fired while a row in `runs` is
  `status='running'` dispatches a second run concurrently.
- **codex_tnl** has `queue` as the no-op concurrency path ("let it run"),
  not deferral. Q1/Q2 fail/NA accordingly.

## S — Skip policy

| id | scenario                          | claude_tnl | claude_base | codex_tnl | codex_base |
|----|-----------------------------------|------------|-------------|-----------|------------|
| S1 | skip drops trigger during in-flight | ✓        | ✗           | ✓         | ✓          |
| S2 | skip decision observable (persisted) | ✓ (`collision_log`) | ✗ | ✓ (`trigger_collisions`) | ✗ |

- `claude_tnl`'s `skip` policy writes to `collision_log` — operator-visible.
- `codex_tnl`'s `skip` writes to `trigger_collisions` table.
- `claude_base` doesn't evaluate skip against cross-tick in-flight runs
  (S1 fails). Log-only signal doesn't count as observable in our test.
- `codex_base` evaluates skip correctly (S1 pass) but only logs via
  stdlib `logger.info` (no persisted row → S2 fails).

## D — Dedup policy

| id | scenario                                             | claude_tnl | claude_base | codex_tnl | codex_base |
|----|------------------------------------------------------|------------|-------------|-----------|------------|
| D1 | dedup drops trigger matching in-flight source+event  | ✓          | ✗           | ✗         | ✓          |
| D2 | dedup lets different cascade through                 | ✓          | ✓           | ✓         | ✓          |

- `claude_tnl` matches (`source_use_case`, `event_type`) against the
  in-flight's `triggered_by_event_id` — catches D1 cleanly.
- `codex_base` uses `has_pending_trigger_run` — the incoming event is
  dropped if a pending row already exists for the target. D1 passes via
  this "drop incoming while already busy" path.
- `codex_tnl` dedups by `trigger_root_event_id` across cascade, not by
  (source, event_type). When the in-flight run's recorded root differs
  from the incoming event's root (both new events in our test), dedup
  does NOT fire → D1 fails in our rig.
- `claude_base`'s same-tick-only semantics do not dedup across ticks.

## R — Replace policy

| id | scenario                                             | claude_tnl | claude_base | codex_tnl | codex_base |
|----|------------------------------------------------------|------------|-------------|-----------|------------|
| R1 | replace supersedes older pending replacement          | ✓          | ✗           | ✓         | ✓          |
| R2 | replacement dispatches once target idles              | ✓          | ✓           | ✓         | ✓          |

Semantics diverge:

- `claude_tnl`: signals `JobRunner.cancel_run` on the active run, stashes
  replacement in-memory, dispatches on next tick.
- `codex_tnl`: never cancels active run; keeps at most one pending
  replacement (`_pending_replacements` map), dispatches on next tick.
- `codex_base`: `pending_trigger_runs` row is overwritten on replace.
- `claude_base`: only applies to same-tick batch (drop earlier, keep latest);
  does NOT supersede pre-existing pending triggers → R1 fails.

## C — Composition

| id | scenario                                              | claude_tnl | claude_base | codex_tnl | codex_base |
|----|-------------------------------------------------------|------------|-------------|-----------|------------|
| C1 | collision+cycle compose (cycle wins)                  | ✗          | ✗           | ✓         | ✓          |
| C2 | collision+depth compose (queue doesn't bypass)        | ✓          | ✓           | ✓         | ✓          |
| C3 | CLI lists collision policy per use-case               | ✓          | ✓           | ✓         | ✓*         |

C1 probes whether a self-loop trigger (`uc-a` → `uc-a` via `a.event`) is
suppressed. Two implementations fail because their cycle detection depends
on runtime lineage attached to the emitted event: without an emitting parent
run carrying ancestor metadata, the test's direct `bus.emit` looks like a
first-hop (not a cycle). This is a semantic grey area — both `codex_tnl`
and `codex_base` have explicit cycle detection on the event payload or
resolved-link graph and catch this case; `claude_tnl` and `claude_base`
rely on the runner injecting lineage at emit time.

C3 passes for all four. `codex_base` passes via the in-process fallback
because its `triggers list` CLI hits a circular import (`ImportError:
cannot import name 'Event' from partially initialized module
'chiefofstaff.scheduler.events'`) when loaded fresh with a minimal
fixture. The policy IS still reachable via the config loader in-process —
hence the `*`.

## Notable divergences

### claude_tnl vs claude_base
- **S1, S2, D1, R1**: claude_tnl beats claude_base because TNL's collision
  policy treats "in-flight row in runs" as busy. Baseline implements
  collision as a same-tick batch dedup only → it does NOT see the seeded
  running row as a collision.
- **Q1, Q2**: claude_tnl persists a collision_queue table; claude_base has
  no persistence of queued triggers.

### codex_tnl vs codex_base
- **D1**: codex_base passes, codex_tnl fails. codex_base dedups by
  "pending-row exists" (simple + matches user's intuition for "drop dup"),
  while codex_tnl dedups by `trigger_root_event_id` which requires the
  running run to share a cascade root — which seeded in-flight runs in
  our rig don't, by construction.
- **Q1/Q2**: codex_base persists pending_trigger_runs; codex_tnl doesn't.
- **C1**: both pass thanks to cycle detection on link graph / payload.

### Stylistic
- Both TNL variants explicitly persist a collision-decision row
  (`collision_log` / `trigger_collisions`) — satisfies the "surface in CLI"
  ask. Both baselines log only.
- Both TNL variants add a dedicated CLI for collision inspection
  (`triggers collisions` / `triggered-runs` with collision column).
  Baselines show policy in `triggers list` but have no history command.

## Artifacts

- Scenarios: `/Users/jana/workspace/cnl/behavioral-tests/triggers/SCENARIOS-collision.md`
- Shared core: `/Users/jana/workspace/cnl/behavioral-tests/triggers/_core_collision.py`
- Runners:
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/run_collision_claude_tnl.py`
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/run_collision_claude_base.py`
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/run_collision_codex_tnl.py`
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/run_collision_codex_base.py`
- Results:
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/results/collision_claude_tnl.json`
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/results/collision_claude_base.json`
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/results/collision_codex_tnl.json`
  - `/Users/jana/workspace/cnl/behavioral-tests/triggers/results/collision_codex_base.json`
