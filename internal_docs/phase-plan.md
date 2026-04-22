# TNL — Phase Plan

Phase-by-phase scope for the TNL tool. This is the bridge between [`tnl-implementation-v1.md`](./tnl-implementation-v1.md) (the comprehensive design spec) and the per-session TNL flow that governs day-to-day building.

No time estimates. Phases are gated by completion of the prior, not by calendar.

---

## Current phase

**A0 — completed.** Project scaffold, `tnl/workflow.tnl`, `CLAUDE.md` with TNL task-flow, `src/` and `tests/` bones.

**A1 — completed.** Three feature TNLs landed: [`cli-skeleton`](../tnl/cli-skeleton.tnl) (dispatcher, argv, subcommand registration), [`cli-init`](../tnl/cli-init.tnl) (scaffolds `tnl/` + starter `workflow.tnl` + agent stanzas), [`parser`](../tnl/parser.tnl) (reads `.tnl` → typed AST with clause-classification tags, `TnlParseError` with line numbers). 76 tests passing. Zero runtime deps. File-format spec doc rescoped out of A1 and parked in B5.

A1 dogfood notes:
- The first-pass `cli-skeleton` clause "*later features attach without editing `src/index.ts`*" turned out to be unworkable when `cli-init` needed a single `import` line to trigger registration. The clause was softened mid-phase to forbid only dispatch/argv edits. Takeaway: scope fences in TNLs need to be grounded in how the implementation actually attaches — aspirational wording produces friction.
- The `parser`'s id-vs-filename-match clause caught the repo's own `tnl/workflow.tnl` mismatch (`id: workflow-coding-principles` vs filename `workflow.tnl`), which was renamed to `id: workflow` as part of the parser's landing (the `cli-init.tnl` lockstep clause on the embedded template pulled the change through to `src/commands/init.ts`). First concrete dogfood win — the contract caught real drift in its own repo.

**A2 — completed.** Two feature TNLs landed: [`resolve`](../tnl/resolve.tnl) (`tnl resolve` CLI + resolver module; SHA-256 unit and clause hashing, `hard`/`semantic`/`advisory` classification, sidecar at `tnl/.resolved/<id>.meta.json`) and [`impacted`](../tnl/impacted.tnl) (`tnl impacted <paths...>` CLI + impact module; path-overlap matching with directory-prefix in both directions, repo-wide units always included). 132 tests passing. Still zero runtime deps — only `node:crypto` added from stdlib.

A2 notes:
- Classification fold decision: `MAY` → `advisory` (no separate `permission` class in v1) because enforcement semantics are identical. `test-backed` class explicitly deferred to A5 where evidence discovery happens; A2 classifies all `MUST` clauses as `hard`.
- Sidecar `resolved_at` creates diff noise on every `tnl resolve` run (timestamp updates even when `unit_hash` is unchanged). Follow-up worth considering later: re-read existing sidecar and preserve `resolved_at` when `unit_hash` matches.
- Running `tnl resolve` against this repo produced five sidecars (one per feature TNL) — first real demonstration of the tool operating on its own contracts.

**A3 — completed.** Four feature TNLs landed: [`mcp-skeleton`](../tnl/mcp-skeleton.tnl) (stdio JSON-RPC server via `@modelcontextprotocol/sdk` 1.29, tool registry mirroring the CLI pattern, `tnl-mcp-server` as a second bin), [`mcp-get-impacted-tnls`](../tnl/mcp-get-impacted-tnls.tnl) (wraps A2 impact, returns `{id, title, scope}` JSON, drops filesystem paths from the wire), [`mcp-retrieve-tnl`](../tnl/mcp-retrieve-tnl.tnl) (returns verbatim `.tnl` content with `notFound` for absent ids, path-traversal ids quietly become `notFound`), [`mcp-trace`](../tnl/mcp-trace.tnl) (in-memory per-process event log with explicit agent-initiated recording, server-generated timestamps). 184 tests passing. First runtime dependency crossed: `@modelcontextprotocol/sdk`.

