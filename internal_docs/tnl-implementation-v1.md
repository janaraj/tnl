# TNL — Implementation Specification (v1)

> Companion to `tnl-one-pager-v2.md`. The one-pager is the pitch. This document is the build spec — what we're actually going to implement, in what order, with what boundaries.

---

## 1. What We're Building

A persistent, typed, verifiable contract layer between developer intent and generated code, designed to serve as both the **knowledge base** that coding agents read before generating and the **structural guardrail** that constrains what they produce.

The deliverable is five things shipped together:

1. **A file format** — English clauses in a fixed skeleton, plus a tool-maintained sidecar
2. **A CLI** (`tnl`) — resolves, verifies, diffs, reports impact, and initializes projects via `tnl init`
3. **An MCP server** — exposes TNL retrieval, proposal, verification, and trace as tools to any MCP-capable coding agent
4. **Agent integrations** — reference first-class integration with Claude Code (CLAUDE.md stanza, skill, `PreToolUse` hook) and basic-tier integrations with Codex and Gemini CLI (AGENTS.md / GEMINI.md stanzas + MCP registration)
5. **An evaluation harness** — the with/without comparison that validates (or kills) the thesis at the Path A → Path B boundary

Built in that order. The PoC go/no-go checkpoint comes at the end of Path A; the full eval comes in Path B.

### Host language and distribution

- **TypeScript / Node 20+** is the implementation language.
- **Distribution via npm** (`@tnl/cli` and `@tnl/mcp-server` packages, installable via `npx` or global install).
- Rationale: npm is the lowest-friction distribution channel for any-language-target dev tools. Aligned with Claude Code's own ecosystem. The verifier is language-agnostic by design (no AST parsing of target code — see §5), so TypeScript as the host language does not constrain which languages TNL can govern. Future performance work (e.g., Rust rewrite of hot paths, à la Biome) remains possible while keeping npm as the distribution surface.

### Operational phase model

Development proceeds in discrete phases tracked in [`phase-plan.md`](./phase-plan.md). Path A is the PoC with a go/no-go checkpoint at A7; Path B is the post-go formal eval + release prep. Phases are gated by completion, not by calendar.

---

## 2. Design Commitments

These are the reframes we converged on during design discussion. They are load-bearing — every implementation decision below falls out of these.

### 2.1 Users don't write TNL; agents do

The user communicates in ordinary natural language, exactly as they do in a Claude Code / Codex session today. The agent proposes a TNL diff. The user reviews 15–30 lines of English and approves. TNL is an **agent-generated, user-reviewed** artifact. This is the only way the adoption math works — if users had to hand-write TNL, the friction floor would be too high.

### 2.2 Hot-path adoption, not bulk migration

Existing repos adopt TNL organically: as features get touched, TNL is generated for the affected surfaces. Uncovered surfaces fall back to today's grep-and-read behavior (graceful degradation). No requirement to backfill a 500K-LOC repo on day one. Optional bulk auto-generation exists for teams that want it, but is not the default path.

### 2.3 Two-file split, like `package.json` / `package-lock.json`

The `.tnl` file is plain English + a small fixed skeleton — the only thing humans ever read or edit. Everything machine-required (clause IDs, hashes, verification modes, evidence pointers) lives in a sidecar maintained by the `tnl` CLI. Both files commit to Git. Developers never open the sidecar.

### 2.4 Guardrails at generation time, verification as backstop

The primary mechanism by which TNL improves agent output is **clauses injected into the agent's context at generation time**. That's where the "less shallow tool use / fewer skipped plan steps / fewer missed invariants" wins come from. Verification is the drift-detector that runs in CI — important, but secondary in terms of where the value comes from.

This means semantic (LLM-assisted) verification is **not the wedge**. The wedge is the deterministic + test-backed verification layer, which is cheap, reliable, and non-flaky. Semantic verification is a tiered add-on, mostly deferred from v1.

### 2.5 Configurable gating, not hard-gate-by-default

Every clause class (hard, test-backed, semantic, advisory, manual) has a per-project configurable enforcement level. Soft-gated by default on first install. Teams tighten to hard gates as clause quality and verifier reliability are measured. This eliminates the day-one "CI is blocking my PR for vague reasons" failure mode that kills verification tools.

