# Behavioral Test Report: Drafts + Approval Feature

**Feature under test:** Drafts, approval, and scheduling for the Chief of Staff promote job.

**Original request:**
> *"we need drafts and approval for the promote job. caller can create a draft post, review it, approve it to send now or schedule it for later. add cli commands for the usual stuff."*

**Implementations compared:**
- **TNL side** (`/Users/jana/workspace/chiefofstaff-cnl`, branch `cnl-experiment`) — TNL-driven, `promote-drafts.cnl` spec, reviewed before implementation.
- **Baseline side** (`/Users/jana/workspace/chiefofstaff`, main) — four workflow principles in `CLAUDE.md` + plan-mode discipline, no TNL.

**Method:** 40 black-box and grey-box scenarios across 9 categories, executed against both implementations via standalone runner scripts. No source files modified in either repo.

---

## 1. Headline Numbers

| | TNL side | Baseline | Delta |
|---|---:|---:|---|
| Scenarios passed | **30 / 40** (75%) | **22 / 40** (55%) | TNL +20pp |
| Scenarios failed | 7 | 12 | Baseline +5 fails |
| Not applicable / scope-fenced | 3 | 6 | — |
| Execution errors | 0 | 0 | — |

**Completion-against-original-request score** (weighted by how load-bearing each requirement is):

| Requirement | TNL coverage | Baseline coverage |
|---|:---:|:---:|
| Create a draft post | ✅ | ✅ |
| Review (CLI list/show) | ✅ | ✅ |
| Approve to send now | ✅ (via runner) | ⚠️ (post_via_pack works but runs-row bookkeeping is broken in tested path) |
| Schedule for later | ✅ (one-shot UTC timestamp) | ⚠️ (cron-based recurring; no one-shot timestamp support) |
| CLI commands for the usual stuff | ✅ (6 verbs) | ✅ (7 verbs, no prefix-match on IDs) |
| Integration with existing framework | ✅ (runs+actions rows) | ❌ (runs row not created → action recording fails) |
| **Overall** | **~95%** | **~70%** |

---

## 2. Full Scenario Matrix

Scenario pass/fail for each side. Ordered by category.

| ID | Category | TNL | Baseline | Scenario |
|---|---|:---:|:---:|---|
| A1 | timezone | ✅ | ❌ | Schedule with naive timestamp |
| A2 | timezone | ✅ | N/A | Schedule with non-UTC offset +05:30 |
| A3 | timezone | ✅ | N/A | Schedule with UTC Z |
| A4 | timezone | ✅ | ❌ | Schedule in the past |
| A5 | timezone | ✅ | N/A | Schedule 10 years in the future |
| B1 | state | ❌ | ❌ | Schedule already-sent draft |
| B2 | state | ❌ | ✅ | Re-reject / re-cancel (terminal state) |
| B3 | state | ✅ | ✅ | Delete sent/posted draft |
| B4 | state | ❌ | ❌ | Illegal transition sent → rejected at storage |
| B5 | state | ✅ | ✅ | Re-schedule replaces existing schedule |
| B6 | state | ❌ | ❌ | Schedule a sent/posted draft |
| B7 | state | ✅ | ✅ | Duplicate content → different IDs |
| C1 | concurrency | ✅ | ✅ | Sequential claims (no double-fire) |
| C2 | concurrency | ✅ | ✅ | Delete-then-claim returns empty |
| D1 | id | ✅ | ✅ | Full ID lookup |
| D2 | id | ✅ | ❌ | Unambiguous prefix match |
| D3 | id | ✅ | N/A | Ambiguous prefix returns None |
| D4 | id | ✅ | ✅ | Non-existent ID → None |
| E1 | input | ❌ | ❌ | Empty content accepted at storage |
| E2 | input | ✅ | ✅ | 5000-char content stored |
| E3 | input | ❌ | ❌ | Unknown service accepted at storage |
| E4 | input | ❌ | ❌ | Unknown action accepted at storage |
| E5 | input | ✅ | ✅ | SQL injection stored safely |
| E6 | input | ✅ | ✅ | Unicode / emoji / RTL intact |
| E7 | input | ✅ | ✅ | None content rejected |
| F1 | send | ✅ | ✅ | Pack raises → draft fails |
| F2 | send | ✅ | ✅ | Pack returns ok=False |
| F3 | send | ✅ | ✅ | Pack not registered |
| F4 | send | N/A | N/A | Partial success (skipped) |
| G1 | schedule | ✅ | ✅ | Delete cascade (scheduled row cleaned up) |
| G2 | schedule | ✅ | ✅ | Time arrives → claim picks up |
| G3 | schedule | ✅ | ✅ | Re-schedule |
| G4 | schedule | N/A | ✅ | Invalid cron skipped, others continue |
| H1 | llm | ✅ | ❌ | draft_mode=True hides request_approval |
| H2 | llm | ✅ | ✅ | draft_mode=False hides create/save_draft |
| H3 | llm | ✅ | ✅ | Unknown fields dropped via allowlist |
| H4 | llm | ✅ | ✅ | Missing required fields rejected |
| I1 | integration | ✅ | ❌ | Approved send creates runs row |
| I2 | integration | ✅ | ❌ | Approved send creates actions row |
| I3 | integration | N/A | N/A | Rate-limits (needs real pack) |

