# Keylo Evaluation Report: TNL vs. Principles + Plan Mode

> An A/B comparison of two Claude Code-driven builds of the same small TypeScript service, run feature-by-feature, on identical prompts. One side uses the TNL flow (structured contracts, agent-written, human-reviewed). The other uses the same four workflow principles written into `CLAUDE.md` as plain guidance, with plan mode discipline on every change.
>
> **Purpose:** isolate TNL's unique contribution from what any team could get by writing down good principles and using plan mode.

---

## 1. Executive Summary

Across five feature cycles on a small TypeScript + Fastify + SQLite service:

- **Writing down the four principles + using plan mode closes most of the gap** between a raw baseline and a TNL-driven build. This is the cheapest possible adoption path and should be named as the bar TNL has to clear.
- **TNL still pulls ahead on three specific axes**: explicit invariant enumeration (value size limit, key regex, separation tests), edit-time verification artifacts (a reviewable diff before code lands on existing behavior), and cross-feature consistency (matching semantics across surfaces without the agent having to rediscover them).
- **The case-insensitive-keys edit was the strongest single differentiator** — TNL produced a reviewable contract diff with explicit collision and listing clauses; principles-plus-plan-mode shipped correct implementation but zero regression tests for the new behavior.
- **Net LOC is within rounding error** (1637 keylo vs 1540 v2) — the cost story TNL tells about overengineering only partially holds when the baseline is disciplined. Principles-plus-plan-mode is not bloated.

The wedge narrows from "TNL vs. naive baseline" to "TNL vs. disciplined baseline." It does not close.

---

## 2. Test Design

Three projects, identical stack (Node 20, TypeScript strict, Fastify, better-sqlite3, Zod, Vitest):

| Project | Workflow principles | Plan mode | TNL machinery |
|---|:---:|:---:|:---:|
| `keylo` | ✓ (in `cnl/workflow.cnl`) | — | ✓ (per-feature `.cnl` files, edited in place) |
| `keylo-baseline` (v1, not analyzed here) | ✗ | ✗ | ✗ |
| `keylo-baseline-v2` | ✓ (in `CLAUDE.md` prose) | ✓ | ✗ |

This report compares `keylo` vs. `keylo-baseline-v2` only — the raw v1 baseline was retired once the principles-plus-plan-mode condition was added for a fairer comparison.

**Features built in order, on identical prompts:**

1. API key auth (issue, validate, revoke)
2. Key-value storage with TTL
3. Per-key rate limiting (sliding window)
4. List caller's KV keys, paginated (edit task — adds a new endpoint to existing surfaces)
5. Make KV keys case-insensitive (pure edit — modifies existing behavior)

Each feature: fresh Claude Code session, no coaching, no mid-session corrections.

---

## 3. Final State — Comparison Matrix

| Axis | `keylo` (TNL) | `keylo-baseline-v2` |
|---|---|---|
| **Size** | | |
| Total source + test LOC | 1637 | 1540 |
| Source files | 12 | 11 |
| Test files | 4 | 9 |
| Test cases | 44 | 46 |
| TNL files | 5 (379 LOC) | — |
| **URL / API shape** | | |
| Versioning | `/v1/` consistent | None |
| Probe / whoami endpoint | ✓ `GET /v1/whoami` | ✗ missing |
| Key listing | ✓ `GET /v1/kv` | ✓ `GET /kv` |
| **Rate limiting** | | |
| Algorithm | In-memory sliding counter | In-memory sliding counter |
| Headers | `X-RateLimit-*` | `X-RateLimit-*` |
| **KV storage** | | |
| Value size limit | ✓ 64 KB | ✗ **no limit** |
| Key character regex | ✓ `[A-Za-z0-9_\-.]` | ✗ **any character** |
| Case-insensitive keys | ✓ (via `COLLATE NOCASE`) | ✓ (via `COLLATE NOCASE`) |
| Case-insensitive tests | ✓ 3 tests | ✗ **zero tests** |
| Pre-existing DB migration | ✗ (non-goal, explicit) | ✓ detects + migrates schema |
| **Auth** | | |
| Timing-safe admin compare | ✓ | ✓ |
| Idempotent revoke | ✓ | ✓ |
| Admin/user separation test | ✓ explicit | ✗ missing |
| **Persistence** | | |
| FK cascade on api_keys | ✗ (not needed; soft-delete only) | ✓ (speculative; no hard-delete path) |
| `updated_at` column | ✗ | ✓ (unused by any feature) |
| **Flow artifacts** | | |
| Reviewable intent artifact | ✓ TNL diffs per change | ✗ none post-plan |
| Persistent knowledge base | ✓ `/cnl/*.cnl` | ✗ code + `CLAUDE.md` only |

