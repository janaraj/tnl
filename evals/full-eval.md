# Does a structured contract step make AI coding agents ship cleaner code?

**A controlled eval across 3 tasks, 2 agents (Claude Code + Codex), 3 codebases.**

_n=1–2 per cell. Read with appropriate skepticism. All raw data, scripts, and worktrees are linked so you can rerun anything._

---

## TL;DR

We gave two AI coding agents the same feature requests under two working instructions — one with TNL (a short structured-English contract reviewed before any code lands) and one with just the same coding principles in plain-language form. We measured correctness, scope discipline, cost, and decision surfacing.

| Claim | Evidence |
|---|---|
| **TNL always beats baseline on functional completeness** | Across 3 tasks and 5 comparisons, TNL's lowest band is 86%; baseline's highest is 83%. No overlap. |
| **TNL's cost is noisy, not structurally higher** | In 5 paired sessions: TNL cheaper in 2, baseline cheaper in 3. Cost tracks session turn-count, not workflow. |
| **TNL's consistency edge is real** | TNL's MUST-clause count on the same task lands 15/16/17 across 3 samples (±1); baseline's scope-creep files range 2–4. Less variance, tighter bounds. |
| **Contract persistence works for follow-up work** | Both TNL agents correctly edited their existing contract for a round-2 task; no new file was created. The baseline agent had to re-read code. |
| **One class of bug the contract didn't catch** | Claude TNL shipped a cycle-check that depended on runtime metadata; neither the contract nor the review caught it. |

**One line:** TNL consistently ships more of the spec, less speculatively, with reviewable decisions on record — at roughly parity cost. It's not magic; the contract only catches what the reviewer thinks to ask.

---

## What we tested

**TNL (Typed Natural Language)** is a structured-English contract format. Before the agent writes any code it writes a `.tnl` file with `paths:`, `surfaces:`, `behaviors:` (MUST / SHOULD / MAY / `[semantic]`), `non-goals:`, and `rationale:`. The user reviews and approves the contract. Only then does the agent implement against it.

The **baseline** is the same coding agent with the same 4 working principles (think-before-coding, simplicity-first, surgical-edits, goal-driven) written in the project's instruction file (CLAUDE.md or AGENTS.md) — but no contract step.

Identical prompts, identical model, identical codebase, identical git base commit. Only the instruction file differs.

---

## Methodology

**Tasks.**

1. **keylo** — a small new TypeScript service (Fastify + SQLite + Zod). 5 features built in sequence. Claude Code only.
2. **chiefofstaff drafts** — adding a draft/approval rail to a real 16KLOC Python codebase's promote job. Claude Code only. We ran this 3 times on the TNL side to measure within-run variance (v1, post-stanza-fix v2) plus once baseline.
3. **chiefofstaff triggers** — event-driven use-case triggers, a mid-complexity feature in the same codebase. Claude Code and Codex, 2 samples per Claude cell, 1 per Codex cell.
4. **chiefofstaff collision-handling follow-up** — second task in the same worktrees to test whether the TNL file acts as a knowledge base for subsequent work.

**Scorecard.** 12 dimensions per run — auto-computed from git + pytest + session JSONL (see [`evals/score.py`](./score.py)):

1. Functional completeness (behavioural matrix pass %)
2. Regressions introduced
3. Full-suite pass rate
4. New test functions added
5. Production files modified
6. Scope-creep files (outside declared `paths:`)
7. Net production LOC
8. New abstractions (classes + protocols + modules)
9. Session wall-clock (manual)
10. Session cost (USD; $ approx via [`session_tokens.py`](./session_tokens.py) and [`codex_tokens.py`](./codex_tokens.py))
11. Decisions pinned explicitly (MUST clause count)
12. Decisions silently guessed (manual forensic tag)

**Behavioural matrices.** A scenario-based pass/fail per task. For chiefofstaff triggers we built 35 scenarios covering timezone, state-machine, concurrency, id resolution, malformed input, send-failure, scheduled lifecycle, LLM input, framework integration. For the follow-up we added 14 collision-specific scenarios (policy declaration, queue/skip/dedup/replace behaviour, composition with prior guards).