### 2.6 MCP is the integration wedge, not a v2 nicety

CLAUDE.md / AGENTS.md instructions are a soft nudge that agents skip under session pressure. The MCP server turns TNL retrieval and verification into **tools the agent reaches for naturally**, which is the only reliable mechanism we have for consistent cross-agent behavior. MCP ships in v1.

### 2.7 Encoding over verifying

Semantic clauses are scaffolding. Every time one catches a real violation, the team should convert it to a test-backed or deterministic clause. The semantic:deterministic ratio should *drop* over time. A clause that stays semantic forever is probably too vague to be useful — that's a design signal, not a feature.

### 2.8 Zero TNL-owned LLM calls in v1

TNL does not run its own model. All LLM-level reasoning — proposing a TNL diff, reading clauses during code generation, self-attesting on semantic clauses at end of task — happens inside the coding agent's existing session, using the coding agent's existing context. The `tnl` CLI, the MCP server, and the sidecar generator are all deterministic tooling.

This has concrete consequences:

- **No incremental LLM cost** for teams adopting TNL. The agent already has a context; we just inject TNL into it.
- **No verifier-vs-generator drift.** The entity reading the clause and the entity writing the code are the same entity, in the same turn, with the same understanding.
- **No model-choice bikeshedding.** TNL has no opinion about which model verifies, because TNL doesn't verify with a model.
- **No new failure modes** from a separate verifier producing different verdicts than the agent that wrote the code.

The only place this property could change is **tier 3 (standalone CI semantic verifier, deferred)**. CI runs async with no agent session, so a tier 3 verifier would need *some* way to evaluate semantic clauses at merge time. Whether that's a separate LLM call, a different mechanism, or something else we haven't designed yet is **TBD — to be decided when tier 3 is built, not now**. The v1 commitment is zero.

### 2.9 TNL files describe current state, not change history

TNL files are snapshots of what a behavioral surface currently is. They are not change logs, not historical records, and not a diary of edits. When behavior changes, the TNL for that surface is edited in place — not supplemented with a new TNL file describing "the change."

Concrete consequences:

- **Edits are edits.** Modifying validation, semantics, constraints, or any property of an existing surface updates the existing TNL. No new file.
- **New files are for new surfaces.** A new TNL file is justified only for: a genuinely new behavioral surface, a cross-cutting policy spanning multiple existing TNLs (e.g., `workflow.tnl`), or a feature with a clear boundary not already covered.
- **A cold-start agent reading `tnl/<surface>.tnl` gets the truth about that surface today.** They don't need to hunt for supplementary files or reason about which version of reality a given TNL describes.

This rule is encoded in the [task-flow section of CLAUDE.md](../CLAUDE.md) ("Scope the task") and enforced via the agent's TNL-proposal behavior. Silent creation of a supplementary TNL for an edit to an existing surface is a process failure.

---

## 3. File Format

### 3.1 Unit — what a `.tnl` file describes

A single **behavioral surface** — login rate limiting, user invitation flow, CSV export for audit logs. Not a source file, not a feature bundle, not a sprawling epic. Something a product team would recognize by name.

Coverage heuristic: if it has a clear input, a clear output, and one or more invariants a reviewer could check, it's probably a behavioral surface. If it's "the database layer" or "utility functions," it's not.

### 3.2 Three zones

1. **Machine zone** — schema-validated metadata: id, title, owners, paths, surfaces, dependencies
2. **Contract zone** — English clauses with meaning: behaviors, invariants, non-goals, errors, permissions
3. **Human zone** — free prose: intent, rationale, reviewer notes, examples

### 3.3 Canonical example

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

### 3.4 Grammar — the minimum viable

The verifier does not parse English. It scans for RFC 2119 keywords, which is grammar developers already know:

- `MUST` / `MUST NOT` → hard or test-backed clause (classified by what the clause describes)
- `SHOULD` / `SHOULD NOT` → advisory
- `MAY` → permission, non-constraining
- `[semantic]` prefix → explicit override for LLM-based discrimination

Clause classification is inferred by the tool. Developers only think about this when they use the `[semantic]` escape hatch.

### 3.5 Sidecar (`/tnl/.resolved/<id>.meta.json`)

Generated by `tnl resolve`. Stable under whitespace changes because clause IDs derive from content hashes.

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