---

## 4. Round-by-Round Findings

### Round 1 — API key auth

**TNL surfaced and v2 missed:**
- Admin-token-rejected-on-user-route test (explicit MUST, explicit test)
- User-key-rejected-on-admin-route test

**Both got right:**
- Bearer header parsing, SHA-256 hashing, `timingSafeEqual` for admin
- Idempotent revoke semantics (v1 had missed this; v2 caught it via plan mode)

**Silent interpretation deltas:**
- Key entropy: keylo 32 bytes, v2 32 bytes (converged)
- Prefix: keylo `keylo_`, v2 `keylo_` (converged)
- ID type: keylo integer autoincrement, v2 UUID string

Round 1 gap: small. The principles cleaned up most of what v1 had gotten wrong.

### Round 2 — KV storage with TTL

**TNL surfaced and v2 missed:**
- 64 KB value-size limit (v2 has no limit at all — a production bug)
- Key character regex (v2 accepts any URL-valid character, including `..`, `<`, `>` — security-adjacent)
- Missing-value test, non-object JSON body test, exhaustive invalid-TTL cases

**v2 did better:**
- Fake-clock `now()` injection for TTL tests — cleaner testing hygiene than keylo's "force expiry by SQL update"
- Transaction-wrapped migrations

**Silent interpretation deltas:**
- TTL placement: keylo `?ttl=` query, v2 `ttlSeconds` in body
- TTL max: keylo unbounded, v2 capped at 10 years

Round 2 gap: moderate. Core invariants preserved in v2, but key regex + size limit are real misses.

### Round 3 — Per-key rate limiting

**TNL surfaced and v2 missed:**
- Mid-window sliding-behavior test (at 1.5× window, allows ~limit/2)
- Denied-calls-don't-advance-counter test
- Cross-surface budget-sharing test

**v2 did better:**
- Nothing meaningful — algorithms are the same

