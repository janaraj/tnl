# Scorecard — promote-drafts

| # | Metric | tnl-v1 | baseline | tnl-v2 |
|---|---|---|---|---|
| 1 | Functional completeness (matrix pass %) | 28/36 (77.8%) | 33/36 (91.7%) | 14/18 (77.8%) |
| 2 | Regressions introduced | 0 | 0 | 0 |
| 3 | Full-suite pass rate | 550/550 | 542/544 (2f/0e) | 575/577 (2f/0e) |
| 3b | Base test total (pristine eb49b71) | 498 | 498 | 498 |
| 3c | Net test-count delta vs base | +52 | +46 | +79 |
| 4 | New test functions (added to diff) | 62 | 49 | 80 |
| 5 | Production files modified | 10 | 13 | 14 |
| 6 | Scope-creep files (outside `feature_paths`) | 2 | 5 | 4 |
| 7 | Net production LOC (+/−) | +1038/−51 | +1111/−33 | +1211/−8 |
| 8 | New abstractions (classes + protocols + modules) | 6 | 8 | 10 |
| 9 | Session wall-clock (min) | — | — | — |
| 10 | Token cost (approx) | — | — | — |
| 11 | Decisions pinned explicitly (MUST clauses in TNL) | 24 | 0 | 31 |
| 12 | Decisions silently guessed (manual tag) | — | — | — |

### tnl-v1 — pre-existing failures fixed (red at base, green now)
- `tests/jobs/definitions/promote/test_prompts.py::TestUserPrompt::test_limits_match_settings`
- `tests/jobs/definitions/promote/test_prompts.py::TestUserPrompt::test_research_instruction_present_by_default`

### tnl-v1 — files outside `feature_paths`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/core/drafts.py`

### baseline — files outside `feature_paths`
- `src/chiefofstaff/core/context.py`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/registry/composition.py`
- `src/chiefofstaff/runner/engine.py`
- `src/chiefofstaff/runner/draft_publisher.py`

### tnl-v2 — files outside `feature_paths`
- `src/chiefofstaff/core/context.py`
- `src/chiefofstaff/core/protocols.py`
- `src/chiefofstaff/registry/composition.py`
- `src/chiefofstaff/runner/engine.py`