A3 notes:
- First runtime dep crossed at this phase (MCP SDK) — up to A2 the tool was dependency-free. MCP protocol complexity justifies the threshold.
- Two independent bins (`tnl`, `tnl-mcp-server`) instead of `tnl mcp serve` subcommand so the MCP bin's import graph stays free of the full CLI and matches how agent configs reference server paths.
- `trace` implementation chose explicit agent-initiated recording over auto-recording tool calls. The observability signal we want is *citations and attestations* (which only the agent knows), not tool-invocation counts. Auto-recording can layer on later if useful.
- Each MCP tool uses a `createXxxTool({ cwd?: string })` factory pattern + side-effect registration. Production uses `process.cwd()` at boot; tests inject a temp dir. This is the injection shape I'd carry to A4's authorship tools.
- Typecheck stumble: SDK's `ServerResult` is a Zod union whose widest branch requires a `task` field, and our pared-down result types don't match structurally. Resolved by importing `CallToolResult` / `ListToolsResult` SDK types and casting at the `setRequestHandler` boundary. Our module-internal types stay independent.

**A4 — completed.** Three feature TNLs landed: [`propose-tnl-diff`](../tnl/propose-tnl-diff.tnl) (MCP tool that validates and stages a batch of `create`/`update` changes to `tnl/.staging/<diff_id>.json`; introduces the shared `src/staging.ts` store), [`approve-tnl-diff`](../tnl/approve-tnl-diff.tnl) (consumes a staged diff, writes each `tnl/<id>.tnl`, regenerates the sidecar via A2's resolver, removes the staging record on success), [`cli-diff`](../tnl/cli-diff.tnl) (`tnl diff <file>` prints clause-level added / removed / modified plus per-zone summary against `HEAD` via `git show`). 233 tests passing. No new runtime deps.

A4 notes:
- Signature divergence from spec: `propose_tnl_diff(intent, impacted_ids)` became `{ intent, changes[] }` where each change carries `id + action + content`. The spec's `impacted_ids` is subsumed; a server can't stage content it was never given. Documented in the TNL rationale so downstream readers don't hunt for the hidden content parameter.
- Filesystem staging (not in-memory). Propose and approve may straddle MCP session boundaries (server restart, different agent invocation). A `tnl/.staging/<diff_id>.json` record is the durable handoff.
- Approve re-validates each change before writing (a file might have appeared or disappeared since propose). Revalidation failure preserves the staging record so the agent can revise and retry. No rollback on mid-stream write failure — partial state is surfaced honestly rather than by a best-effort undo that multiplies failure modes.
- macOS symlink stumble in `tnl diff`: `git rev-parse --show-toplevel` returns the canonical `/private/var/folders/...` path while `mkdtempSync` returns `/var/folders/...`. `pathRelative` produced `../../../var/...` paths that `git show` then rejected. Fix: `realpathSync` both cwd and the resolved absolute path before computing the repo-relative path. Worth keeping in mind for any future cross-platform path arithmetic.
- 16-hex-char (8-byte) random `diff_id` picked over UUID: same 2^64 entropy, visually quieter for terminal echo.

**A5 — completed.** Cross-TNL edits to [`parser.tnl`](../tnl/parser.tnl) + [`resolve.tnl`](../tnl/resolve.tnl) (recognized `[test: <file>::<name>]` leading-prefix annotation; mutual exclusion with `[semantic]`; renamed class `hard` → `structural`; added `test-backed` class derived from the annotation; sidecar entry gains optional `test: { file, name }` on test-backed entries). Two new TNLs: [`verify`](../tnl/verify.tnl) (`tnl verify` CLI + verifier module; tier-1 `paths-exist` and `dependencies-resolve`; tier-2 literal-string search for the declared test name in the declared file; no test execution; typed `<name> (<class>) FAIL: <reason>` output; exit 0 on all-pass/unchecked, exit 2 on any failure; parse errors routed to stderr), and [`mcp-verify`](../tnl/mcp-verify.tnl) (MCP tool wrapping the verifier library; takes code paths, chains impact → verify, returns structured JSON with `verified[]` / `errors[]` / `summary`; verify failures are data, `isError` reserved for tool-level problems). 281 tests passing. Running the CLI against this repo: 14 units verify, 24 unit-level checks pass, 0 fail, 190 clause-level checks unchecked (no `[test:]` annotations on our own clauses yet).

A5 notes:
- Scope rescope mid-phase: the original phase plan called for AST/tree-sitter checks in TS + Python, route-handler mapping, symbol presence. Trimmed to tier-1 structural checks (paths, dependencies) + tier-2 test-binding integrity (substring search, not execution) — language-agnostic and cheaper to maintain. AST checks deferred to post-A5.
- Test execution explicitly dropped. CI runs tests; verifier checks bindings don't go stale. The cost/benefit of duplicating the test runner was low; the cost/benefit of catching a deleted test referenced by a TNL is high.
- `[semantic]` and `[test: ...]` are mutually exclusive. A clause that genuinely needs both must split into two — surfacing the two verification paths explicitly rather than silently picking one.
- Cross-TNL edit (parser + resolve) was the right shape for the rename + annotation + classification change, rather than three separate edits. All lockstepped in one proposal.
- First concrete dogfood demonstration for the verifier: running `tnl verify` against this repo shows all 14 units pass their tier-1 checks against the current filesystem.
- Unreachable-test clause caught on re-read: "parse error during verify lands in errors array" can't happen under normal ops because `getImpactedTnls` parses every TNL first and fails fast. The errors array is defensive (for race conditions between impact and verify). Adjusted the TNL test list to acknowledge this rather than specify an untestable case.

**A6 — completed.** Two feature TNLs landed: [`claude-slash-command`](../tnl/claude-slash-command.tnl) (installs `.claude/commands/tnl-feature.md` packaging the TNL workflow as a user-invocable slash command; Claude-specific CLAUDE.md stanza references `/tnl-feature`) and [`claude-hook`](../tnl/claude-hook.tnl) (new `tnl hook pre-tool-use` CLI subcommand reads JSON from stdin, looks up feature TNLs impacted by the edit target, emits `hookSpecificOutput.additionalContext` as JSON; `tnl init --agent claude` merges the hook entry into `.claude/settings.json` idempotently, preserving existing fields). 306 tests passing.

A6 notes:
- Repo-wide TNLs (`workflow.tnl`) are **excluded** from per-edit hook injection. The CLAUDE.md stanza already points at them; re-injecting on every Edit/Write would be noise. Only feature TNLs whose `paths:` overlap with the target contribute.
- Hook **never blocks** — silent pass-through on empty stdin, malformed JSON, unsupported tool names, missing file paths, empty impacted list, and filesystem errors. Claude Code surfaces hook stderr as a visible user error; silent no-op is better than blaming TNL for unrelated hiccups.
- Idempotency sentinel: substring match on the raw settings.json text for the full `npx @tnl/cli hook pre-tool-use` command string. The initial proposal used shorter `tnl hook pre-tool-use` as the sentinel but that fails because `@tnl/cli` breaks the substring match. Caught in test; corrected to the full command.
- macOS symlink stumble (third occurrence this project — `tnl diff` hit it, then `tnl resolve` indirectly, now the hook): `/var/folders/...` vs `/private/var/folders/...`. Fixed by canonicalizing both the cwd and the hook-provided file path via `realpathSync`, with a parent-directory fallback for files that don't yet exist (e.g., when Write is about to create a new file). Worth factoring into a shared utility when it appears again.
- Stdin reading stumble: initial `for await (const chunk of process.stdin)` pattern got 0 bytes under `npx tsx` piped input. Switched to event-based `setEncoding` + `on('data')` + `on('end')`. The event-based pattern is the more reliable baseline across Node versions.
- The skill template + hook wiring are both generated by `tnl init --agent claude`. Running init on a fresh repo now produces: `tnl/`, `tnl/workflow.tnl`, `CLAUDE.md`, `.claude/commands/tnl-feature.md`, `.claude/settings.json` — the full Claude Code first-class integration in one command.

**A7 — completed (go decision).** Dogfood review + pre-publish polish pass closed all audit gaps. Reviewed `internal_docs/final-e2e-audit.md` (independent principal-engineer audit): zero HIGH, zero MEDIUM, seven LOW findings, all scoping / cosmetic. Closed all four critical LOWs as TNL-governed feature cycles:

1. **§8.1 — workflow-template drift guard** (edit to [`cli-init.tnl`](../tnl/cli-init.tnl)): added a test that parses `WORKFLOW_TEMPLATE` vs `tnl/workflow.tnl` and asserts behavior-clause-text equality. 5-LOC test; `WORKFLOW_TEMPLATE` now exported.
2. **§8.2 — trace shape strictness** (edit to [`mcp-trace.tnl`](../tnl/mcp-trace.tnl) + code tightening in `src/mcp/tools/trace.ts`): replaced `{ ...eventRec, type, timestamp }` spread with explicit field pick; caller-supplied extras are now dropped. Amended TNL clause to explicitly name the drop. One test case added for the new guarantee.
3. **§7.4 — MCP server auto-registration** (new [`mcp-auto-register.tnl`](../tnl/mcp-auto-register.tnl)): `tnl init --agent claude` now writes/merges `.mcp.json` with the TNL server entry; preserves existing top-level fields and other `mcpServers`; idempotent on `mcpServers.tnl` existence; Codex/Gemini targets get a summary warning with the manual snippet.
4. **§7.3 — CI action generator** (new [`ci-action.tnl`](../tnl/ci-action.tnl)): `tnl init` (any invocation) writes `.github/workflows/tnl-verify.yml` that runs `npx -y @tnl/cli verify` on push + pull_request. Skip-on-exists; no merging. Companion edit to [`cli-init.tnl`](../tnl/cli-init.tnl) dropped the obsolete "CI action — deferred" non-goal.

A7 outcome (initial pass):
- **18 feature TNLs + `workflow.tnl`** = 19 total (from 16 + workflow pre-polish).
- **322 tests passing** (from 306).
- Full `tnl init --agent claude` now scaffolds: `tnl/`, `tnl/workflow.tnl`, `CLAUDE.md` (stanza + `/tnl-feature` pointer), `.claude/commands/tnl-feature.md` (skill), `.claude/settings.json` (PreToolUse hook), `.mcp.json` (MCP server registration), `.github/workflows/tnl-verify.yml` (CI action). Single command, full integration.

**Follow-up polish (user pushback on deferrals) — closed three more items:**

5. **Resolve timestamp stability** (amend [`resolve.tnl`](../tnl/resolve.tnl) + ~15 LOC in `src/commands/resolve.ts`): when a sidecar already exists with the same `unit_hash`, preserve the existing `resolved_at` byte-for-byte. Two sequential `tnl resolve` runs now produce zero-diff sidecars. The A2-era diff noise is gone.
6. **`tnl test-plan` subcommand** (new [`cli-test-plan.tnl`](../tnl/cli-test-plan.tnl), §7.1): emits `L-N <file>::<name>` per `test-backed` clause in a named unit. Zero-match prints explicit "No test-backed clauses in <id>." rather than empty output. Closes the §4.1 v1 CLI gap.
7. **Init-time minimal mode** (cross-TNL amendment to [`cli-init.tnl`](../tnl/cli-init.tnl) + 4 feature-TNL companion edits): new `--minimal`, `--no-ci`, `--no-mcp`, `--no-hook`, `--no-skill` flags let adopters pick what `tnl init` installs. Baseline artifacts (`tnl/`, `workflow.tnl`, CLAUDE.md stanza) are never suppressed — they're "this project uses TNL". Suppressed steps appear under a new `Skipped (opt-out)` summary section, distinct from idempotency skips.

A7 final outcome:
- **19 feature TNLs + `workflow.tnl`** = 20 total.
- **344 tests passing** (from 322).
- `tnl init` now supports minimal / selective installs: `--minimal` for just-TNL; individual `--no-*` flags for fine-grained opt-outs.
- `tnl resolve` idempotent at byte level on unchanged content.
- `tnl test-plan <unit>` lists test bindings for `test-backed` clauses.

**Remaining deferred (post-v1 polish)**:
- §7.2 `create-tnl` wrapper — packaging artifact for B5 publish pipeline. Users invoke `npx -y @tnl/cli init` today.
- §7.5 `.tnl-config.yaml` — land with first concrete configurability need (tier-3 verifier or a user asking for soft-gating). An empty shell config loader adds maintenance surface without value today.
- §7.6 Pre-commit hook installer — deferred with clearer rationale: hook ecosystem is fragmented (Husky, lefthook, simple-git-hooks, bare `.git/hooks`). Auto-installation competes with existing tooling; a printed snippet in docs is more honest than a subcommand that takes a guess.

**Go/no-go decision: GO to Path B.** All audit-called gaps closed; deferred items are genuine post-v1 work with explicit rationale. v1 is publish-ready.

---

## Path A complete. Path B in progress.

**B3 — completed.** Path B scope was re-sequenced: B3 (Codex + Gemini basic adapters) is landing before B1 (formal evaluation) because the adapters strengthen the eval's claim ("TNL helps across agents, not just Claude Code") and directly close the A7 audit's §7.4 LOW-MEDIUM finding. Two feature TNLs landed:

1. [`gemini-mcp-register`](../tnl/gemini-mcp-register.tnl) — writes/merges `.gemini/settings.json` (project-scoped) with `{mcpServers: {tnl: {...}}}`. Same JSON shape as Claude's `.mcp.json`; same idempotency model (key-existence check). Amended the A7 codex/gemini manual-registration warning to fire only for Codex (temporary, removed in the next TNL).
2. [`codex-mcp-register`](../tnl/codex-mcp-register.tnl) — writes/merges `.codex/config.toml` (project-scoped) with a `[mcp_servers.tnl]` block. TOML via substring-match append-or-skip (no TOML parser dep). Emits a one-line summary hint telling the user to add `projects."<cwd>".trust_level = "trusted"` to `~/.codex/config.toml` so Codex loads the project file — user-scoped mutation left to the adopter. Removed the A7 warning entirely (Codex is now automated).

B3 notes:
- **Ground-truth docs, not my guesses.** Before designing, I WebFetch'd the Codex config reference and the Gemini CLI MCP docs to confirm file locations, formats, and trust/consent semantics. The design was revised significantly from my earlier sketch once the docs showed both agents support project-scoped config (I had assumed user-scoped only).
- **Design posture carries over from A7:** project-scoped writes are safe (version-controlled, reviewable); user-scoped writes need adopter consent. All three agents now handled consistently.
- **One runtime dep still.** Resisted the temptation to pull in a TOML parser for Codex — substring-match idempotency is sufficient for "does subtable exist?" + "append if not."
- `tnl init` with all three agents detected now produces a single deterministic multi-file scaffold in one command. Running it and diffing across runs shows zero churn (timestamp-stable sidecars + idempotent merges).

**Running total:** 22 feature TNLs + `workflow.tnl` = 23 total, 364 tests passing, 1 runtime dep.

**Next: B1 — Formal evaluation on a second repo.**

---

## Path A (PoC → go/no-go)

Each phase lists **in scope**, **explicit non-scope**, and **prerequisites**. Features within a phase are added one at a time via the TNL flow.

### A0 — Dogfood setup ✅

**In scope:** [`tnl/workflow.tnl`](../tnl/workflow.tnl), [`CLAUDE.md`](../CLAUDE.md), [`package.json`](../package.json), `tsconfig.json`, `.gitignore`, [`README.md`](../README.md), empty `src/` and `tests/`.

**Non-scope:** any source code, any dependencies installed, any tool logic.

**Prerequisites:** none.

### A1 — Foundations

**In scope:**
- `tnl` CLI skeleton — entry point, subcommand registration, global flags (`--help`, `--version`, `--agent`).
- `tnl init` — creates `/tnl/`, writes starter `workflow.tnl`, writes CLAUDE.md/AGENTS.md/GEMINI.md stanza (based on detection or `--agent` flag).
- Parser — reads a `.tnl` file, returns a typed object with: machine zone fields, clause list with tags (MUST/SHOULD/MAY + `[semantic]`), non-goals list, rationale prose.

**Non-scope:** sidecar generation, verifier, MCP server, impact analysis. Standalone file-format spec doc is deferred to B5 (release prep) so it's written from an actually-working parser rather than from intent. For A1, the format is adequately covered by the `TNL format` section in CLAUDE.md, the canonical example in the one-pager, the parser's own TNL, and the existing `workflow.tnl` as a working example.

**Prerequisites:** A0.

### A2 — Resolve & impact

**In scope:**
- `tnl resolve` — generates the sidecar (`tnl/.resolved/<id>.meta.json`): content-hashed clause IDs, classification from RFC 2119 keywords + `[semantic]` override, structure validation.
- `tnl impacted <paths...>` — returns TNL units whose `paths:` overlap with given code paths. Deterministic only.

**Non-scope:** MCP, verifier execution, semantic classification.

**Prerequisites:** A1.

### A3 — MCP server, read side

**In scope:**
- MCP server skeleton (stdio JSON-RPC via `@modelcontextprotocol/sdk`).
- Tools: `get_impacted_tnls(paths)`, `retrieve_tnl(ids)`, `trace(session_id)`.
- Integration with the parser and resolver from A1/A2.

**Non-scope:** authorship tools (propose/approve), verifier, hooks.

**Prerequisites:** A1, A2.

### A4 — MCP server, authorship side

**In scope:**
- Tools: `propose_tnl_diff(intent, impacted_ids)` — validates shape, stages diff; `approve_tnl_diff(diff_id)` — writes file, triggers `tnl resolve`.
- Diff-staging backing store (filesystem or in-memory).
- CLI command `tnl diff <file>` — show clause-level diff between working tree and HEAD.

**Non-scope:** verifier, hooks, semantic validation.

**Prerequisites:** A3.

### A5 — Verifier (language-agnostic structural + test-binding)

**In scope:**
- `tnl verify` command with **Tier 1 (structural contract checks)**:
  - every `paths:` entry exists on disk
  - every `dependencies:` entry resolves to a real TNL under `tnl/`
- **Tier 2 (test-binding integrity)**:
  - each `test-backed` clause carries an inline `[test: <file>::<name>]` annotation (same leading-prefix shape as `[semantic]`)
  - verifier opens `<file>` and performs a literal-string search for `<name>`
  - passes if found; fails otherwise
  - verifier does **not** execute the test — that's the user's existing test runner / CI
- Parser and resolver updates: recognize `[test: ...]` annotation; classify clauses as `structural` / `test-backed` / `semantic` / `advisory` (rename of A2's `hard` → `structural`); sidecar stores test-binding alongside clause hash + class.
- Typed error output: `L-N failed (<class>): <reason>` — e.g., `L-5 failed (test-backed): declared test 'returns_429_on_exceeded' not found in tests/rate_limit.test.ts`.
- MCP tool `verify(paths)` wraps the CLI.

**Non-scope (explicit):**
- AST parsing of target code in any language.
- Tree-sitter integration.
- Running tests — the user's existing test runner handles that via their CI. We only check that named tests still *exist*.
- Route/handler mapping, symbol resolution, or any framework-specific check.
- Tier-3 semantic verifier (deferred to post-v1).
- Hook enforcement (A6), calibration tooling (post-v1).

**Rationale:** the verifier exists to catch structural drift — deleted tests, stale path declarations, dangling TNL dependencies — not to re-run what CI already runs or to reason about code behavior. Keeping the tool language-agnostic keeps its maintenance surface flat as adopters bring in TypeScript, Python, Go, Rust, or anything else. Clauses that need behavioral verification either (a) name a test, or (b) are marked `[semantic]` for tier-3 LLM discrimination when that ships.

**Prerequisites:** A3, A4.

### A6 — Claude Code first-class integration

**In scope:**
- Generated CLAUDE.md stanza template (for `tnl init --agent claude`).
- `/tnl-feature` skill packaged as a `.claude/commands/*.md` file.
- PreToolUse hook (minimal): on `Edit`/`Write`, check whether target path is in a TNL unit; inject the relevant TNL into context via a system message.

**Non-scope:** Codex / Gemini / Cursor adapters, plugin packaging.

**Prerequisites:** A3.

### A7 — Dogfood review + go/no-go checkpoint

**In scope:**
- Review the `.tnl` files that landed during A1–A6 (there should be several per phase).
- Answer the go/no-go criteria from `tnl-implementation-v1.md`:
  1. `npx @tnl/cli init` works end-to-end
  2. MCP server runs with core tools; verifier tiers 1+2 work for TS+Python
  3. 3+ `.tnl` files exist for TNL-tool features
  4. 2+ concrete cases where a TNL clause caught something at review time that would have landed wrong
- Decision: continue to Path B or stop.

**Non-scope:** any new feature development.

**Prerequisites:** A6.

---

## Path B (post-go extension)

Only begins after A7 go decision.

### B1 — Formal evaluation on a second repo

Pre-registered task set on a medium OSS repo (20–50K LOC). Automated A/B harness (TNL vs. baseline-v2 equivalent). Measurement pipeline: turns, correctness, scope-creep, invariant-preservation. External reviewer on sampled human judgments.

**Non-scope:** cross-model, release materials.

### B2 — Cross-model validation

Run the B1 evaluation on ≥2 additional models (GPT-5, Gemini) to confirm model-agnostic claim.

**Non-scope:** any adapter work.

### B3 — Codex + Gemini basic adapters

`tnl init --agent codex` and `tnl init --agent gemini` produce appropriate AGENTS.md/GEMINI.md stanzas and register the MCP server. MCP + instructions only; no hooks.

**Non-scope:** Claude Code plugin packaging, Cursor/Aider adapters.

### B4 — Claude Code plugin packaging

Bundle the PreToolUse hook, `/tnl-feature` skill, MCP server config, and CLAUDE.md stanza into a single Claude Code plugin unit. Installable as one thing.

**Non-scope:** release materials.

### B5 — Release preparation

File-format spec doc (`docs/tnl-format.md`) — written from the shipped parser so it reflects reality, not intent. Quickstart docs, demo video (with-vs-without comparison), OSS release on GitHub + npm, first external adopters.

**Non-scope:** all further feature work (post-v1).

---

## Session operational model

Planning and implementation sessions are separate:

### Planning sessions (like this one)

- Discuss phase scope, update this doc, adjust the implementation spec, discuss workflow.tnl evolution.
- No TNL proposals happen here — these are design conversations.
- Artifacts: updates to `internal_docs/*.md` and occasionally `tnl/workflow.tnl`.

### Implementation sessions (per phase)

**One new Claude Code session per phase** in `/Users/jana/workspace/cnl/`. The session:

1. **Reads** `CLAUDE.md` + `tnl/workflow.tnl` + this `phase-plan.md` at start.
2. **User prompts** with the phase goal (e.g., "Build phase A1. Start with the file format spec.").
3. **Agent proposes** a TNL file for the first feature in the phase (e.g., `tnl/file-format-spec.tnl`).
4. **User reviews** the TNL diff, approves or revises.
5. **Agent implements** the feature against the approved TNL.
6. **Self-attest** at end — list each MUST clause + where satisfied.
7. **Move to next feature** in the phase (repeat 3–6).
8. **Phase done** when all features in scope are implemented and self-attested.

Each phase typically produces 2–6 feature-level `.tnl` files in `tnl/` plus the corresponding source and tests.

### Between sessions

- After each phase, this planning doc gets a short summary update ("A1 landed with 4 TNLs: X, Y, Z, W. Observations: ...").
- If a phase surfaces a workflow issue, `workflow.tnl` gets updated (caught during A1 → may prompt updates to task flow).
- Go/no-go at A7 happens in a dedicated planning session.

---

## Dependencies graph

```
A0 ✅
 └─ A1
     └─ A2
         ├─ A3
         │   ├─ A4
         │   │   └─ A5
         │   │       └─ A7 (go/no-go)
         │   └─ A6 ─────┘
         └─ (none more)
```

A3 and A6 can potentially run in parallel after A2 (different sessions), but the dogfood-value is higher when they run sequentially because A3's MCP server benefits the remaining phases' sessions.

Sequential is simpler. Start sequential, parallelize if it's obvious later.

---

## What happens if a phase overruns

Phases don't have deadlines here; they have scopes. If a phase's scope expands during implementation, surface the new scope as a planning-session discussion, update this doc, proceed. Overruns are a signal to re-scope, not to rush.

If a phase blocks on an unresolved design question, stop the implementation session, open a planning session, resolve it, update the relevant doc, resume.