**Silent interpretation deltas:**
- Algorithm choice (both converged on in-memory counter — v1 had chosen DB-backed event log, v2's plan-mode review selected the simpler approach)
- Header names (both `X-RateLimit-*`)

Round 3 gap: small on algorithm/production behavior, meaningful on test thoroughness. Keylo has 15 tests vs. v2's 6.

### Round 4 — List caller's KV keys (retrieval test)

This was the cold-start test for knowledge retrieval. An agent opens a fresh session in an existing codebase and is asked to add a cross-cutting feature.

**Both demonstrated good retrieval** of existing patterns: auth preHandler, rate-limit decorator, per-api-key isolation, key regex reuse for cursor validation, response shape conventions. In a ~1300-LOC codebase, code-reading and TNL-reading both work.

**TNL pulled ahead on design reasoning:**
- **Opportunistic delete on list** — keylo explicitly matches `GET /:key` expiry behavior. v2 filters expired rows in SQL but never deletes them, creating inconsistency with `get` (which does delete on access).
- **Scanned-vs-returned cursor semantics** — TNL explicitly reasoned about the interaction between lazy-delete-during-scan and cursor position. v2 didn't surface the issue.
- **Error-code specificity** — TNL had `invalid_limit` vs `invalid_cursor` distinct codes; v2 returned generic `invalid_query` with Zod details.
- **Prior-round overengineering leaks** — v2's list response includes `updatedAt` because v1 had added the column speculatively. That's now part of v2's public API.

**TNL produced a reviewable proposal artifact:**
- New `cnl/kv-list.cnl` file with `dependencies: [api-key-auth, kv-storage, rate-limiting]`
- Explicit references to other TNLs ("extends the 'exactly these routes' list in `rate-limiting.cnl`")
- Evidence the agent read the existing TNLs and reasoned about integration

### Round 5 — Case-insensitive keys (pure edit test)

This was the hardest test for TNL specifically, because it's a pure modification of existing behavior (not adding anything new). A naive TNL-creating agent would spawn a new file for the change, which would defeat the persistent-knowledge-base purpose.

**Initial slip caught in design:**
The TNL-side agent first tried to create a new `cnl/kv-case-insensitive-keys.cnl` file. This exposed a gap in the instructions: the task flow didn't distinguish edits from new features. Addressed by adding explicit "edit vs. create" rules to `CLAUDE.md` (now §2.9 of the implementation doc).

**After the CLAUDE.md fix, the TNL-side agent:**
- Edited `cnl/kv-storage.cnl` in place — added `COLLATE NOCASE` clause on schema, rewrote key-identity semantics, added behavior clauses for PUT casing-overwrite rules, added tests (s) and (t) to the existing test list
- Edited `cnl/kv-list.cnl` — added one clause that list ordering inherits case-insensitivity from the storage collation, added test (s)
- Declared pre-existing database migration as an explicit non-goal
- Implementation: 3 new test cases, all passing

**V2's approach:**
- Updated `src/db.ts` to add `COLLATE NOCASE` on the `key` column
- Added a migration function (`migrateKvKeyCollation`) that detects old schema and rebuilds the table — **more thorough than keylo on production deployment** (handles the case keylo explicitly punted)
- **Zero new tests.** No regression coverage for the new behavior.

**Net:** V2's implementation is arguably more complete in one dimension (DB migration). But V2 has no test that `PUT "Foo"` and `GET "foo"` actually returns the same entry. A refactor that accidentally breaks case-insensitivity would pass every test. Keylo has three explicit regression tests for the behavior.

This is the clearest single-round evidence that TNL's unique value is in *what gets written down and tested*, not in *what code gets written*.

---

## 5. What Principles + Plan Mode Got v2 (Credit Where Due)

These are the wins attributable to the four-principle `CLAUDE.md` section + plan-mode discipline. Any team can adopt these today, in under thirty minutes, with no new tooling.

- **Rate limit converged to in-memory counter** — plan mode caught that the raw baseline's DB-backed event log was overkill, and chose the same simpler algorithm keylo did.
- **Idempotent revoke** — caught and implemented; raw baseline had returned 404.
- **Flatter repository pattern** — plain exported functions instead of factory-returning-objects.
- **Specific error codes** — `missing_api_key`, `invalid_key`, `value_required`, `rate_limited` instead of generic blob responses.
- **Schema migration for case-insensitivity** — v2 detected the pre-existing-DB problem and wrote a migration; keylo's TNL explicitly deferred this.
- **Smaller test files, feature-focused** — easier navigation than keylo's single 546-LOC `kv.test.ts`.
- **Fake-clock injection** in tests — cleaner testing hygiene than keylo's SQL-based time manipulation.

This is a meaningful, cheap delta from a raw-agent baseline. The four principles plus plan mode is not a weak condition to beat.

---

## 6. What TNL Did Uniquely (The Wedge)

These are the outcomes the principles and plan mode did *not* produce in v2, and that required TNL's explicit-clause-enumeration approach to capture:

### 6.1 Invariant explicitness

V2 has **no value size limit**. A caller can `PUT` an arbitrarily large JSON payload; v2 will store it. This is a real production concern (memory pressure, SQLite row size) that "simplicity first" over-applied away.

V2 has **no key character regex**. `PUT /kv/../etc/passwd` validates. Fastify routing rejects some forms, but the validation layer doesn't. This is a security-adjacent gap.

TNL captured both as MUST clauses in `kv-storage.cnl`, with explicit numeric limits and explicit regex. Both survived all five rounds intact.

### 6.2 Reviewable intent artifacts

Every feature in keylo has a TNL file. Every edit has a diff against the TNL. A future engineer reading `cnl/kv-storage.cnl` sees the current behavior contract as a 90-line English document. A future engineer reading v2's code has to infer behavior from implementation; the `CLAUDE.md` is generic guidance, not a behavior snapshot.

When the case-insensitive edit happened, the TNL version produced a visible change to `kv-storage.cnl` that a reviewer could approve or reject *before* code was written. The v2 change went straight to implementation.

### 6.3 Cross-feature consistency

V2's `list` endpoint filters expired rows in SQL but never deletes them. V2's `get` endpoint deletes expired rows on access. These two behaviors are inconsistent and no one wrote down why.

TNL's `kv-list.cnl` has an explicit clause: *"Expired rows encountered during the scan MUST be excluded from the response AND opportunistically deleted, matching `GET /v1/kv/:key` behavior."* The cross-feature invariant is written down and testable.

### 6.4 Regression coverage on edited behavior

The case-insensitive edit is the clearest case. V2 changed the schema but added zero tests. Keylo added three explicit tests because the TNL enumerated them. If someone later refactors v2 and breaks case-insensitivity, tests pass. That won't happen on the TNL side without the TNL's test enumeration also being modified — a visible, reviewable change.

### 6.5 Scope fencing

V2's `updated_at` column was added speculatively in round 2, never used by round 2's feature, and now leaks into round 4's public `list` response as part of the JSON shape. This is the classic "we'll need this someday" YAGNI failure.

Keylo never added `updated_at` because the TNL scope said the feature didn't need it, and subsequent features didn't amend the scope.

---

## 7. Where v2 Did *Better* Than Keylo (Honest)

To be fair to the baseline condition:

- **Database migration for case-insensitivity.** V2 detected the pre-existing-schema case and wrote `migrateKvKeyCollation`. Keylo declared it a non-goal. V2 is more production-ready on this axis.
- **Fake-clock testing.** V2's pattern of injecting `now: () => clock` into the server factory is cleaner than keylo's approach of mutating `expires_at` via SQL to simulate time passing.
- **Smaller, feature-focused test files.** Nine files averaging ~55 LOC each vs. keylo's one 546-LOC kv.test.ts. Easier navigation for a future reader.
- **FK cascade and foreign-key enforcement.** V2 has `FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE` and `foreign_keys = ON` pragma. Even though no hard-delete path exists, this is defensive schema hygiene keylo skipped.
- **Plugin decorator pattern.** `app.decorate('rateLimit', ...)` and `app.decorate('requireApiKey', ...)` is cleaner Fastify idiom than keylo's factory-closure `makeRequireApiKey(db)` that's instantiated in each route file.

---

## 8. Missed Invariants — Side by Side

| Invariant | Keylo | v2 |
|---|:---:|:---:|
| Value size limit on PUT | ✓ 64 KB enforced + tested | ✗ no limit |
| Key character regex | ✓ enforced + tested | ✗ accepts any char |
| Admin/user separation tests | ✓ explicit | ✗ missing |
| Case-insensitive behavior tests | ✓ 3 tests | ✗ zero tests |
| Whoami probe route | ✓ | ✗ |
| URL `/v1/` versioning | ✓ consistent | ✗ inconsistent |
| FK cascade on api_keys | ✗ (punt) | ✓ |
| DB migration for case-insensitivity | ✗ (non-goal) | ✓ |
| Graceful DB shutdown on SIGINT | ✗ | ✗ |
| RateLimit response header standard (IETF) | ✗ (legacy X-prefix) | ✗ (legacy X-prefix) |

Neither is a complete specification. But keylo's gaps are in areas it *explicitly punted* (non-goals), whereas v2's gaps are in areas it silently didn't think about.

---

## 9. What This Means for TNL's Positioning

The evaluation sharpens the TNL pitch in three ways.

**First, the bar is higher than "TNL vs. nothing."**  
The principles-plus-plan-mode condition is cheap, already in use by many teams, and measurably effective. Any TNL positioning must acknowledge this and beat it, not a strawman. This evaluation shows TNL does beat it — but on narrower axes than the raw-baseline comparison suggested.

**Second, TNL's unique value clusters around explicit invariant capture and reviewable artifacts, not code quality.**  
Code quality improves roughly equally under principles-plus-plan-mode as under TNL. The unique TNL delta is:
- Invariants the agent wouldn't think to enumerate on its own (value limits, regex constraints, separation tests)
- Reviewable intent artifacts before code lands
- Cross-feature consistency clauses that travel with the code
- Regression tests for behavior changes (the case-insensitive edit is the proof)

**Third, TNL's overhead is real but small.**  
Keylo's TNL files total 379 LOC of English. That's the ongoing cost of the approach — written by agents, reviewed by humans, edited when behavior changes. On the benefit side: explicit invariants preserved across five rounds, catch-rate on missed behaviors measurably higher, durable behavior contracts future sessions can ground against.

**The honest pitch that emerges:**

> TNL is the layer above principles-plus-plan-mode. The principles are the floor — they clean up naive agent behavior. TNL adds explicit invariant enumeration and a persistent behavior contract that survives sessions, catches edge cases the agent wouldn't list, and forces design decisions into a reviewable form before code lands.
>
> The thesis worked on every round. The delta was smaller on rounds where invariants were obvious (rate limit), larger on rounds with hidden product decisions (auth separation, case-insensitive keys). For code with significant invariant density — security, compliance, multi-tenant, financial, or anything with non-obvious cross-feature consistency — TNL earns its overhead. For simpler services with obvious invariants, principles-plus-plan-mode may be sufficient.

---

## 10. Caveats on These Findings

- **Small codebase.** 1500–1600 LOC, three agents, four session rounds. The knowledge-retrieval advantage that TNL would presumably show on a 50K-LOC codebase is not testable here. Both mechanisms (code-reading retrieval and TNL-reading retrieval) worked in this size range.
- **Single-author review.** All TNL reviews were done by one human. A more rigorous evaluation would have blind review by someone who didn't write the prompts.
- **Prompts intentionally ambiguous.** The silent-interpretation findings depend on the prompts having real ambiguity. A more operational test would use production-shaped feature specs, which are often more specific.
- **No verifier tested.** The evaluation tested the content hypothesis (do TNL files shape agent behavior?). The verifier hypothesis (does CI-enforced clause checking prevent drift over time?) was not tested — no TNL verifier has been built yet.
- **Model held constant.** All sessions used Claude Code on the same model. Cross-model generalization (GPT-5, Gemini) is untested.

---

## 11. Recommendations From the Evaluation

### For the TNL build roadmap

1. **The four-principles + plan-mode baseline is now the condition to beat.** Any eval harness published should A/B against this, not against naive agents.
2. **Invariant explicitness is the strongest demonstrable benefit.** Case-studies and demos should foreground the kinds of invariants TNL catches that principles-plus-plan-mode doesn't (size limits, regex, separation tests, cross-feature consistency).
3. **The case-insensitive-keys edit is the cleanest single demo.** It shows TNL's unique value on a pure-edit task where the difference isn't code structure but regression coverage. Worth capturing as a reference example in the implementation doc.
4. **§2.9 ("TNL describes current state, not change history") is load-bearing.** The evaluation surfaced this as a real gap that needs to be in the CLAUDE.md task flow. This is now in place and should graduate to the implementation-doc design commitments.

### For anyone evaluating TNL adoption

- Start by adopting the four principles + plan mode in `CLAUDE.md`. It's free and measurably improves output.
- Adopt TNL on top of that if your code has one or more of: high invariant density (security, compliance, multi-tenant), frequent cross-feature consistency requirements, long-lived codebases where behavior drift is expensive, or teams where the cost of a missed invariant significantly exceeds the review overhead.
- For simple greenfield services with obvious behaviors, principles-plus-plan-mode may be sufficient.

---

## Appendix A — File Layout

### keylo

```
keylo/
├── cnl/
│   ├── workflow.cnl              (baseline principles, always read)
│   ├── api-key-auth.cnl
│   ├── kv-storage.cnl            (edited for case-insensitivity)
│   ├── kv-list.cnl
│   └── rate-limiting.cnl
├── src/
│   ├── config.ts, db.ts, index.ts
│   ├── auth/{keys.ts, plugin.ts}
│   ├── kv/store.ts
│   ├── rate_limit/{limiter.ts, plugin.ts}
│   ├── routes/{keys.ts, kv.ts, whoami.ts}
│   └── types/auth.ts
└── tests/
    ├── auth/keys.test.ts
    ├── kv/kv.test.ts             (546 LOC, holds all kv tests)
    └── rate_limit/{limiter,plugin}.test.ts
```

### keylo-baseline-v2

```
keylo-baseline-v2/
├── CLAUDE.md                     (includes the four principles)
├── src/
│   ├── app.ts, db.ts, index.ts
│   ├── plugins/{auth.ts, rateLimit.ts}
│   ├── repositories/{apiKeys.ts, kv.ts}
│   ├── routes/{adminKeys.ts, kv.ts}
│   └── types/{apiKeys.ts, kv.ts}
└── tests/
    ├── admin-keys/{issue,revoke}.test.ts
    ├── auth/validate.test.ts
    ├── kv/{delete,get,list,scope,set}.test.ts
    └── rate-limit/limit.test.ts
```

---

## Appendix B — Reproducibility Notes

All prompts used across the five rounds are preserved in the git history of each repo's sessions. The prompts deliberately include realistic ambiguity (TTL placement, key format, response shape, pagination scheme) so that the silent-interpretation findings are natural, not artificial. Agents ran in Claude Code with no mid-session coaching; interventions are documented in the evaluation narrative (e.g., the CLAUDE.md update mid-evaluation on new-file-vs-edit behavior).

The principles installed in v2 and encoded in keylo's `workflow.cnl` are identical in content:

1. Think before coding — ask when unsure, don't silently pick one interpretation
2. Simplicity first — minimum code; overengineering shows at a glance
3. Surgical edits — only touch what's required
4. Goal-driven — translate fuzzy instructions into verifiable targets before starting
