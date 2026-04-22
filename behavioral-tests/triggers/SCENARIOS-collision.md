# Triggered-Run Collision Handling — Behavioral Matrix

Companion matrix to `SCENARIOS.md`. Targets four worktrees, evaluating the
follow-up task:

> "When a triggered run fires for a use-case that's already running (cron or
> prior trigger), what happens today isn't specified. Add explicit collision
> policy: choose between queue / dedup / skip / replace, configurable per
> use-case. Surface the choice in CLI. Composes with cycle, depth, and rate
> guards."

Worktrees:

| label | path | default policy | policies implemented | queue mechanism |
|---|---|---|---|---|
| claude_tnl  | `chiefofstaff-tnl-triggers-2`        | `skip`  | skip/dedup/queue/replace | `collision_queue` SQLite table |
| claude_base | `chiefofstaff-baseline-triggers-2`   | `queue` | skip/dedup/queue/replace | same-tick batch filter (NOT cross-tick) |
| codex_tnl   | `chiefofstaff-tnl-triggers-codex`    | `queue` | skip/dedup/queue/replace | `queue` is concurrent; `replace` uses in-memory pending map |
| codex_base  | `chiefofstaff-baseline-triggers-codex` | `dedup` | skip/dedup/queue/replace | `pending_trigger_runs` SQLite table |

Each scenario records `{scenario_id, category, title, status, expected,
observed, notes, traceback}`. `status` ∈ `{pass, fail, error, not_applicable}`.

---

## P — Policy declaration (3)

| id | title | expected |
|---|---|---|
| P1 | Config schema accepts all 4 policies per use-case | `schedule.collision_policy` (or impl's equivalent) accepts each of `queue`, `dedup`, `skip`, `replace` without error; policy is surfaced on the loaded UseCaseConfig |
| P2 | Invalid policy value is rejected at config load | A use-case YAML with `collision_policy: banana` fails to load (ValidationError / ConfigLoadError); error mentions the offending value or use-case |
| P3 | Undeclared policy uses a documented default | A use-case YAML with no collision_policy field loads cleanly; `uc.schedule.collision_policy` (or equivalent) returns a valid policy string |

## Q — Queue policy (2)

| id | title | expected |
|---|---|---|
| Q1 | Trigger during in-flight run with `queue` policy is deferred + dispatched later | With an in-flight run present for target T, a new trigger for T with policy=queue does NOT double-dispatch; after the in-flight run clears and the daemon ticks, the queued trigger dispatches |
| Q2 | Multiple queued triggers preserve FIFO order across ticks | With policy=queue, enqueue 3 triggers while T is busy; after T idles, they dispatch in arrival order |

## S — Skip policy (2)

| id | title | expected |
|---|---|---|
| S1 | Trigger during in-flight with `skip` is dropped | Target T has a running run; new trigger for T with policy=skip does NOT dispatch; nothing queued |
| S2 | Skip decision is observable (log record, CLI row, or persisted metadata) | Skipped trigger leaves a trace — either a log event, a `collision_log` / `trigger_collisions` row, a persisted collision_decision field, or an equivalent operator-visible signal |

## D — Dedup policy (2)

| id | title | expected |
|---|---|---|
| D1 | Trigger during in-flight with `dedup`, where the in-flight was started by the SAME source/cascade, is dropped | A running run triggered by `(source=S, event_type=E)`; a fresh trigger from the same `(S, E)` with policy=dedup drops, does not duplicate the work |
| D2 | Trigger during in-flight with `dedup`, where the in-flight was started by a DIFFERENT source/cascade, proceeds (or queues) | A running run triggered by `(S1, E1)`; a fresh trigger `(S2, E2)` with policy=dedup is NOT silently dropped — it either queues, proceeds, or is otherwise handled without treating the two events as duplicates |

## R — Replace policy (2)

| id | title | expected |
|---|---|---|
| R1 | Trigger during in-flight with `replace` supersedes pending/stale triggers for the same target | Given a target with a replaceable pending trigger, a subsequent trigger with policy=replace supersedes the older pending entry (only the newest survives). Active/in-flight runs MAY or MAY NOT be cancelled — both interpretations are honored by the test |
| R2 | Replacement eventually dispatches the newest trigger once the target is idle | After the in-flight run clears, the replacement trigger dispatches with its event data (not the superseded one) |

## C — Composition (3)

| id | title | expected |
|---|---|---|
| C1 | Collision check composes with cycle detection (cycle wins) | A trigger that would form a cycle is rejected before collision evaluation; collision policy does NOT override the cycle guard |
| C2 | Collision check composes with depth cap (depth wins) | A trigger past the cascade depth cap is rejected before collision evaluation; policy=queue does NOT queue work that should never run |
| C3 | Collision reaches CLI surface (list/recent) | At least one CLI command (e.g., `triggers list` or `list-triggers`) surfaces the target's `collision_policy` value per use-case. Exit code 0 and policy string appears in stdout |

---

## Counts

- Categories: 6
- Scenarios: 14

## Ground rules

- A worktree's impl that genuinely chose a different policy semantic (e.g.,
  `queue` = let-it-run-concurrently rather than FIFO-defer) is NOT
  force-failed. The expected column above uses the user's ask (defer +
  dispatch later) as the baseline; narrower interpretations are recorded as
  divergences in `MATRIX-collision.md`.
- Scenario `Q2` is marked `not_applicable` for impls that don't queue across
  tick boundaries (claude_base's batch-only filter; codex_tnl's queue-as-noop).
- Runners are read-only against worktrees — no edits.
