# Scorecard — event-driven-triggers (10-run sample)

| # | Metric | tnl_claude_1 | tnl_claude_2 | tnl_claude_5 | tnl_codex_1 | tnl_codex_2 | tnl_codex_gpt55 | base_claude_1 | base_claude_2 | base_claude_3 | base_codex_1 | base_codex_2 | base_codex_gpt55 | base_codex_gpt55_2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Functional completeness (matrix pass %) | 35/35 (100.0%) | 31/35 (88.6%) | 30/35 (85.7%) | 32/35 (91.4%) | 31/35 (88.6%) | 32/35 (91.4%) | 29/35 (82.9%) | 27/35 (77.1%) | 25/35 (71.4%) | 26/35 (74.3%) | 26/35 (74.3%) | 29/35 (82.9%) | 30/35 (85.7%) |
| 2 | Regressions introduced | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | Full-suite pass rate | 521/523 (2f/0e) | 584/586 (2f/0e) | 518/520 (2f/0e) | 523/525 (2f/0e) | 506/508 (2f/0e) | 510/512 (2f/0e) | 518/520 (2f/0e) | 539/541 (2f/0e) | 527/529 (2f/0e) | 521/523 (2f/0e) | 584/586 (2f/0e) | 518/520 (2f/0e) | 523/525 (2f/0e) |
| 3b | Base test total (pristine eb49b71) | 498 | 498 | 498 | 498 | 498 | 498 | 498 | 498 | 498 | 498 | 498 | 498 | 498 |
| 3c | Net test-count delta vs base | +25 | +88 | +22 | +27 | +10 | +14 | +22 | +43 | +31 | +25 | +88 | +22 | +27 |
| 4 | New test functions (added to diff) | 26 | 89 | 23 | 28 | 13 | 14 | 23 | 44 | 32 | 26 | 89 | 23 | 28 |
| 5 | Production files modified | 11 | 12 | 13 | 9 | 8 | 11 | 11 | 11 | 11 | 11 | 12 | 13 | 9 |
| 6 | Scope-creep files (outside `feature_paths`) | 4 | 2 | 4 | 1 | 0 | 2 | 3 | 2 | 3 | 4 | 2 | 4 | 1 |
| 7 | Net production LOC (+/−) | +612/−64 | +1575/−86 | +322/−28 | +823/−35 | +585/−32 | +421/−25 | +453/−46 | +483/−39 | +516/−41 | +612/−64 | +1575/−86 | +322/−28 | +823/−35 |
| 8 | New abstractions (classes + protocols + modules) | 3 | 5 | 5 | 3 | 4 | 6 | 4 | 4 | 1 | 3 | 5 | 5 | 3 |
| 9 | Session wall-clock (min) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| 10 | Decisions pinned explicitly (MUST clauses in TNL) | 15 | 38 | 25 | 28 | 27 | 21 | 0 | 0 | 0 | 15 | 38 | 25 | 28 |
| 11 | Decisions silently guessed (manual tag) | — | — | — | — | — | — | — | — | — | — | — | — | — |

### tnl_claude_1 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/registry/composition.py`
- `src/chiefofstaff/storage/connection.py`

### tnl_claude_2 — files outside `feature_paths`
- `src/chiefofstaff/config/loader.py`
- `src/chiefofstaff/storage/connection.py`

### tnl_claude_5 — files outside `feature_paths`
- `src/chiefofstaff/core/context.py`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/storage/connection.py`

### tnl_codex_1 — files outside `feature_paths`
- `src/chiefofstaff/storage/connection.py`

### tnl_codex_gpt55 — files outside `feature_paths`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/jobs/definitions/monitor/prompts/system.j2`

### base_claude_1 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/storage/connection.py`

### base_claude_2 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/storage/connection.py`

### base_claude_3 — files outside `feature_paths`
- `src/chiefofstaff/core/context.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/storage/connection.py`

### base_codex_1 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/registry/composition.py`
- `src/chiefofstaff/storage/connection.py`

### base_codex_2 — files outside `feature_paths`
- `src/chiefofstaff/config/loader.py`
- `src/chiefofstaff/storage/connection.py`

### base_codex_gpt55 — files outside `feature_paths`
- `src/chiefofstaff/core/context.py`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/storage/connection.py`

### base_codex_gpt55_2 — files outside `feature_paths`
- `src/chiefofstaff/storage/connection.py`
