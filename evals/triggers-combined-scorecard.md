# Scorecard — event-driven-triggers (6-run sample)

| # | Metric | tnl_claude_1 | tnl_claude_2 | tnl_codex | base_claude_1 | base_claude_2 | base_codex |
|---|---|---|---|---|---|---|---|
| 1 | Functional completeness (matrix pass %) | 35/35 (100.0%) | 31/35 (88.6%) | 32/35 (91.4%) | 29/35 (82.9%) | 27/35 (77.1%) | 26/35 (74.3%) |
| 2 | Regressions introduced | 0 | 0 | 0 | 0 | 0 | 0 |
| 3 | Full-suite pass rate | 521/523 (2f/0e) | 536/538 (2f/0e) | 516/518 (2f/0e) | 518/520 (2f/0e) | 527/529 (2f/0e) | 516/516 |
| 3b | Base test total (pristine eb49b71) | 498 | 498 | 498 | 498 | 498 | 498 |
| 3c | Net test-count delta vs base | +25 | +40 | +20 | +22 | +31 | +18 |
| 4 | New test functions (added to diff) | 26 | 44 | 21 | 23 | 32 | 19 |
| 5 | Production files modified | 11 | 11 | 9 | 11 | 11 | 11 |
| 6 | Scope-creep files (outside `feature_paths`) | 4 | 2 | 1 | 3 | 2 | 4 |
| 7 | Net production LOC (+/−) | +612/−64 | +588/−70 | +461/−32 | +453/−46 | +373/−35 | +419/−64 |
| 8 | New abstractions (classes + protocols + modules) | 3 | 3 | 3 | 4 | 5 | 1 |
| 9 | Session wall-clock (min) | — | — | — | — | — | — |
| 10 | Session cost (USD, Opus 4 rates) | $52.88 | $42.60 | $7.96 | $34.95 | $58.09 | $10.23 |
| 11 | Decisions pinned explicitly (MUST clauses in TNL) | 15 | 16 | 17 | 0 | 0 | 0 |
| 12 | Decisions silently guessed (manual tag) | — | — | — | — | — | — |

### tnl_claude_1 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/registry/composition.py`
- `src/chiefofstaff/storage/connection.py`

### tnl_claude_2 — files outside `feature_paths`
- `src/chiefofstaff/config/loader.py`
- `src/chiefofstaff/storage/connection.py`

### tnl_codex — files outside `feature_paths`
- `src/chiefofstaff/storage/connection.py`

### base_claude_1 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/storage/connection.py`

### base_claude_2 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/storage/connection.py`

### base_codex — pre-existing failures fixed (red at base, green now)
- `tests/jobs/definitions/promote/test_prompts.py::TestUserPrompt::test_limits_match_settings`
- `tests/jobs/definitions/promote/test_prompts.py::TestUserPrompt::test_research_instruction_present_by_default`

### base_codex — files outside `feature_paths`
- `src/chiefofstaff/jobs/definitions/monitor/job.py`
- `src/chiefofstaff/jobs/definitions/monitor/prompts/system.j2`
- `src/chiefofstaff/jobs/definitions/promote/prompts/user.j2`
- `src/chiefofstaff/storage/connection.py`