---

## 3. Shared Gaps (Both Failed)

### 3.1 State machine not enforced at the storage layer (B1, B4, B6)

Both implementations accept illegal state transitions at the storage API:
- `update_draft_status(did, "scheduled")` on a draft already in terminal state (`sent` for TNL, `posted` for baseline) succeeds.
- `schedule_send`/`set_cron` on a terminal-state draft succeeds.

**Severity: medium.** The CLI layer may enforce correctly on both sides (TNL explicitly checks), but any internal caller or test code bypassing the CLI can drive drafts into inconsistent states. TNL has `[semantic]` clauses describing the state machine but doesn't enforce them in SQL.

### 3.2 No content validation at draft creation (E1, E3, E4)

- Empty content (`""` on TNL, `{}` on baseline) is accepted.
- Unknown service name (`"tiktok"`) is accepted.
- Unknown action name (`"unknown_action"`) is accepted.

**Severity: medium.** Both defer validation to send time. This means CLI `create` / LLM `create_draft` can produce drafts that will predictably fail when approved. Users get a late failure instead of an early one.

---

## 4. TNL Unique Wins (TNL passes, Baseline fails)

### 4.1 Timezone handling (A1, A4)

- **A1**: TNL's CLI has `_parse_utc_iso` that rejects naive timestamps with a clear error. Baseline's `set_cron` accepts ANY string — `"2026-05-01T10:00:00"` would be silently stored as a cron expression, then silently fail at the next scheduler tick when croniter can't parse it.

- **A4**: TNL accepts a past timestamp and fires on the next tick (via `claim_due_sends` semantics). Baseline's cron-based approach has a quirk: next-fire is computed from `last_posted_at or created_at`, so a draft created seconds ago with `"* * * * *"` won't be "due" for another minute. The simple "schedule for 2 seconds ago" case doesn't work naturally on baseline.

**Cause:** TNL explicitly surfaced "UTC-only, reject non-UTC" in the TNL. Baseline silently adopted cron-based scheduling which doesn't have a one-shot timestamp concept at all.

### 4.2 Prefix-based ID matching (D2)

TNL's CLI has `_resolve_draft(storage, id_or_prefix)` that accepts an unambiguous prefix (first 8 chars are typically enough). Baseline requires the full UUID on every CLI call.

**Severity: low, UX.** Real users will copy-paste the full ID either way, but this is friction. TNL's TNL file explicitly required this: *"CLI output MUST tag draft_ids with a short prefix (first 8 chars) for listing but accept full or prefix match on input when unambiguous."*

### 4.3 LLM tool isolation in draft mode (H1)

With `draft_mode=True` (TNL) / `drafts_mode=True` (baseline):
- TNL correctly exposes **only** `create_draft` (not `request_approval`) — matches the TNL clause.
- Baseline exposes **both** `save_draft` AND `request_approval` — the LLM can choose, which means the "all writes go through drafts" invariant isn't structural.

**Severity: high for behavior reliability.** The whole point of draft mode is that the LLM can't circumvent the human review step. Baseline lets it choose between "ask for approval" and "create a draft." TNL's `[semantic]` clause made this explicit: *"When draft_mode=True, the promote job MUST NOT call service write actions directly. All would-be posts MUST be routed through create_draft."*

### 4.4 Audit trail integration (I1, I2)

Sent drafts need to appear in the `runs` and `actions` tables so `chiefofstaff history` shows them.

- **TNL** `JobRunner.execute_send()` creates a `runs` row (job_name="send_draft") AND records the action against it. Both rows present in the audit trail.
- **Baseline** `post_via_pack()` tries to record an action, but since the caller didn't create a `runs` row first, the `record_action` call **fails with `StorageError: unknown run_id: run-test; begin_run must be called first`**. The action is silently dropped.

**Severity: high.** This is a real data integrity bug in the tested flow. A naive caller calling `post_via_pack(..., storage=main_storage, run_id="some-id")` will not produce a complete audit trail. Baseline's CLI `approve` command does create a "synthetic" runs row before calling post_via_pack — so the CLI path works, but the function signature advertises a parameter that doesn't do what it looks like it does.

This is exactly the kind of architectural invariant that the TNL captured explicitly: *"execute_send MUST: (1) create a run row with job_name='send_draft' and use_case=draft.use_case, (2) ... (4) record the resulting action row against the new run_id"*.

---

## 5. Baseline Unique Wins (Baseline passes, TNL N/A or fails)

### 5.1 Invalid cron handling (G4)

Baseline's `DraftScheduler` catches invalid cron expressions, logs a warning, and continues processing other drafts. TNL scoped out cron entirely (explicit non-goal), so this scenario is N/A for TNL — baseline earned a capability the TNL simply doesn't have.

**Severity: scope expansion.** This is a real capability, but only valuable because baseline chose to ship cron-based scheduling. The original request was "schedule for later" — TNL interpreted as one-shot, baseline as recurring. Whether you "need" invalid-cron-handling depends on whether you needed cron at all.