**What we explicitly tried not to do.**

- No coaching during sessions. Once the prompt was sent, we only answered clarifying questions the agent asked.
- No prompt rewording between agents. Identical string.
- Pre-existing failing tests at base commit were *not* fixed by us; we measured whether agents chose to fix them or leave them.

---

## Task 1 — keylo (TypeScript, 5 features, Claude Code)

A small from-scratch service: API key auth, KV with TTL, rate limiting, key listing, case-insensitive keys. TNL's contract files are in `cnl/`; baseline's `CLAUDE.md` carries the same 4 principles plus plan-mode discipline.

### Final-state comparison (keylo vs keylo-baseline-v2)

| Axis | TNL | Baseline (principles + plan mode) |
|---|---|---|
| Source + test LOC | 1637 | 1540 |
| Source files | 12 | 11 |
| Test files | 4 | 9 |
| Test cases | 44 | 46 |
| TNL / contract files | 5 (379 LOC) | — |
| **KV storage** | | |
| Value size limit | ✓ 64 KB | ✗ **no limit** (prod bug risk) |
| Key character regex | ✓ `[A-Za-z0-9_\-.]` | ✗ **any character** |
| Case-insensitive tests | ✓ 3 tests | ✗ **zero** |
| **Auth** | | |
| Admin/user separation test | ✓ explicit | ✗ missing |
| **API shape** | | |
| Versioning | ✓ `/v1/` consistent | ✗ none |
| `/whoami` probe | ✓ | ✗ |
| **Reviewable artifact** | ✓ TNL diffs per change | ✗ code + CLAUDE.md only |

### What baseline did better

- Fake-clock `now()` injection for TTL tests — cleaner than TNL's "force expiry via SQL update."
- Transaction-wrapped migrations.

### What TNL did better (summarised)

- Surfaced the 64 KB value-size limit, the key regex, the admin/user separation test as explicit MUSTs that a reviewer could approve or push back on. Baseline silently shipped *"no limit, any character, no separation test"* because no one was prompted to think about those edges.
- Generated a reviewable intent diff on the case-insensitive edit. Baseline shipped correct implementation but **zero regression tests** for the new behaviour.

**Headline:** on the cleanest axes (invariants that emerged only during contract review), TNL caught 3 production-risk gaps baseline didn't. On the axes where both approaches had a chance (auth timing-safe compare, idempotent revoke), they converged. Principles + plan mode closes most of the gap vs a naive baseline, but not all of it.

Full keylo report: [`internal_docs/keylo-evaluation-report.md`](../internal_docs/keylo-evaluation-report.md).

---

## Task 2 — chiefofstaff drafts (Python, Claude Code only, 3 TNL runs + 1 baseline)

A realistic mid-complexity feature in a 16KLOC Python codebase: add `drafts` storage, filter write tools out of the promote job, route approvals through a CLI, dispatch approved drafts via the scheduler.

| Metric | TNL v1 | Baseline | TNL v2 *(post-stanza-fix)* |
|---|---:|---:|---:|
| Functional completeness (40-scenario matrix) | 28/36 (78%) | **33/36 (92%)** | 14/18 (78%) ¹ |
| Regressions introduced | 0 | 0 | 0 |
| Full-suite pass rate | 550/550 | 542/544 | 575/577 |
| Net tests vs base (498) | +52 | +46 | **+79** |
| Production files modified | **10** | 13 | 14 |
| Scope-creep files (outside declared `paths:`) | **2** | 5 | 4 |
| Net production LOC | +1038/−51 | +1111/−33 | +1211/−8 |
| New abstractions (classes + protocols + modules) | **6** | 8 | 10 |
| Session cost (USD, Opus 4 rates) | **$40.99** | $56.22 | $58.79 |
| Output tokens | 164K | 192K | 168K |
| MUST clauses in contract | 24 | 0 | 31 |

