# TNL — Typed Natural Language for Coding Agents

### A persistent contract and knowledge layer between developer intent and code.

---

## The Two Problems That Must Be Solved Together

Coding agents today — Claude Code, Codex, Cursor agent mode — all follow roughly the same pipeline: **prompt → plan prose → generated code**. That plan may be useful in the moment, but it is not durable, not checkable, and not the artifact the system actually trusts. Once the session ends, the plan disappears. A future session has to recover intent from raw code, scattered docs, and terminal history.

This creates two distinct failure modes the industry has been trying to solve in isolation, and both attempts keep hitting a wall because they're the same underlying problem.

**Problem 1 — coding agents have no structural grounding.** Plans are prose. The LLM reads its own plan and generates code that may or may not implement what the plan said. Invariants are implicit. Scope creep is caught only by human diff review. 66% of developers say "almost right, but not quite" is their #1 frustration with AI coding tools. Only 3.8% report both low hallucination rates and confidence shipping AI code without review.

**Problem 2 — coding agents have no persistent codebase knowledge.** Every session starts from zero. The agent greps, reads files, loses-in-the-middle, fills context with debug output, and by turn 20 is reasoning from its own noise. Nearly a third of all improvement requests in the Qodo AI coding survey are literally: "make the agent aware of our codebase, team norms, and project structure."

Attempts to solve either problem in isolation have stalled. **Plan mode** (Claude Code, Codex `/plan`, Spec Kit, Kiro, Cline Deep Planning) partially solves #1 — you get a human-readable plan before implementation — but the plan is prose the LLM reads, nothing is enforced, and the plan is ephemeral. **Context files** (AGENTS.md, CLAUDE.md, embedded repo summaries) attempt #2 but drift silently the moment they're out of sync with code.

The insight: these two problems have the same root cause. There is no typed, checkable, persistent artifact between "what the developer wants" and "what the code does." Plan mode is structural but ephemeral. Context files are persistent but unstructured. **We need a single artifact that is both.**

That artifact is TNL — Typed Natural Language.

---

## The Core Shift

The key change is not that agents stop planning. It is that **ephemeral plan text stops being the source of truth.**

### Current pipeline
1. Developer writes a prompt.
2. Agent emits a markdown plan in the terminal.
3. Human approves it.
4. Agent writes code.
5. The plan vanishes with the session.
6. Later sessions reconstruct intent from implementation.

### TNL pipeline
1. Developer writes a prompt.
2. Agent reads relevant existing `.tnl` files first.
3. Agent proposes a **TNL diff** for the impacted behavioral units.
4. Human approves the **TNL diff**, not terminal prose.
5. Agent generates code, tests, and supporting changes from the approved TNL.
6. Verifier checks code against TNL.
7. TNL and code are checked into Git together.
8. Future sessions start from TNL as the primary behavioral knowledge base.

### With or without plan mode

TNL does not require plan mode to disappear. Two valid flows:

- **Without plan mode:** prompt → TNL diff → approval → code/tests → verifier
- **With plan mode:** prompt → TNL diff → optional rendered "plan summary" → approval of TNL → code/tests → verifier

If a CLI still shows a plan, that plan is a **projection of the TNL delta**, not the canonical artifact. The contract is TNL.

---

## What TNL Is

TNL is not a freeform markdown note and not a DSL. It is a **hybrid contract format** with three zones:

1. **Machine zone** — strict, schema-validated. Identity, ownership, paths, surfaces, dependencies. Small, fixed, obvious.
2. **Contract zone** — English clauses that carry meaning. Behaviors, invariants, permissions, errors, non-goals. Written as ordinary sentences.
3. **Human zone** — free prose. Rationale, examples, reviewer notes.

A TNL file describes a **behavioral surface** — login rate limiting, user invitation flow, API key revocation, CSV export for audit logs. Not a source file. Not a giant feature bundle. Named things a product team would recognize.

### Core design commitment

**TNL files contain only what a human would write on a whiteboard. All machine-required metadata — clause IDs, verification modes, evidence pointers, hashes — is resolved and maintained by the `tnl` tool in a sidecar file. This is the same split as `package.json` / `package-lock.json`.**

Developers live in the English file. Agents read the English file. Tools maintain the plumbing.

### What a TNL file looks like