### 3.6 Repo layout

```
/tnl/
  auth-login-rate-limiting.tnl
  user-invitation-flow.tnl
  ...
  .resolved/
    auth-login-rate-limiting.meta.json
    ...
  .tnl-config.yaml    # project-level gating + verifier config
```

---

## 4. `tnl` CLI

### 4.1 Commands

| Command | Purpose |
|---|---|
| `tnl init` | Scaffold `/tnl/` directory, config, starter CLAUDE.md/AGENTS.md stanza |
| `tnl resolve [path]` | Regenerate sidecar for one or all TNL files |
| `tnl diff <file>` | Show clause-level diff between working tree and HEAD, in human-readable form |
| `tnl impacted <paths...>` | List TNL units whose `paths:` or `surfaces:` overlap with given code paths |
| `tnl verify [--strict\|--advisory]` | Run the layered verifier across the repo |
| `tnl trace [--since=<ref>]` | Show which clauses were retrieved and cited by agents in recent sessions |
| `tnl test-plan <unit>` | Emit the list of tests required by test-backed clauses in a unit |

### 4.2 Execution properties

- `tnl resolve` runs in milliseconds on a typical unit. Idempotent.
- `tnl verify` runs the deterministic + test-backed layer in seconds; semantic layer (when enabled) is bounded by number of semantic clauses × per-clause LLM call budget.
- Exit codes: 0 = pass, 1 = advisory violations only, 2 = hard/test-backed violations, 3 = tool error.

### 4.3 Config file (`.tnl-config.yaml`)

```yaml
gating:
  hard: blocking            # blocking | advisory | off
  test-backed: blocking
  semantic: advisory        # default advisory in v1; teams can promote
  advisory: report-only

verifier:
  semantic:
    enabled: false          # off by default in v1
    model: claude-haiku-4-5
    cache: true

retrieval:
  include: [/tnl/**]
  exclude: []
```

---

## 5. Verifier Architecture

### 5.1 What the verifier is for — and what it isn't

The verifier exists to keep **contract integrity** intact over time. It does not run tests, parse code, or reason about behavior. Those jobs already belong elsewhere:

| Concern | Owner |
|---|---|
| Does the test pass? | The user's existing test runner + CI |
| Does the code do the right thing? | The user's test suite + code review |
| Does the named test *still exist*? | **TNL verifier** |
| Do the files declared in `paths:` still exist? | **TNL verifier** |
| Do declared `dependencies:` resolve to real TNLs? | **TNL verifier** |
| Is this clause's semantic intent genuinely met? | Tier 3 LLM discriminator (deferred) |

That's the entire scope. Everything the verifier does is **structural contract integrity** — the kind of drift that silently rots a passing test suite: tests get deleted in a refactor, TNL paths get stale, dependencies dangle. CI alone doesn't flag these. The verifier does.

Crucially, the verifier is **language-agnostic**. It does not parse TypeScript, Python, Go, Rust, or any other target language. No tree-sitter, no AST, no framework-specific knowledge. This keeps the tool's maintenance surface flat regardless of how many languages adopters use.

### 5.2 Three enforcement tiers

**Tier 1 — Structural contract checks (language-agnostic).**
- Every `path:` declared by a TNL exists on disk at the declared location.
- Every `dependencies:` entry (another TNL id) resolves to a real TNL file in `tnl/`.
- Optional per-clause text predicates: a clause MAY name a required substring or regex in a specific file (e.g., *"`src/config.ts` MUST contain the literal `KEYLO_ADMIN_TOKEN`"*). These are file-level string searches, not AST queries.

**Tier 2 — Test-binding integrity (language-agnostic).**
- Each `test-backed` clause carries an explicit `[test: <file>::<name>]` annotation (see 5.4 for syntax).
- Verifier opens `<file>` and performs a literal-string search for `<name>` in the file contents. Passes if the name appears; fails otherwise.
- **The verifier does NOT execute the test.** Whether the test passes at runtime is the user's test runner's job (run by their CI, by their agent during sessions, and by them locally).
- The verifier's job is to detect *deletion, renaming, or loss* of the test that a clause claims is its proof. That's the drift signal CI doesn't catch on its own.