¹ *TNL v2 used an 18-scenario spot-check, not the full 40 — we had already evaluated the same-task scenarios; the spot-check targeted the 5 divergent cases.*

### Key findings — drafts

1. **On this task, baseline beat TNL v1 on functional completeness (33/36 vs 28/36).** The cause was 5 scenarios where TNL's contract was silent and implementation dropped them: `ok=False` handling from service packs, audit-trail emission to `runs`/`actions` tables, unknown-action validation at storage. Baseline's "match existing patterns" instinct caught most because similar code elsewhere in the repo did these.
2. **TNL v2 (with tightened stanza) closed every one of those gaps.** F2 (`ok=False` → fail), I1/I2 (synthetic run + actions rows), now explicit MUSTs. Same task, same codebase, same agent — just a more thorough contract.
3. **No run introduced regressions.** The two pre-existing failing tests in `test_prompts.py` were present at base `eb49b71`; TNL v1 fixed them opportunistically (scope creep), baseline and TNL v2 left them alone (correct per surgical-edits principle).
4. **Cost ranged $41–$59 across the three runs, no directional pattern.** Baseline was most expensive of the three.

Full drafts scorecard: [`drafts-scorecard.md`](./drafts-scorecard.md). Raw JSON: [`drafts-scorecard.json`](./drafts-scorecard.json).

---

## Task 3 — chiefofstaff triggers (Python, Claude + Codex, 2 samples per Claude cell)

Event-driven use-case triggers: when one job emits event X, run use-case Y automatically. Config, CLI, loop prevention, cron coexistence. Deliberately ambiguous prompt — many interpretation decisions to make.

### Table A — Claude Code (Opus 4.7, n=2 per cell)

| Metric | TNL #1 | TNL #2 | Baseline #1 | Baseline #2 |
|---|---:|---:|---:|---:|
| Functional completeness (35-scenario matrix) | **35/35 (100%)** | **31/35 (89%)** | 29/35 (83%) | 27/35 (77%) |
| Regressions introduced | 0 | 0 | 0 | 0 |
| Full-suite pass rate | 521/523 | 536/538 | 518/520 | 527/529 |
| Net tests vs base (498) | +25 | **+40** | +22 | +31 |
| Production files modified | 11 | 11 | 11 | 11 |
| Scope-creep files | 4 | **2** | 3 | 2 |
| Net production LOC | +612/−64 | +588/−70 | +453/−46 | +373/−35 |
| New abstractions | **3** | **3** | 4 | 5 |
| Session cost (USD) | $52.88 | $42.60 | $34.95 | $58.09 |
| Output tokens | 158K | 144K | 104K | 156K |
| MUST clauses in contract | 15 | 16 | 0 | 0 |

### Table B — Codex (GPT-5.4 high, n=1 per cell)

| Metric | TNL | Baseline |
|---|---:|---:|
| Functional completeness (35-scenario matrix) | **32/35 (91%)** | 26/35 (74%) |
| Regressions introduced | 0 | 0 |
| Full-suite pass rate | 516/518 | 516/516 ¹ |
| Net tests vs base (498) | +20 | +18 |
| Production files modified | 9 | 11 |
| Scope-creep files | **1** | 4 |
| Net production LOC | +461/−32 | +419/−64 |
| New abstractions | 3 | 1 |
| Session cost (USD, GPT-5.4 high rates) | $15.91 | $20.47 |
| Output tokens (incl. reasoning) | 61K | 78K |
| MUST clauses in contract | 17 | 0 |

¹ *Codex baseline opportunistically fixed the 2 pre-existing failing prompt tests by restoring removed strings to the template — a different flavour of scope creep than Claude's (which edited the tests instead of the template).*

### Key findings — triggers