```
id: auth-login-rate-limiting
title: Login rate limiting
owners: [@jana]
paths: [src/auth/login.py, src/middleware/rate_limit.py]
surfaces: [POST /auth/login]

intent:
  Protect the login endpoint from brute-force attacks by limiting attempts per client IP.

behaviors:
  - The system MUST check the rate limit before validating credentials.
  - When rate limit is exceeded, the system MUST respond with 429 and set Retry-After.
  - The rate limit window MUST be 15 minutes with a maximum of 5 attempts.
  - [semantic] The rate limit key MUST be derived from the client IP, not from any user-controllable header.

non-goals:
  - Per-account rate limiting is out of scope for this unit.

rationale:
  IP-based limiting chosen over account-based because attackers typically rotate usernames.
```

Clean English inside a small, fixed skeleton. A developer reads this in 20 seconds. No DSL to learn.

### What the tool-maintained sidecar looks like

`/tnl/.resolved/auth-login-rate-limiting.meta.json`:

```json
{
  "unit_hash": "8f3a2b...",
  "resolved_at": "2026-04-20T14:32:11Z",
  "clauses": {
    "L-1": {
      "hash": "a1b2...",
      "class": "hard",
      "verify": "ast-order-check",
      "evidence": "src/auth/login.py:check_rate_limit before verify_credentials"
    },
    "L-2": {
      "hash": "c3d4...",
      "class": "test-backed",
      "verify": "test",
      "evidence": "tests/auth/test_login.py::test_rate_limit_returns_429"
    },
    "L-4": {
      "hash": "e5f6...",
      "class": "semantic",
      "verify": "llm-discriminator",
      "evidence": null
    }
  }
}
```

Developer never opens this. Both files commit to Git. The sidecar is generated by `tnl resolve`, runs in milliseconds, is stable under whitespace changes (clause IDs derived from content hashes).

### Controlled natural language — the grammar that actually matters

The verifier does not parse English grammar. It scans for a small set of RFC 2119 keywords that carry classification meaning:

- **MUST / MUST NOT** → hard constraint (default: `class: hard` or `test-backed`)
- **SHOULD / SHOULD NOT** → advisory (default: `class: advisory`)
- **MAY** → permission, not requirement

Developers learn this in one minute. The `[semantic]` prefix is an explicit override when a clause needs LLM-based discrimination rather than deterministic checking. All other clause classification is inferred by the tool — the developer doesn't think about it.

This is the smallest amount of grammar that earns its keep. Keywords you already know, used the way RFCs have used them for decades.

---

## End-to-End Flow

A developer types in Claude Code: *"Add rate limiting to login, 5 per IP per 15 min."*

1. **Retrieval.** Agent reads existing `/tnl/auth-*.tnl` files. Cheap — a few hundred tokens of ground truth instead of grepping through tens of thousands of tokens of source.
2. **TNL diff proposal.** Agent proposes a new or updated `.tnl` file. Developer reviews 15-30 lines of English, edits if needed, approves. Intent is pinned down here, before any code is generated.
3. **Resolution.** `tnl resolve` runs on the approved file. Classifies clauses (MUST/SHOULD keywords + `[semantic]` overrides → class), generates stable clause IDs from content hashes, writes the sidecar. Milliseconds.
4. **Code + test generation.** Agent writes implementation and tests constrained by the clauses. Knows which clauses need named tests because the sidecar says so.
5. **Verification.** `tnl verify` runs. For each clause:
   - Structural clauses: declared paths exist, dependencies resolve, optional per-clause text predicates match
   - Test-backed clauses: the named test (`[test: file::name]` annotation) still exists by literal-string lookup
   - Semantic clauses: invoke a bounded LLM discriminator that must cite evidence (deferred; v1 uses generation-time context + agent self-attestation)
   - Advisory clauses: reported, not gated
   - Test execution itself is **not** the verifier's job — the user's existing test runner (npm test / pytest / go test / whatever) and their CI already run tests on every PR. The verifier only checks that the tests a clause depends on have not silently disappeared.
6. **Typed feedback loop.** Violations feed back to the agent as typed errors: *"L-5 failed (test-backed): declared test 'returns_429_on_exceeded' not found in tests/rate_limit.test.ts."* Agent fixes, re-verifies.
7. **PR lands** with three diffs: the `.tnl` file, the sidecar, and the code + tests.
8. **Ongoing enforcement.** CI runs `tnl verify` on every future commit. If someone changes Python and breaks L-1, CI fails — drift is caught structurally, not by PR review.
9. **Next session reads TNL first.** An agent that opens the repo next week reads the `.tnl` file (15 lines) to understand login rate limiting. Ground truth in a few hundred tokens instead of lost-in-the-middle across the implementation.

