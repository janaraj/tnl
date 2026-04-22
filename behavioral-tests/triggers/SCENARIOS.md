# Event-Driven Triggers — Behavioral Matrix

This matrix tests the "event-driven triggers" feature against three worktrees:
- **TNL**: `/Users/jana/workspace/chiefofstaff-tnl-triggers` (TNL-driven impl).
- **Baseline**: `/Users/jana/workspace/chiefofstaff-baseline-triggers` (principles-only impl).
- **Main-clean**: `/Users/jana/workspace/chiefofstaff-main-clean` (pristine base — negative control).

Ground truth is the user's ask:

> "We need event-driven triggers. Right now every use-case runs on its own cron.
> I want: when one job emits a specific event, a specific use-case should run
> automatically. For example, when `monitor-mentions` emits an event like
> `urgent-reply-needed`, `promote-volnix` should run. Add config for declaring
> these links, a CLI to list configured triggers and see recent triggered runs,
> and make sure we don't get into loops (A → B → A) or runaway cascades. This
> needs to play nicely with the existing cron scheduler."

Each row is a (category, id, title, expected) triple. Results are emitted per
worktree as JSON (see `results/*.json`) and compared in `MATRIX.md`.

---

## A — Config declaration (how triggers live in YAML)

| id | title | expected |
|---|---|---|
| A1 | `schedule.triggers` is a list of event_type strings on each use-case | Config schema accepts list[str] and exposes it on the loaded UseCaseConfig |
| A2 | An empty `schedule.triggers` is valid (non-error, default `[]`) | Empty list = no subscriptions; use-case loads cleanly |
| A3 | A use-case with `schedule.enabled: true`, empty `cron`, non-empty `triggers` is considered active for triggers | Trigger-matcher registers the use-case; cron does not |
| A4 | Global knob for max cascade depth exists and defaults to 3 | Some global config (`scheduler.triggers.max_depth` or similar) exposes a depth cap, default ≥ 3 |
| A5 | Per-use-case trigger rate-limit knob exists | Either per-use-case `max_triggered_runs_per_hour` or global `max_per_window` — the user's "runaway cascades" ask implies a rate cap |

## B — Basic triggering (event → use-case runs)

| id | title | expected |
|---|---|---|
| B1 | Exact event_type match queues the subscribed use-case | Emit an event of the registered type; the subscribed use-case shows up as a pending run with `reason='trigger'` |
| B2 | Unmatched event type queues nothing | Emit an event no one subscribes to; no pending runs |
| B3 | Two use-cases subscribed to the same event both queue | Both subscribers get a pending run when their shared event fires |
| B4 | One use-case subscribed to two event types fires on each | Two different events, both subscribed to by the same use-case, both produce a run |
| B5 | Exact string match — no wildcards | Subscriber to `monitor.mention_found` does NOT fire on `monitor.mention_found.urgent` |
| B6 | Emitting the same event twice produces two pending runs | No accidental dedup inside a single drain window |

## C — Loop prevention

| id | title | expected |
|---|---|---|
| C1 | Cycle A → B → A is broken: second hop to A is suppressed | When a run of B (triggered by A) emits an event that would trigger A again, the framework detects A in the lineage and suppresses; a `scheduler.trigger_suppressed` event (reason=cycle or equivalent) is emitted |
| C2 | Self-loop A → A is broken on first hop | A run of A emits an event mapped back to A; the re-trigger is suppressed |
| C3 | Deeper cycle A → B → C → A is broken at the third hop | C's event triggers A, which already exists in the lineage → suppressed |
| C4 | A → B and A → C (fan-out, not a cycle) is allowed | Both B and C run from the same source event; nothing suppressed |

## D — Cascade depth limit

| id | title | expected |
|---|---|---|
| D1 | Depth budget is enforced: chain within the cap runs fully | A chain of length ≤ `max_depth` runs with no suppression |
| D2 | Depth cap: chain beyond the cap is suppressed at the boundary | Chain of length `max_depth + 1` has the final hop suppressed with a depth-exceeded reason; a suppression event is persisted |
| D3 | Cascade cap per use-case: hitting the rate cap suppresses further triggers | If a use-case has been triggered N times in the trailing window, the next trigger is suppressed with a cascade/rate reason |

## E — Cron coexistence

| id | title | expected |
|---|---|---|
| E1 | Cron continues to work for use-cases with no triggers set | A cron-only use-case still fires on its schedule |
| E2 | Triggered run is distinguishable in the runs table from a cron run | The stored run carries something like `reason='trigger'` or `triggered_by_event_id` so queries can separate the two |
| E3 | Cron-vs-trigger same-tick dedup: cron wins (or a single run fires) | If the same use-case is due to fire by cron and is also triggered in the same tick, it must not double-fire — one run only |
| E4 | Cron-vs-trigger same-tick: suppressed trigger is still observable | If cron takes precedence, the dropped trigger emits a suppression event so the event isn't silently lost |

## F — CLI surfaces

| id | title | expected |
|---|---|---|
| F1 | `chiefofstaff list-triggers` command exists and exits 0 | CLI subcommand registered; no crash when invoked |
| F2 | `list-triggers` with zero use-case subscriptions prints a friendly empty message (no error) | Exit 0; stdout does not contain `traceback`/`error` |
| F3 | `list-triggers` prints one line per (use_case, event_type) subscription | With a fixture of N subscriptions, output contains each subscription pair |
| F4 | `chiefofstaff triggered-runs` CLI command exists | Subcommand registered; runs without crashing when invoked |
| F5 | `triggered-runs` prints friendly empty message on empty DB | Exit 0, stdout does not contain `traceback`/`error` |
| F6 | `triggered-runs` shows lineage for recent triggered runs (event_type + parent) | With fixture rows, output contains the event_type that caused the run and/or the parent run id |

## G — Observability / lineage

| id | title | expected |
|---|---|---|
| G1 | `Event` model carries `source_run_id` so emissions inside a run are traceable | The `Event` dataclass/model has a `source_run_id` attribute (or the runs table records `triggered_by_event_id` + events table records source_run_id) |
| G2 | Runs table is extended with trigger lineage columns (reason / parent / depth / trigger_event_id) | After migration, the runs table has fields that let you reconstruct a lineage chain |
| G3 | Suppressed triggers emit a `scheduler.trigger_suppressed` event (or equivalent observable signal) | On any suppression path (cycle, depth, cascade cap, cron-wins), a persisted event or a log signal exists so operators can see "something was suppressed and why" |
| G4 | Schema migration is idempotent on an existing DB | Running initialization twice, or on a DB created before the feature, does not error |

## H — Edge cases

| id | title | expected |
|---|---|---|
| H1 | Target use-case doesn't exist → framework doesn't crash | A subscription or suppression against an unknown use-case name logs/skips cleanly; no exception bubbles |
| H2 | Event bus listener exception does NOT wedge the daemon | One listener raising mid-emit should not prevent other listeners from firing |
| H3 | Many events in one tick don't produce infinite processing | Emitting 50 events and draining yields exactly 50 pending runs (or fewer via caps), completes in bounded time |

---

## Counts

- Categories: 8
- Scenarios: 32

Note on structure: scenarios within a category are numbered A1..An, B1..Bn,
etc. Each runner records `{scenario_id, category, title, status, expected,
observed, notes, traceback}` per scenario. Main-clean runner should show
`fail`/`error` on most scenarios (negative control) — passes there mean the
scenario doesn't actually capture the user's ask.