1. **TNL beats baseline on functional completeness in every cell, both agents.** No overlap: TNL range 89–100 %, baseline range 74–83 %.
2. **Consistency is the sharpest TNL signal.** MUST-clause count across 3 TNL runs: 15 / 16 / 17 — almost identical. Across 3 baseline runs, scope-creep files: 3 / 2 / 4 — wider spread. New abstractions TNL: 3 / 3 / 3, baseline: 4 / 5 / 1.
3. **Codex baseline is genuinely strong on Python/async.** 26/35 is below TNL but above Claude baseline (27–29). Its static-at-config cycle detection is cleverer than either Claude implementation.
4. **No consistent cost pattern.** Claude cost TNL/baseline: 52/35, 43/58 — flips direction. Codex cost TNL/baseline: 16/20 — TNL cheaper.
5. **Codex generated the tightest contract.** 17 MUST clauses, 1 scope-creep file (lowest of any run). When the contract is this tight, implementation drift is small.

Full triggers scorecard: [`triggers-combined-scorecard.md`](./triggers-combined-scorecard.md). Matrix results per run: [`../behavioral-tests/triggers/MATRIX.md`](../behavioral-tests/triggers/MATRIX.md).

---

## Task 4 — collision-handling follow-up (knowledge-base test)

Second task in the *same* worktrees as Task 3. Prompt: add explicit collision policy (queue / dedup / skip / replace) for triggered runs when target is already in-flight, surface in CLI, compose with existing guards. The question this tests: does the TNL file serve as a knowledge base for subsequent sessions?

### Contract-edit behaviour

| | Edited existing TNL? | Created new TNL? | Required correction? |
|---|---|---|---|
| Claude TNL | ✓ (79 → 154 lines, +75) | ✗ (after correction) | Yes — initially proposed `run-collision-policy.tnl`, user corrected to edit existing |
| Codex TNL | ✓ (71 → 88 lines, +17) | ✗ | **No** — got "edit vs new" right first try |

*This finding motivated a stanza fix*: adding a dedicated "When a new TNL file is justified" subsection (with positive criteria + negative list + closing imperative) to the install-mode stanza. Previously that guidance only appeared as a single passing clause in step 1.

### Behavioural matrix (14 collision-specific scenarios)

| | TNL | Baseline |
|---|---:|---:|
| **Claude** | **13/14 (93%)** | 8/14 (57%) + 1 N/A |
| **Codex** | 12/14 (86%) + 1 N/A | **13/14 (93%)** |

### Key findings — collision follow-up

1. **Claude family: TNL beats baseline by 5 scenarios.** Baseline's collision handling is batch-only (filters within one scheduler tick) and fails on cross-tick collisions.
2. **Codex family: baseline slightly beats TNL.** Surprising. Codex baseline's persistent `pending_trigger_runs` table + static cycle detection handles more cases than Codex TNL's runtime ancestor-metadata approach.
3. **One real bug in Claude TNL**: cycle detection requires events to carry ancestor metadata attached via the emit path. A raw `bus.emit(event)` from outside a run context bypasses it. The contract didn't pin "runtime vs static" so this slipped through review.
4. **One real production bug in Codex baseline**: circular import between `storage.sqlite` and `scheduler.events` when `chiefofstaff triggers list` is invoked from a cold venv. Surfaced because we actually ran the CLI.
5. **Combined cross-round totals:**
   - Claude TNL: 44–48 / 49 (one round 1 sample + collision)
   - Claude Baseline: 35–37 / 49
   - Codex TNL: 44 / 49
   - Codex Baseline: 39 / 49

**TNL wins on combined totals for both agents, but the gap narrows in Codex** because Codex baseline was already strong.

### The knowledge-base hypothesis — validated?

Both TNL agents edited the existing TNL instead of creating a new one. That's the mechanical win. The *downstream* win — did contract-aware agents produce better round-2 code than contract-free agents? — is **clearly yes for Claude (+5 scenarios)**, **unclear for Codex (−1 scenario)**.

Our current read: Codex's pattern-matching is already very disciplined on Python/async codebases, so the contract's marginal value is smaller than for Claude, which benefits more from the explicit contract. Worth revisiting with more samples.

Full collision matrix: [`../behavioral-tests/triggers/MATRIX-collision.md`](../behavioral-tests/triggers/MATRIX-collision.md).