---

## The Verifier

The verifier is the part that makes TNL real. It is not "an LLM reads code and vibes out whether it matches." It is a **layered verifier** with explicit clause classes — and, critically, **language-agnostic**. It does not parse TypeScript, Python, Go, Rust, or any other target language. No AST, no tree-sitter, no framework-specific knowledge. The verifier owns **structural contract integrity**; the user's existing test runner and CI own behavioral correctness.

### Layer 1 — structural contract checks

Every declared `paths:` entry exists on disk. Every `dependencies:` entry resolves to a real TNL. Optional per-clause text predicates (literal-string or regex matches inside declared files) are checked by grep-level search. No code parsing at any tier.

### Layer 2 — test-binding integrity

Each `test-backed` clause carries an inline `[test: <file>::<name>]` annotation. The verifier opens `<file>` and does a literal-string search for `<name>`. The clause passes iff the name is still present.

**The verifier does not execute the test.** Whether the test passes at runtime is the user's test runner's job — invoked by their CI on every PR, by their agent during sessions, and by them locally. The verifier's unique contribution is catching **test-deletion drift**: a passing test suite that no longer covers clause L-5 because someone silently removed the test in a refactor. CI alone cannot catch this. The verifier does.

### Layer 3 — semantic adjudication (deferred)

Bounded LLM-based discrimination, only for invariants that cannot be structurally checked and are hard to encode as a test. The LLM must cite evidence spans or tests — discrimination with required citation, not synthesis. **v1 does not ship this layer.** `[semantic]` clauses are instead injected into the agent's generation-time context and surfaced in end-of-task self-attestation. A dedicated CI discriminator lands post-v1 if the formal evaluation shows structural + test-backed tiers are insufficient.

### Clause enforcement classes

Not every clause blocks CI equally:

- **structural** — checked by Layer 1 (file / dependency / text predicate); blocking
- **test-backed** — has an inline `[test: file::name]` annotation, checked by Layer 2; blocking
- **semantic** — `[semantic]` prefix; generation-time context + agent self-attestation in v1 (Layer 3 deferred); advisory by default
- **advisory** — SHOULD / MAY only; reported, not gated

This keeps the system strict where it can be strict and honest where it cannot. Behavioral invariants that need runtime verification live in tests — the clause cites the test, the verifier catches drift if the test goes missing, the user's CI runs the test as always. A TNL file can ship on day one with only structural and test-backed clauses; semantic tier grows when the deferred LLM work lands.

---

## Why This Matters

**For developers**
- Review intent before code. 20-30 lines of English diff, not 400 lines of Python.
- Reproducibility at the behavior level — same TNL yields behaviorally equivalent code across runs, models, and CLIs.
- Scope creep becomes a compile error. Documentation stays accurate by construction.

**For agents**
- Persistent, token-cheap knowledge base. Reading `/tnl/` beats grepping and losing-in-the-middle on 50K tokens of source.
- Structural grounding. Code generation is constrained by explicit clauses, not by vibes from a plan.
- Typed feedback loops replace vague retry cycles. Fewer turns, cheaper sessions.

**For teams**
- Persistent, shared knowledge across sessions and tools.
- Less dependence on any one vendor's proprietary plan or context format.
- CI-enforced drift detection — TNL cannot go stale silently.

**For the ecosystem**
- A path to deterministic compilation for common patterns. As TNL shapes recur across thousands of files, those shapes become directly compilable — the LLM's role collapses to "produce TNL from English" and codegen becomes mechanical for the common case. The long arc: natural language converging toward compiled execution.

---

## What This Explicitly Is Not

- **Not a DSL.** Developers write ordinary English inside a small fixed skeleton.
- **Not another plan mode.** Plan mode is ephemeral prose. TNL is persistent, verified, and serves as the codebase's behavioral knowledge base.
- **Not AGENTS.md / CLAUDE.md.** Those are freeform and drift silently. TNL is structured and fails CI when it drifts.
- **Not Spec Kit / Kiro / Deep Planning.** Those are spec-driven tools where an LLM reads a spec and hopes. TNL's wedge is the verifier — code is mechanically checked against TNL, not merely prompted from it.
- **Not model-specific or CLI-specific.** Any LLM that reads English and emits code can be driven by TNL. The verifier is model-agnostic.

---

## Integration Strategy — Open Source, Vendor-Neutral Core

