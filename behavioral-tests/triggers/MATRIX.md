# Event-Driven Triggers — Cross-Impl Behavioral Matrix

Three worktrees:
- **TNL** `/Users/jana/workspace/chiefofstaff-tnl-triggers`
- **Baseline** `/Users/jana/workspace/chiefofstaff-baseline-triggers`
- **Main** `/Users/jana/workspace/chiefofstaff-main-clean` (pristine base `eb49b71`, negative control)

Legend: ✓ pass, ✗ fail, `!` error, — not_applicable.

## Summary

| impl | pass | fail | error | n/a | total |
|------|------|------|-------|-----|-------|
| TNL | 35 | 0 | 0 | 0 | 35 |
| Baseline | 29 | 6 | 0 | 0 | 35 |
| Main | 16 | 19 | 0 | 0 | 35 |

## A — Config declaration

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| A1 | schedule.triggers is list[str] | ✓ | ✓ | ✓ |
| A2 | empty triggers list is valid default | ✓ | ✓ | ✓ |
| A3 | Use-case with empty cron + triggers is registrable | ✓ | ✓ | ✓ |
| A4 | Global max cascade depth knob exists | ✓ | ✓ | ✗ |
| A5 | Trigger rate cap knob exists | ✓ | ✓ | ✗ |

## B — Basic triggering

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| B1 | exact event_type match queues use-case | ✓ | ✓ | ✓ |
| B2 | unmatched event_type queues nothing | ✓ | ✓ | ✓ |
| B3 | two subscribers both queued | ✓ | ✓ | ✓ |
| B4 | same use-case multi-subscription | ✓ | ✓ | ✓ |
| B5 | exact-match only (no wildcard/prefix) | ✓ | ✓ | ✓ |
| B6 | same event emitted twice → two runs | ✓ | ✓ | ✓ |

## C — Loop prevention

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| C1 | A→B→A cycle: re-trigger of A suppressed | ✓ | ✓ | ✗ |
| C2 | self-loop A→A suppressed | ✓ | ✓ | ✗ |
| C3 | A→B→C→A cycle suppressed at 3rd hop | ✓ | ✓ | ✗ |
| C4 | fan-out A→B, A→C both allowed | ✓ | ✓ | ✓ |

## D — Cascade depth / rate cap

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| D1 | depth-1 hop within cap runs | ✓ | ✓ | ✓ |
| D2 | max_depth+1 chain suppressed | ✓ | ✓ | ✗ |
| D3 | cascade/rate cap suppresses next trigger | ✓ | ✓ | ✗ |

## E — Cron coexistence

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| E1 | cron-only use-case still fires | ✓ | ✓ | ✓ |
| E2 | runs table distinguishes trigger vs cron | ✓ | ✓ | ✗ |
| E3 | cron-vs-trigger same-tick dedup (one run) | ✓ | ✗ | ✗ |
| E4 | suppressed trigger on cron collision observable | ✓ | ✗ | ✗ |

## F — CLI surfaces

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| F1 | list-triggers subcommand exists and exits 0 | ✓ | ✓ | ✗ |
| F2 | list-triggers empty prints friendly (no error) | ✓ | ✓ | ✗ |
| F3 | list-triggers shows every subscription | ✓ | ✓ | ✗ |
| F4 | triggered-runs subcommand exists and exits 0 | ✓ | ✗ | ✗ |
| F5 | triggered-runs empty → friendly, not error | ✓ | ✗ | ✗ |
| F6 | triggered-runs shows event_type/parent lineage | ✓ | ✗ | ✗ |

## G — Observability / lineage

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| G1 | Event model has source_run_id | ✓ | ✓ | ✗ |
| G2 | runs table has trigger lineage columns | ✓ | ✓ | ✗ |
| G3 | suppression event persisted on cycle | ✓ | ✗ | ✗ |
| G4 | Schema initialization is idempotent | ✓ | ✓ | ✓ |

## H — Edge cases

| id | scenario | TNL | Baseline | Main |
|----|----------|-----|----------|------|
| H1 | unknown target use-case doesn't crash daemon | ✓ | ✓ | ✓ |
| H2 | listener exception doesn't stop others | ✓ | ✓ | ✓ |
| H3 | 50 events → 50 pending, then queue clears | ✓ | ✓ | ✓ |

## Notable divergences (TNL vs Baseline)

### E3 — cron-vs-trigger same-tick dedup (one run)
- **TNL**: pass — uc-x runs this tick=1
- **Baseline**: fail — uc-x runs this tick=2

### E4 — suppressed trigger on cron collision observable
- **TNL**: pass — cron_wins_suppressions=1
- **Baseline**: fail — Impl does not emit a cron-wins suppression signal

### F4 — triggered-runs subcommand exists and exits 0
- **TNL**: pass — rc=0; out='No triggered runs recorded yet.\n'; err=''
- **Baseline**: fail — Impl does not register triggered-runs

### F5 — triggered-runs empty → friendly, not error
- **TNL**: pass — rc=0; out='No triggered runs recorded yet.\n'
- **Baseline**: fail — No triggered-runs CLI

### F6 — triggered-runs shows event_type/parent lineage
- **TNL**: pass — rc=0; has_event=True; has_parent=True; out_snip='  2026-04-22T16:11:07.698872Z  ok      depth=1  run-child  <- monitor.mention_found  (parent=run-parent, use_case=promote-volnix)\n'
- **Baseline**: fail — No triggered-runs CLI

### G3 — suppression event persisted on cycle
- **TNL**: pass — count(scheduler.trigger_suppressed)=1
- **Baseline**: fail — Impl does not emit suppression events