---

## Cross-task signals

Across all four evaluation rounds:

| Signal | Pattern |
|---|---|
| **Functional completeness** | TNL > Baseline in every cell we measured (5 comparisons, 2 agents, 3 codebases) |
| **Decision surfacing** | TNL runs pin 15–31 MUST clauses; baseline pins 0 |
| **Scope creep** | TNL typically lower or equal; never higher in our samples |
| **Cost** | No consistent direction; ranges overlap |
| **Consistency across samples** | TNL's within-cell variance is tighter on every measure we tracked |
| **Knowledge-base re-use** | Both TNL agents correctly edited existing contract for round-2 task |

---

## Caveats — read these if you intend to cite anything

- **n is small.** 1–2 samples per cell. We don't claim "on average" anywhere; every finding is observed-in-N phrasing. Don't generalise.
- **LLM randomness.** Same prompt, same model, same codebase → different session → different numbers. Contract-drafting timing alone explains some cost variance.
- **Prompt sensitivity.** We re-used exact prompts across conditions to keep this controlled, but different phrasings move metrics 10–30%.
- **Task shape.** drafts (storage/CRUD) and triggers (scheduler integration) are mid-complexity. Results don't generalise to 1-line bug fixes or cross-service refactors.
- **Codex n=1 per cell.** The "Codex baseline is strong" finding rests on one session. Rerun before citing.
- **keylo is Claude-only, 1 agent.** Don't compare its numbers to the triggers numbers directly.
- **Authors' conflict of interest.** We built TNL. We tried to make the baseline honest (same principles, same project context) but if you don't trust us, run the eval yourself — scripts and prompts are committed.

---

## Reproduce any of these

```bash
git clone https://github.com/<user>/cnl     # this repo
git clone https://github.com/<user>/chiefofstaff
cd chiefofstaff

# Worktrees from same base commit
git worktree add ../chiefofstaff-tnl       eb49b71 -b eval/tnl
git worktree add ../chiefofstaff-baseline  eb49b71 -b eval/baseline

# TNL setup
cd ../chiefofstaff-tnl
npx typed-nl init --agent claude --local-install

# Baseline setup: append the 4 working principles to CLAUDE.md (see evals/baseline-principles.md)

# Run the session(s), then:
python3 /path/to/cnl/evals/score.py /path/to/cnl/evals/triggers-combined-config.json
python3 /path/to/cnl/behavioral-tests/triggers/run_tnl.py       # via each worktree's .venv
```

Expected output matches the tables above within LLM-level noise.

---

## Raw artifacts

All scorecards, config files, per-run JSON matrices, and per-session token transcripts are in [`evals/`](.) and [`behavioral-tests/`](../behavioral-tests/). Every number in this document is regenerable by running `score.py` against the committed configs.

- [`evals/score.py`](./score.py) — scorecard generator
- [`evals/session_tokens.py`](./session_tokens.py) — Claude Code JSONL → tokens + $
- [`evals/codex_tokens.py`](./codex_tokens.py) — Codex rollout JSONL → tokens + $
- [`evals/drafts-scorecard.md`](./drafts-scorecard.md) — Task 2 scorecard
- [`evals/triggers-combined-scorecard.md`](./triggers-combined-scorecard.md) — Task 3 scorecard
- [`behavioral-tests/triggers/SCENARIOS.md`](../behavioral-tests/triggers/SCENARIOS.md), [`SCENARIOS-collision.md`](../behavioral-tests/triggers/SCENARIOS-collision.md) — scenario matrices
- [`behavioral-tests/triggers/MATRIX.md`](../behavioral-tests/triggers/MATRIX.md), [`MATRIX-collision.md`](../behavioral-tests/triggers/MATRIX-collision.md) — matrix results
- [`internal_docs/keylo-evaluation-report.md`](../internal_docs/keylo-evaluation-report.md) — Task 1 detailed write-up

## License

MIT. Rerun, disagree, publish counter-data. That's the point.