TNL is built as a **vendor-neutral core** with thin adapters per coding agent.

### Core framework
- TNL parser/compiler, IR, verifier, impact analyzer, test derivation, `tnl` CLI
- Commands: `tnl init`, `tnl resolve`, `tnl diff`, `tnl impacted`, `tnl verify`, `tnl test-plan`, `tnl trace`
- Distributed on npm as `@tnl/cli`; `npx create-tnl` is the idiomatic first-time scaffolder

### Repo-native baseline (works with any MCP-capable agent, day one)
- `/tnl/**/*.tnl` + `/tnl/.resolved/*.meta.json`
- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` instructions pointing agents at TNL-first retrieval
- Pre-commit hook + CI verification

### MCP server (richer agent integration)
Expose TNL as tools: resolve relevant units, propose TNL diffs, verify code against TNL, derive tests, explain violations. MCP is the primary cross-agent interface — any MCP-capable agent gets the core flow.

### Native adapters (v1)
- **First-class: Claude Code** — hooks (`PreToolUse`), `/tnl-feature` skill, plugin packaging (Path B)
- **Basic tier: Codex, Gemini CLI** — instruction-file stanza + MCP registration (no hooks available yet)
- **Deferred post-v1**: Cursor, Aider, Continue.dev, Windsurf (work via universal MCP tier; no dedicated adapter)

### Enforcement in three places
1. **Before generation** — repo guidance and skills point agents at TNL retrieval
2. **During generation** — MCP and lifecycle hooks enforce the TNL-diff flow
3. **After generation** — deterministic CI verification gates merges

Instructions alone are not enough. True enforcement comes from hooks, verifiers, and merge gates.

### Adoption order

File format first, then CI verifier, then MCP. A team should be able to adopt TNL by adding files to their repo and a CI action, with no MCP setup. MCP becomes the enhancement for agents that want richer retrieval than file reads.

---

## Open Questions — Where We Need Your Pushback

These are the frictions we genuinely have not solved. They're not details — they're the questions that determine whether TNL is a real product or a whiteboard exercise.

### 1. Multi-feature sessions

"Build me the admin dashboard with roles, user management, audit logs, CSV export" touches four-plus behavioral surfaces in one prompt. The agent will propose a batch of TNL diffs. Does the human approve each one, or all at once? What happens when implementing one TNL changes what the next TNL should say? What's the UX that preserves "review intent before code" without turning every session into a 20-step approval workflow?

### 2. Bootstrapping into existing codebases

Greenfield projects adopt TNL from day one. A 500K-LOC existing repo cannot have TNL hand-written. Is there a feasible auto-generation path — run an agent over the codebase, emit TNL for current behavioral surfaces, have a human review? Is the quality ceiling of auto-generated TNL good enough to bootstrap from, or does it become "AGENTS.md with extra steps" and drift just as fast?

### 3. Semantic verifier reliability

The thesis — LLM-as-discrimination-oracle is more reliable than LLM-as-synthesizer — is defensible in principle. But LLM-based verification has its own failure modes: false positives block legitimate code, false negatives let drift through silently, non-determinism makes CI flaky. What's the measurement approach that lets semantic clauses graduate from advisory to gating with confidence? What's the fallback when the discriminator is genuinely uncertain?

### 4. Classification inference quality

The tool infers clause class from RFC 2119 keywords plus heuristics, with `[semantic]` as the escape hatch. How often does the default classification get it wrong in practice? If the miss rate is non-trivial, we push developers back toward explicit per-clause metadata — which collapses the "frictionless English" promise.

### 5. Sync cadence under refactoring

Most code changes don't change behavior — renames, refactors, library upgrades. TNL shouldn't churn on those, and the verifier shouldn't cry wolf. But some refactors do surface behavioral implications that should be captured. What's the mechanism that correctly distinguishes behavioral from cosmetic changes without asking the developer every time?

---

## Where We Are

TNL is a design bet, not an implementation. The core claim — that knowledge-base and structural-grounding are the same problem and must be solved together — feels right. The shape of the answer — hybrid file format (machine + contract + human zones), tool-maintained sidecar for metadata, layered verifier with clause classes, CLI-agnostic core — resolves the design tensions we've been wrestling with.

The frictions above are where we need help from people who have built developer tools, worked inside coding agents, or shipped spec-driven systems. The most valuable feedback is which of the five open questions is the *hardest*, and whether you see a sixth we haven't named.