### 5.2 Re-transition in terminal states treated as idempotent (B2)

Methodology difference. Both implementations allow the re-transition; my assertion for TNL checked a side-effect (notes field changed), while the baseline check was lenient. Call it **a wash** — neither enforces the terminal-state invariant at storage.

---

## 6. Gap Severity Summary

| Gap | Affected | Severity | Notes |
|---|---|---|---|
| Baseline: `set_cron` stores any string → silent drop at evaluation | Baseline | **HIGH** | User schedules with a plain date, nothing ever fires, no error |
| Baseline: `post_via_pack` caller responsibility for runs row | Baseline | **HIGH** | Action recording silently fails if caller skips runs-row setup |
| Baseline: draft mode still exposes `request_approval` | Baseline | **HIGH** | LLM can bypass the draft gate |
| Baseline: no prefix match on CLI | Baseline | Low (UX) | Users must paste full UUID |
| Baseline: no one-shot timestamp scheduling | Baseline | **MEDIUM** (scope) | Divergence from prompt; forced all users to cron |
| Shared: storage doesn't enforce state machine | Both | Medium | CLI enforces on both; raw storage API doesn't |
| Shared: no content-emptiness validation | Both | Medium | Drafts can be created that will predictably fail |
| Shared: no service/action name validation at creation | Both | Medium | Same, deferred to send time |

---

## 7. How Close to the Original Requirements?

### TNL side — ~95% complete

All five literal requirements met. The gaps are secondary (state-machine enforcement at storage layer, content-emptiness validation) and don't affect the core workflow. Audit trail integration works correctly. One-shot scheduling works. Draft mode actually does lock out non-draft writes.

### Baseline side — ~70% complete

The literal requirements appear met, but the test surfaced three serious implementation gaps:

1. **One-shot scheduling doesn't exist.** Baseline's interpretation was "recurring cron." If you give a user a scenario like "post this on Monday at 10am once," baseline can do it only by them learning cron and remembering to cancel it after it fires.
2. **Audit trail is broken in the post_via_pack path.** Actions recorded via `post_via_pack` without a prior `begin_run()` call silently fail to persist. The CLI's `approve` command happens to do this correctly; the function's type signature doesn't force it.
3. **Draft mode is leaky.** The LLM still has `request_approval` available alongside `save_draft`, so the promote prompt can't enforce "all posts go via drafts." Baseline effectively has two parallel paths and relies on prompting to pick one.

None of these would be caught by "the tests pass" — they're behavioral invariants that require either (a) an explicit spec to test against, or (b) running scenarios that probe beyond the happy path.

---

## 8. What This Says About the TNL Thesis

**The behavioral test is the cleanest evidence so far that TNL's value isn't just "nicer documentation."**

The three HIGH-severity baseline gaps all trace back to specific TNL clauses that were reviewed at proposal time:

| Gap in baseline | TNL clause that prevented it |
|---|---|
| `set_cron` accepts any string | "Only one-shot fire-at-timestamp is in scope" (explicit non-goal on cron) |
| `post_via_pack` silent action-recording failure | "execute_send MUST: (1) create a run row... (4) record the resulting action row against the new run_id" |
| Draft mode exposes request_approval | "draft_mode=True MUST include create_draft... and MUST NOT include the existing request_approval meta-tool" |

Each was a design decision that could go multiple ways. In the TNL flow, each was written as an explicit clause, reviewed, and approved before code existed. In baseline, each was silently made during implementation, and each ended up on the wrong side of a real-world invariant.

This is the "surface interpretation at proposal time" benefit doing real work on a real codebase, measured by running the code — not by reading it.

---

## 9. What This Says About the Baseline + Principles-Plus-Plan-Mode Thesis

Principles + plan mode did catch some things. Shared gaps (state machine, input validation) are the "both missed it" category — not attributable to TNL. Baseline's code is generally well-structured, tested, and conforms to existing framework conventions.

But three meaningful behavioral bugs shipped that a reviewer reading the TNL diff would have pushed back on. That's the delta TNL earns.

---

## 10. Caveats

- Storage-layer tests bypass the CLI in some cases. CLI-level enforcement of the state machine may catch some of the B* scenarios on both sides — not tested here.
- The `FakePack` used for send tests doesn't exercise real rate-limit accounting; I3 is consequently N/A on both.
- Baseline's scheduler tests were hampered by the cron semantic (next-fire relative to creation time). I used a simulated future clock to force due-state; results reflect that.
- All tests were run against in-memory SQLite. A file-backed database may exhibit different concurrency behavior.
- The scenarios are mine, not the user's. Different scenarios would surface different gaps.

---

## 11. Raw Results

- [`results/cnl.json`](./results/cnl.json) — 40 per-scenario results for TNL side
- [`results/baseline.json`](./results/baseline.json) — 40 per-scenario results for baseline side
- [`run_cnl.py`](./run_cnl.py), [`run_baseline.py`](./run_baseline.py) — runners (read-only against their target repos)
- [`SCENARIOS.md`](./SCENARIOS.md) — test matrix definition
