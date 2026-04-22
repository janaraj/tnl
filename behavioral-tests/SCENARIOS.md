# Behavioral Test Matrix: Drafts + Approval

40 scenarios across 9 categories. Each scenario is a named observable behavior that can be executed against either implementation. Scenarios are black-box or grey-box (direct storage/runtime calls); neither implementation is modified.

## Goal

Measure what each implementation actually does vs. the original request and common-sense edge cases. Report completion percentage, gaps, and latent bugs.

## Original request

> we need drafts and approval for the promote job. caller can create a draft post, review it, approve it to send now or schedule it for later. add cli commands for the usual stuff.

## Implementation summaries under test

- **TNL side** (`/Users/jana/workspace/chiefofstaff-cnl`, branch `cnl-experiment`):
  TNL-driven. `promote-drafts.cnl` specifies state machine, runner path, CLI, timezone handling.
- **Baseline side** (`/Users/jana/workspace/chiefofstaff`, principles + plan mode):
  No TNL. Dedicated `drafts/` package with Pydantic models, cron-based scheduler, direct service dispatch.

---

## Category A — Timezone handling (5 scenarios)

| ID | Scenario | Expected common-sense behavior |
|---|---|---|
| A1 | Schedule with naive timestamp (no timezone) | Reject or normalize — must not silently treat as local/UTC |
| A2 | Schedule with non-UTC offset `+05:30` | Reject or normalize to UTC — must be explicit |
| A3 | Schedule with UTC `Z` | Accept |
| A4 | Schedule in the past | Clear behavior — either fire immediately or reject |
| A5 | Schedule 10 years in the future | Accept (or document max) |

## Category B — State machine illegal transitions (7 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| B1 | Approve an already-sent draft | Reject with clear error |
| B2 | Approve an already-rejected draft | Reject |
| B3 | Delete an already-sent draft | Allow or reject consistently |
| B4 | Reject an already-sent draft | Reject with clear error |
| B5 | Re-approve a scheduled draft | Defined behavior (replace schedule or reject) |
| B6 | Schedule a draft that's already sent | Reject |
| B7 | Re-create same draft with same content | Should produce a different draft ID |

## Category C — Concurrency (2 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| C1 | Two parallel claims of the same due scheduled send | Exactly one succeeds (no double-fire) |
| C2 | Delete while claim is in progress | Defined behavior (claim sees gone, or delete waits) |

## Category D — ID resolution (4 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| D1 | Full UUID match | Succeeds |
| D2 | Unambiguous prefix match (first 8 chars, unique) | Succeeds (if supported) or clear error |
| D3 | Ambiguous prefix (two drafts share it) | Clear error |
| D4 | Non-existent / malformed ID | 404-equivalent |

## Category E — Malformed / edge-case input (7 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| E1 | Empty content | Reject at creation |
| E2 | Very long content (5000 chars, beyond Twitter's 280) | Stored but flagged at send, OR rejected at creation |
| E3 | Unknown service name | Reject at creation or at send |
| E4 | Unknown action name | Reject at creation or at send |
| E5 | SQL-special characters in content (`'; DROP TABLE drafts;--`) | Stored safely, returned intact |
| E6 | Unicode / emoji / RTL text | Stored and retrieved intact |
| E7 | Null / missing required fields | Reject with clear error |

## Category F — Send execution failure paths (4 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| F1 | Service pack raises exception mid-send | Draft → `failed`, error captured |
| F2 | Service pack returns `ok: False` | Draft → `failed` |
| F3 | Service pack not registered at all | Send refuses with clear error |
| F4 | Partial success (pack returns ok but storage fails) | Best-effort — draft status reflects outcome |

## Category G — Scheduled send lifecycle (4 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| G1 | Schedule draft, then delete → scheduled_sends row cleaned up (CASCADE) | Yes |
| G2 | Schedule draft, then fire time arrives | Claim mechanism picks it up on next tick |
| G3 | Schedule already-scheduled draft | Defined: replace or reject |
| G4 | Cron-based recurring (baseline only) — invalid cron | Skipped with warning, doesn't block other drafts |

## Category H — LLM input handling (4 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| H1 | `draft_mode=True` — create_draft/save_draft in tool list, request_approval NOT | Per TNL; baseline may differ |
| H2 | `draft_mode=False` — create_draft/save_draft NOT in tool list | Both sides should enforce |
| H3 | LLM call with unknown fields (e.g., `fake_credential: "xxx"`) | Dropped via allowlist (CLAUDE.md defense-in-depth) |
| H4 | LLM call missing required fields | Clear error, no partial write |

## Category I — Integration with existing framework (3 scenarios)

| ID | Scenario | Expected |
|---|---|---|
| I1 | Approved send creates a `runs` row | TNL claims yes; baseline's direct-dispatch approach may not |
| I2 | Approved send creates an `actions` row | Both should |
| I3 | Approved send increments rate-limit counter | TNL claims yes via runner; baseline via pack's `_write_request` |

---

## Execution plan

1. Write `run_cnl.py` that imports TNL-side modules and runs all 40 scenarios
2. Write `run_baseline.py` mirroring for baseline
3. Each script outputs JSON with per-scenario: `status` (pass/fail/not_applicable/error), `observed`, `notes`
4. Compare the two JSON outputs → produce a matrix report
5. Score each side: completion % against original request, edge-case coverage, latent issues

Scenarios marked `not_applicable` are still informative — e.g., `G4` (invalid cron) is N/A for TNL because TNL explicitly scoped out cron. That's a scope fence, not a gap.