**Tier 3 — Semantic adjudication** *(deferred — scaffolded in v1, off by default)*.
- For `[semantic]` clauses that cannot be structurally checked, an LLM discriminator answers PASS / FAIL / UNCERTAIN with required citation.
- v1 ships no LLM-based verification. The `[semantic]` class is recognized by the parser and included in the agent's generation-time context, plus end-of-task self-attestation — no separate CI verifier call.
- **Whether tier 3 eventually uses a dedicated LLM call, an agent session invoked from CI, or some other mechanism is TBD at tier-3 build time.** v1 commits to zero TNL-owned LLM calls.

### 5.3 Clause classes and default gating

| Class | Default verify | Default gate (v1) |
|---|---|---|
| `structural` | Tier 1 (file / dep / optional text match) | blocking |
| `test-backed` | Tier 2 (test-name grep) | blocking |
| `semantic` | Generation-time context + agent self-attestation | advisory (tier 3 deferred) |
| `advisory` | Reported only | report-only |

(`hard` was the A2 resolver's name for what is now called `structural`. The A5 phase renames the class and updates the resolver accordingly.)

### 5.4 Clause annotations — `[semantic]` and `[test: ...]`

Two inline annotations a clause may carry, both leading-prefix:

```
# structural MUST clause — tier 1
- The service MUST read KEYLO_ADMIN_TOKEN from the environment at startup.

# test-backed MUST clause — tier 2
- [test: tests/rate_limit.test.ts::returns_429_on_exceeded] The service MUST respond 429 with Retry-After when the rate limit is exceeded.

# semantic MUST clause — tier 3 (deferred)
- [semantic] The rate-limit key MUST be derived from the client IP, not from any user-controllable header.
```

Syntax rules:
- `[semantic]` and `[test: …]` MUST appear at the **start** of the clause text (leading-prefix only). Mid-clause occurrences are not recognized.
- `[test: <file>::<name>]` — `<file>` is a path relative to the repo root; `<name>` is a literal string expected to appear in the file. Both are required.
- A clause MAY combine `[semantic]` with a MUST behavioral statement; in that case class is `semantic` and tier 2/1 do not apply.
- A clause MAY carry `[test: …]`; in that case class is `test-backed`, regardless of other keywords.

Classification precedence (resolver): `[semantic]` > `[test: …]` > MUST/MUST NOT → `structural` > SHOULD/SHOULD NOT/MAY → `advisory` > error.

### 5.5 What gets checked (and what doesn't)

| Check | Where | Notes |
|---|---|---|
| Declared `paths:` files exist | Tier 1 | Filesystem stat |
| `dependencies:` resolve to real TNLs | Tier 1 | Filesystem stat |
| Per-clause text predicate (if declared) | Tier 1 | Grep in declared file |
| `[test: f::n]` — `f` exists and contains `n` | Tier 2 | Grep in `f` |
| Does the test PASS | *not our concern* | User's test runner / CI |
| AST-level code structure | *not our concern* | Not parsed; use tests or `[semantic]` |
| Semantic behavioral correctness | Tier 3 (deferred) | LLM discriminator |

### 5.6 Feedback loop into the agent

When verification fails, the agent receives a typed, clause-scoped error:

```
L-5 failed (test-backed): declared test 'returns_429_on_exceeded' not found in tests/rate_limit.test.ts
L-2 failed (structural): declared path 'src/auth/rate_limit.py' does not exist
```

The error references the clause ID and the class. The agent (or the developer) can fix and re-verify. No log dumps from the test runner — the user's existing CI handles test-failure reporting via its normal test-runner output.

---

## 6. MCP Server

The MCP server is the mechanism that makes the TNL flow happen reliably across CLIs. It exposes TNL operations as agent tools.

### 6.1 Tools

| Tool | Purpose |
|---|---|
| `get_impacted_tnls(paths)` | Given code paths the agent intends to edit, return the relevant `.tnl` files |
| `retrieve_tnl(ids)` | Fetch full TNL content for the listed units |
| `propose_tnl_diff(intent, impacted_ids)` | Agent submits a proposed TNL diff; server validates structure and returns it for user approval |
| `approve_tnl_diff(diff_id)` | Records approval, triggers `tnl resolve` |
| `verify(paths)` | Runs the verifier on the given scope, returns typed violations |
| `trace(session_id)` | Records which clauses were retrieved + cited during the session |

### 6.2 Why this matters for adoption

With MCP, the TNL flow is tool-driven. The agent's natural tool-selection behavior handles the "when" — if it's about to edit a path and there's a `get_impacted_tnls` tool, it calls it. Without MCP, compliance depends on CLAUDE.md instructions, which get skipped.

MCP is also the observability layer. `trace()` records what was actually retrieved and cited per session — the signal for answering "is the agent using TNL, or paying it lip service?"

### 6.3 MCP tools do not host LLMs

The MCP server is a deterministic tool surface. None of its tools invoke a model internally:

- `propose_tnl_diff` accepts a diff the coding agent already generated in its own context, then validates structure and stores it. It does not generate the diff.
- `verify` shells out to the `tnl` CLI (tiers 1 and 2 — both deterministic).
- `get_impacted_tnls`, `retrieve_tnl`, `trace`, `approve_tnl_diff` are pure lookups / writes.

This is the mechanism by which §2.8 (zero TNL-owned LLM calls in v1) is realized. The coding agent remains the sole LLM in the loop; MCP is plumbing.

### 6.3 Installation

Bundled with `tnl init` — no separate install step. The installer writes the MCP server entry into Claude Code's config (and Codex config if detected).

---

## 7. CLI Integrations

The TNL flow is enforced through a stack of mechanisms — weakest to strongest. v1 uses the full stack for Claude Code; other CLIs get baseline + MCP only.

### 7.1 Stack

1. **CLAUDE.md / AGENTS.md instructions** — baseline. Universal across CLIs. Soft nudge.
2. **`/tnl-feature` skill (Claude Code)** — named flow. Wraps read → propose → approve → implement → verify as a single user-invocable command.
3. **MCP server** — surfaces TNL as tools. Agents reach for them during normal tool-selection.
4. **`PreToolUse` hook on Edit/Write (Claude Code)** — enforcement. Inspects the target path, fetches impacted TNLs, blocks the edit until a TNL diff has been proposed and approved. This is the layer that doesn't rely on agent compliance.
5. **CI action** — catches drift at merge time regardless of what happened in-session.

### 7.2 v1 integration matrix

| Mechanism | Claude Code | Codex | Gemini CLI | Cursor |
|---|---|---|---|---|
| Instruction file stanza | CLAUDE.md ✓ | AGENTS.md ✓ | GEMINI.md ✓ | deferred |
| MCP server | ✓ | ✓ | ✓ | deferred |
| Skill / slash command | ✓ `/tnl-feature` | deferred | deferred | deferred |
| Lifecycle hooks | ✓ `PreToolUse` | not available today | not available today | deferred |
| CI action | ✓ | ✓ | ✓ | deferred |

**v1 tiers:**

- **Universal tier** (all MCP-capable agents): `tnl` CLI + MCP server + generic instruction-file writer. Works anywhere MCP works.
- **First-class** (Claude Code): hooks, skill, and future plugin packaging. Reference integration.
- **Basic tier** (Codex, Gemini CLI): instruction-file stanza + MCP registration. No hooks (not available in those agents yet).
- **Deferred post-v1**: Cursor, Aider, Continue.dev, Windsurf, and similar. MCP works universally, but no dedicated `tnl init --agent <name>` branch.

Claude Code is the reference integration because it's the only CLI that currently exposes lifecycle hooks strong enough for the enforcement layer. Codex and Gemini CLI ship the universal+instruction-file+MCP subset, which is sufficient for the core TNL flow — just without the block-on-unapproved-edit enforcement that the Claude Code hook provides.

---

## 8. The Installer — `create-tnl` + `tnl init`

One command. Does everything. Three equivalent invocations:

| Form | When |
|---|---|
| `npx create-tnl` | First-time setup, shortest form, npm's standard scaffolder convention (like `create-react-app`). |
| `npx @tnl/cli init` | First-time setup, explicit form without a global install. |
| `tnl init` | Any subsequent invocation, after `npm install -g @tnl/cli` or from a local install. Used for re-init as well. |

`create-tnl` is a thin wrapper package (~10 lines) that installs `@tnl/cli` and runs `tnl init`. All three forms end up executing the same `init` logic. The main CLI binary is `tnl`, not `create-tnl` — `create-tnl` exists only to provide the idiomatic npm-scaffolder entry point.

### 8.1 What it does

1. Creates `/tnl/` directory with `.resolved/` subdirectory
2. Writes `tnl/workflow.tnl` starter file (the six-clause baseline)
3. Writes `.tnl-config.yaml` with sensible defaults (semantic off, soft-gated)
4. Detects the active agent(s) in the repo (presence of `.claude/`, `AGENTS.md`, `GEMINI.md`, or `--agent <name>` flag) and injects the appropriate TNL stanza into each instruction file
5. Registers the TNL MCP server in the detected agents' configs
6. Installs the Claude Code `/tnl-feature` skill (if Claude Code detected)
7. Installs a pre-commit hook that runs `tnl resolve` on staged `.tnl` changes
8. Writes a `.github/workflows/tnl-verify.yaml` GitHub Action running `tnl verify --advisory` (report-only on first install)
9. Prints next steps: "Touch a feature; your agent will propose the first TNL"

### 8.2 What it does NOT do

- Does not scan the codebase and auto-generate TNL files. Adoption is hot-path, not big-bang.
- Does not hard-gate on day one.
- Does not require a config file beyond defaults.

Optional flag `--bootstrap-from-code` triggers the auto-generation path for teams that explicitly want it; off by default.

### 8.3 Agent detection logic

```
if .claude/ exists               → configure Claude Code (full tier)
if AGENTS.md exists              → configure Codex (basic tier)
if GEMINI.md exists              → configure Gemini CLI (basic tier)
if --agent <name> passed         → configure only that agent
if --all-detected (default)      → configure every detected agent
```

Users with multiple agents in the same repo (not uncommon) get all applicable stanzas and MCP registrations.

---

## 9. Adoption Model

### 9.1 Greenfield

`npx create-tnl` (or `tnl init` if the CLI is already installed). First feature prompt → agent proposes first TNL → user approves → code generated. TNL grows one surface at a time.

### 9.2 Existing repo (hot path)

Same command. Agents touch existing features over time; TNL is proposed for each surface as it's first touched. Uncovered surfaces use today's baseline retrieval (grep/read). Coverage grows where activity is — which is where the value is highest.

### 9.3 Existing repo (bulk, optional)

`npx create-tnl --bootstrap-from-code` (or `tnl init --bootstrap-from-code`) runs an agent pass over the codebase and emits starter TNL for the top N behavioral surfaces (by file churn or test coverage). A human reviews and merges. This path has real risks — auto-generated TNL can drift like auto-generated docs — so it's explicitly off by default.

### 9.4 Gating progression

Suggested gating progression for an adopting team (not our build timeline — this is guidance we'd publish for teams rolling out TNL in their own repo):

- **Initial install:** soft-gated (report-only). No PR is blocked. Teams learn the flow without CI pain.
- **After a handful of features:** hard-gate on `hard` clauses. Test-backed still advisory until the team's test-writing discipline stabilizes.
- **Steady state:** hard-gate on `hard` + `test-backed`. Semantic remains advisory until the team opts into tier 3 with their own calibration set.

This progression is project policy, not tool enforcement. The tool just reads `.tnl-config.yaml`.

---

## 10. Evaluation Harness

The eval is the most important artifact of this project. It runs as Path B (phases B1–B2) after the A7 go/no-go checkpoint clears — the formal evidence that justifies public release.

### 10.1 Test bed

- One medium OSS repo, 20–50K LOC, realistic domain (not a toy)
- ~10 hand-written TNL files covering existing behavioral surfaces (authored before tasks are selected)
- Pre-registered task list of 20–25 realistic tasks, published *before* any runs

### 10.2 Conditions

Each task run in:
- **Baseline:** vanilla Claude Code, no TNL
- **+TNL:** Claude Code with TNL files, MCP server, CLAUDE.md stanza, skill, hooks

Repeated across 2–3 models (Claude Sonnet, Claude Haiku, GPT-5) to validate model-agnostic claim.

### 10.3 Metrics

Ranked by importance:

1. **Turns to completion** — tests "fewer skipped plan steps / less flailing"
2. **Human-judged correctness** — blind, multi-reviewer, with one external reviewer
3. **Scope creep** — diff LOC vs. minimal-necessary diff
4. **Invariant regression** — do pre-existing tests still pass
5. **Token cost** — tests "token-cheap knowledge base" claim
6. **Cross-model delta consistency** — does TNL help each model roughly equally

### 10.4 Anti-bias measures

- Task list pre-registered. No cherry-picking after results.
- TNL files written by a different person than the task-list author, if possible.
- Tasks include surfaces with *no* TNL coverage, so baseline isn't disadvantaged across the board.
- Human judgment rubric published before runs. External reviewer spot-checks ≥20% of judgments.
- Losses published alongside wins.

### 10.5 Kill criteria

If the eval shows:
- < 20% improvement in human-judged correctness, OR
- Improvements concentrated in one model only, OR
- Token cost increases that outweigh correctness gains,

…we stop and rethink, rather than building v1 on a weak foundation.

---

## 11. Observability

Two mechanisms, both cheap.

### 11.1 `tnl trace`

Records per-session: which TNL units were retrieved, which clauses were cited in generation, which clauses were flagged by the agent's self-attestation. Output lands in the PR description automatically (via git hook) and is also queryable via CLI.

### 11.2 Verifier telemetry

Per verify run: counts of pass/fail per clause class, time spent, flake rate on semantic clauses. Stored locally; optional opt-in aggregation for teams that want a dashboard.

This telemetry answers the "is TNL actually being used?" question that CLAUDE.md-only integrations can't answer.

---

## 12. What's Explicitly In / Out of v1

### 12.1 In v1

- **File format** — machine + contract + human zones, RFC 2119 + `[semantic]` classification.
- **`tnl` CLI** — `init`, `resolve`, `diff`, `impacted`, `verify` (tiers 1+2), `trace`, `test-plan`. Distributed on npm as `@tnl/cli`.
- **`create-tnl`** — thin npm-scaffolder wrapper package (so `npx create-tnl` works as the first-time entry point alongside `tnl init`).
- **MCP server** — full tool surface (`get_impacted_tnls`, `retrieve_tnl`, `propose_tnl_diff`, `approve_tnl_diff`, `verify`, `trace`). Distributed as `@tnl/mcp-server`.
- **Claude Code integration** (first-class tier): CLAUDE.md stanza, `/tnl-feature` skill, `PreToolUse` hook, CI action.
- **Codex integration** (basic tier): AGENTS.md stanza + MCP registration + CI action. No hooks (not available in Codex yet).
- **Gemini CLI integration** (basic tier): GEMINI.md stanza + MCP registration + CI action. No hooks.
- **Verifier** (tier 1 structural + tier 2 test-binding integrity) — language-agnostic, does not parse target code, does not execute tests.
- **Generation-time guardrail** — TNL clauses injected into the agent's context during code generation, for all clause classes.
- **Agent self-attestation** on every MUST clause at end of task (structural, test-backed, and semantic).
- **Configurable gating** via `.tnl-config.yaml`.
- **Evaluation harness** on one medium repo, one published task set (Path B, after A7 go).
- **Dogfood evidence** — the TNL tool's own development produces `.tnl` files for every phase A feature, as runtime evidence that the flow works.

### 12.2 Out of v1 (deferred, not forgotten)

- **Standalone semantic CI verifier (tier 3)** — ternary verdicts, citation post-check, ensemble, calibration sets, graduation rules. Deferred to post-v1.
- **Auto-bootstrap of existing repos** — `--bootstrap-from-code` flag exists on `tnl init` but is opt-in and not guaranteed to produce high-quality TNL. Not the default path.
- **Cursor native integration** — deferred to post-v1. Cursor users can still use TNL via the universal MCP tier; there's just no `tnl init --agent cursor` branch.
- **Aider / Continue.dev / Windsurf native integrations** — same, deferred.
- **Claude Code plugin packaging** — planned for Path B (phase B4). v1 ships the hook, skill, and MCP config separately.
- **Cross-team clause marketplace / sharing** — not in scope.
- **Fancy clause classification** beyond RFC 2119 keywords + `[semantic]` escape — deferred.
- **Dashboard for verifier telemetry aggregation** — individual-project `tnl trace` is in; team-level aggregation is out.
- **AST parsing of target code** — ruled out entirely. The verifier is language-agnostic and does not parse TypeScript, Python, Go, Rust, or any other target language. See §5. If AST-level checks become necessary for a specific clause, the clause should either name a `[test: ...]` that covers it or be marked `[semantic]` for tier-3 LLM discrimination (deferred).
- **Test execution** — ruled out. The user's existing test runner (npm test / pytest / go test / cargo test / whatever) runs via their CI as before. The TNL verifier only checks that the tests a clause names still *exist* by literal-string search, not that they pass.

---

## 13. Open Questions Still to Resolve

These are real design questions that will surface during implementation. Flagging now so they aren't rediscovered as blockers:

1. **TNL unit granularity heuristics.** What's the ontology guidance for when to split a feature across multiple TNL units vs. bundle? Probably a doc page, maybe a `tnl split` lint. Open.
2. **Multi-feature approval UX.** Agreed the batched-plan-style review works. But we need to prototype the actual review interface early — is it a single diff in the terminal? A dedicated review view? Depends on CLI.
3. **Sync cadence under refactoring.** Impact analyzer flags when edited code touches TNL paths; agent confirms "unchanged" or proposes a diff. The heuristics for distinguishing cosmetic vs. behavioral change need iteration against real PRs.
4. **Classification inference quality.** RFC 2119 + `[semantic]` escape is minimal. If inference misses non-trivially, we push developers back toward explicit metadata. Measure during the Path B evaluation.
5. **Agent compliance observability.** `tnl trace` answers "was TNL used," but the richer question is "did citing this clause prevent a bug." That's harder; probably a Phase 2+ analysis rather than a v1 tool.
6. **Semantic verifier graduation criteria.** When tier 3 ships, what are the exact precision/recall thresholds? Will need real data; not pre-registerable.

---

## 14. Non-Goals

- Not a DSL. Developers never write anything other than English.
- Not a spec-driven workflow replacement for Kiro / Spec Kit. Those require upfront spec writing. TNL is generated mid-flow by the agent.
- Not a replacement for tests. Test-backed clauses *require* tests and assume a working test suite.
- Not model-specific. The format and verifier work with any English-capable LLM.
- Not a plan-mode replacement at the UI level. A CLI can render a TNL diff as a "plan summary" if that's the user's preferred mental model. The TNL is still the source of truth.

---

## 15. Build Order — phase reference

Detailed phase scope, dependencies, and gating criteria live in [`phase-plan.md`](./phase-plan.md). Summary here for completeness:

**Path A (PoC → go/no-go):**
- **A0** — Dogfood setup (complete)
- **A1** — Foundations: file format spec, CLI skeleton, `tnl init`, parser
- **A2** — `tnl resolve` (sidecar generation) and `tnl impacted`
- **A3** — MCP server, read side (`get_impacted_tnls`, `retrieve_tnl`, `trace`)
- **A4** — MCP server, authorship side (`propose_tnl_diff`, `approve_tnl_diff`, `tnl diff`)
- **A5** — Verifier tiers 1 + 2 (`tnl verify`)
- **A6** — Claude Code first-class integration (skill, `PreToolUse` hook)
- **A7** — Dogfood review + go/no-go checkpoint

**Path B (post-go):**
- **B1** — Formal evaluation on a second repo
- **B2** — Cross-model validation
- **B3** — Codex + Gemini basic adapters
- **B4** — Claude Code plugin packaging
- **B5** — Release preparation

Phases are gated by completion of the prior, not by calendar. No time estimates — overruns are a signal to re-scope, not to rush.

---

## 16. Operational Model

Two kinds of sessions, each with a clear job.

**Planning sessions** (like the ones that produced this doc):
- Discuss phase scope, workflow clause evolution, design decisions, tradeoffs.
- Update documents in `internal_docs/`.
- No TNL proposals. No code.

**Implementation sessions** (one per phase, fresh Claude Code session):
- Session reads `CLAUDE.md` → `tnl/workflow.tnl` → `internal_docs/phase-plan.md` at start.
- User prompts with phase goal (e.g., *"Build phase A1. Start with the file format spec."*).
- Agent proposes a TNL for the first feature, user reviews/approves, agent implements against the approved TNL, self-attests at end.
- Repeat for each feature in the phase.
- Phase done when all features are in and self-attested.

Between sessions: short summary update to `phase-plan.md`, update `workflow.tnl` if the phase surfaced a workflow issue, then next phase.
