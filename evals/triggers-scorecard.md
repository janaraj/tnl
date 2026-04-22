# Scorecard — event-driven-triggers

| # | Metric | tnl | baseline |
|---|---|---|---|
| 1 | Functional completeness (matrix pass %) | 35/35 (100.0%) | 29/35 (82.9%) |
| 2 | Regressions introduced | 0 | 0 |
| 3 | Full-suite pass rate | 521/523 (2f/0e) | 518/520 (2f/0e) |
| 3b | Base test total (pristine eb49b71) | 498 | 498 |
| 3c | Net test-count delta vs base | +25 | +22 |
| 4 | New test functions (added to diff) | 26 | 23 |
| 5 | Production files modified | 11 | 11 |
| 6 | Scope-creep files (outside `feature_paths`) | 4 | 3 |
| 7 | Net production LOC (+/−) | +612/−64 | +453/−46 |
| 8 | New abstractions (classes + protocols + modules) | 3 | 4 |
| 9 | Session wall-clock (min) | — | — |
| 10 | Session cost (USD, Opus 4 rates) | $52.88 | $34.95 |
| 11 | Decisions pinned explicitly (MUST clauses in TNL) | 15 | 0 |
| 12 | Decisions silently guessed (manual tag) | — | — |

### tnl — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/registry/composition.py`
- `src/chiefofstaff/storage/connection.py`

### baseline — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/storage/connection.py`
