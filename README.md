# TNL — Typed Natural Language

Structured English contracts for coding agents. A short file per feature, reviewed before code lands, kept as durable context for every future session.

```bash
npx -y @typed-nl/cli init
```

---

## The two ideas this builds on

Andrej Karpathy wrote two things worth stealing:

- [**"Agents make wrong assumptions silently"**](https://x.com/karpathy/status/2015883857489522876) — coding agents don't manage confusion, don't seek clarification, don't surface tradeoffs. Good prompting norms help, but they're vibes, not gates.
- [**"The LLM is the programmer, the wiki is the codebase"**](https://x.com/karpathy/status/2039805659525644595) — structured Markdown the model can reason over directly beats fuzzy RAG for mid-sized bodies of knowledge.

TNL combines the two: **a short per-feature contract, reviewed before any code lands, that sticks around as the feature's durable knowledge base for every future session.**

## What TNL adds on top

- **Mechanical enforcement.** The agent outputs a typed contract; you approve; it maps every MUST clause to code or tests. Not a norm — a gate.
- **Scope fence.** `paths:` declares which files are in play. Anything outside is flagged.
- **Machine checks.** `tnl verify` confirms paths exist, tests still resolve, clauses haven't drifted.
- **Cross-session persistence.** The approved contract stays as `tnl/<slug>.tnl`. Future sessions inherit the intent instead of re-reading the code.

## Think of it as plan mode, made durable

If you've used **plan mode** in Claude Code, you know the shape: the agent proposes a plan, you review, you approve, then code lands. Plan mode works — but the plan is prose in chat, different every session, and gone when the session ends.

TNL is that discipline tightened: a structured schema instead of freeform prose, saved to disk instead of lost to the session, and machine-verifiable where plan mode is trust-based.

---

## The workflow

Every feature request — new or modification — runs through 7 steps:

1. **Scope** — agent scans `tnl/` for files whose `paths:` overlap the request. If one exists, the output is an *edit*; if not, a *new* TNL.
2. **Clarify** — ambiguous request? Agent asks questions before proposing anything.
3. **Propose** — agent outputs the full TNL content inline in chat. Nothing on disk yet.
4. **Wait for approval** — you review, push back, approve. Nothing is written until you say go.
5. **Save** — agent writes the approved TNL to `tnl/<slug>.tnl`.
6. **Implement** — agent writes code + tests against the contract. `paths:` is the scope fence.
7. **Self-attest** — agent lists every MUST clause and where it was satisfied. Silent omission counts as a miss.

For follow-up work, step 1 returns "edit the existing TNL" — and the next session reads the already-approved contract as context, rather than rediscovering design decisions from the code.

---

## A TNL file looks like this

```
id: user-rate-limiter
title: Per-user API rate limiter
scope: feature
owners: [@jana]
paths: [src/middleware/rate-limit.ts]
surfaces: [POST /api/*]

intent:
  Cap requests per user at 60/min; exceeding users get 429 with
  Retry-After. Prevents abuse on the public write endpoints.

behaviors:
  - The middleware MUST track request counts per user in a sliding window of 60 seconds.
  - When a user exceeds 60 requests in the window, the middleware MUST return HTTP 429.
  - [test: tests/rate_limit.test.ts::returns_429_on_exceeded] The 429 response MUST include a `Retry-After` header.
  - [semantic] The middleware SHOULD log the user ID and request path on every 429, without leaking the request body.

non-goals:
  - Per-IP rate limiting — authenticated surface only.
  - Distributed rate state — in-memory per instance for now.
```

Three zones: **machine** (`id`, `paths`, `surfaces`), **contract** (`behaviors` with RFC 2119 keywords and `[semantic]` / `[test: …]` prefixes), **human** (`intent`, `non-goals`, `rationale`).

---

## Does it actually work?

We ran a controlled A/B. The baseline condition uses four working principles — think before coding, simplicity first, surgical edits, goal-driven — written as prose in the project's CLAUDE.md / AGENTS.md. Same agent, same project context, same principles; only the contract step is missing. 3 tasks, 2 agents, 3 codebases.

Headline task: add event-driven triggers to a 16KLOC Python codebase (35 behavioural scenarios covering config, cycle prevention, cron coexistence, CLI surfaces).

| Agent | TNL passing | Baseline passing | Gap |
|---|---:|---:|---:|
| Claude Code Opus 4.7 (n=2) | **35/35, 31/35** (89–100 %) | 29/35, 27/35 (77–83 %) | +5 to +8 |
| Codex GPT-5.4 high (n=1) | **32/35** (91 %) | 26/35 (74 %) | +6 |

Across all 3 tasks (TypeScript + Python, Claude + Codex), **TNL never lost on functional completeness**. No cell overlap between TNL's band (86–100 %) and baseline's (57–83 %).

Other signals:
- **Consistency is tighter under TNL.** MUST-clause count on the same task lands 15/16/17 across three independent runs. Baseline's scope-creep file count ranges 2–4.
- **Cost is within noise of baseline.** Across 5 paired runs: TNL cheaper in 2, baseline cheaper in 3. No consistent "TNL tax."
- **Follow-up work reused the contract.** Both TNL agents edited the existing TNL file for a round-2 task; no new file was created. The baseline agent had to re-read code.

**Caveats up front.** n is 1–2 per cell, LLM sessions are noisy, and we built the tool. Every script, prompt, raw JSON, and session transcript is committed so you can rerun anything.

**[Full eval report →](evals/full-eval.md)**

---

## Built with TNL

We built this tool using its own workflow — the minimal form (CLAUDE.md stanza + `tnl/`, no hooks or MCP). The baseline rules live in [`tnl/workflow.tnl`](./tnl/workflow.tnl), and every feature has its own TNL in [`tnl/`](./tnl/) (23 and counting). In practice: faster turnaround, few rework cycles, each next change edits the spec instead of re-analysing code. One project's worth of evidence, but the meta-test isn't nothing.

---

## Install

```bash
# One-off, no install
npx -y @typed-nl/cli <command>

# Or install globally
npm install -g @typed-nl/cli
tnl <command>
```

Requires Node 20 or later.

## Quickstart

### 1. Start minimal

Begin with just the baseline TNL scaffold — no MCP, no hooks, no CI. The agent follows the workflow from the appended CLAUDE.md stanza alone.

```bash
cd /path/to/your/repo
npx -y @typed-nl/cli init --agent claude --minimal
```

This writes only:

- `tnl/` — where your TNL contracts will live
- `tnl/workflow.tnl` — baseline session principles
- `CLAUDE.md` — TNL workflow stanza appended (or file created if missing)

For Codex: `--agent codex` (writes `AGENTS.md`). For Gemini: `--agent gemini` (writes `GEMINI.md`).

### 2. Author your first TNL

Start a Claude Code (or Codex / Gemini) session and ask for any feature. The agent, guided by the CLAUDE.md stanza, will:

1. **Scope** the request — check for existing TNLs that cover it.
2. **Clarify** ambiguous requirements by asking questions.
3. **Propose** a TNL inline in chat as a fenced code block.
4. **Wait** for your approval — nothing is written to disk yet.
5. **Save** the approved TNL to `tnl/<slug>.tnl`.
6. **Implement** against the approved TNL (modifying only files listed in `paths:`).
7. **Self-attest** — list each MUST clause and where it was satisfied.

### 3. Verify

```bash
npx -y @typed-nl/cli verify
```

Runs **tier 1** (paths and dependencies exist) and **tier 2** (test-binding integrity — each `[test:]` annotation names a test that still exists). Exits 2 on any failure; CI uses this gate.

### 4. Add capabilities as you need them

You can always re-run `tnl init` to layer on more. Each step is independent and safe to re-run (idempotent):

```bash
# Full install: MCP server + PreToolUse hook + CI workflow
npx -y @typed-nl/cli init --agent claude

# Everything except CI
npx -y @typed-nl/cli init --agent claude --no-ci

# Everything except the PreToolUse hook
npx -y @typed-nl/cli init --agent claude --no-hook

# Claude only: add the /tnl-feature slash command
npx -y @typed-nl/cli init --agent claude --with-skill
```

What each capability gives you:

| Capability | Added by default (omit `--minimal`) | What it does |
|---|---|---|
| MCP server | yes | Registers `tnl` in `.mcp.json` / `.codex/config.toml` / `.gemini/settings.json`. Agent gains 6 tools: retrieve, propose, approve, verify, impacted, trace. |
| PreToolUse hook | yes (Claude) | `.claude/settings.json` hook auto-injects impacted TNLs as context on every `Edit` / `Write`. |
| CI workflow | yes | `.github/workflows/tnl-verify.yml` runs `tnl verify` on push + PR. |
| `/tnl-feature` skill | no (opt-in via `--with-skill`) | Claude Code slash command for explicit invocation. |

---

## Commands

```bash
tnl init [flags]          # scaffold TNL in a project
tnl verify [paths...]     # check structural + test-binding integrity
tnl resolve [id...]       # regenerate sidecar meta (hashes, classification)
tnl impacted <paths...>   # list TNLs whose paths: overlap with given code paths
tnl diff <file>           # show clause-level diff of a TNL vs HEAD
tnl test-plan <id>        # list test-backed clauses for a unit
```

### `tnl init` flags

| Flag | Default | Behavior |
|---|---|---|
| `--agent claude\|codex\|gemini` | auto-detect | Target one agent; overrides detection |
| `--minimal` | off | Scaffold only `tnl/` + instruction-file stanza; skip everything below |
| `--no-ci` | off | Skip `.github/workflows/tnl-verify.yml` |
| `--no-mcp` | off | Skip MCP server registration |
| `--no-hook` | off | Skip Claude PreToolUse hook |
| `--with-skill` | off | (Claude only) Install `/tnl-feature` slash command |
| `--local-install` | off | (Dev-only) Rewrite configs to absolute local `node dist/...` paths |

Without `--agent`, init auto-detects targets (`.claude/` → Claude; `AGENTS.md` → Codex; `GEMINI.md` → Gemini). Re-running `tnl init` is safe — existing files are detected and upgraded when the bundled template evolves.

---

## MCP integration

`tnl init` auto-registers the TNL MCP server with supported agents. Once registered, the agent gains six tools:

| Tool | Purpose |
|---|---|
| `get_impacted_tnls` | Return TNLs whose `paths:` overlap with given code paths |
| `retrieve_tnl` | Return the verbatim contents of one or more TNLs by id |
| `propose_tnl_diff` | Validate and stage a batch of create/update diffs |
| `approve_tnl_diff` | Commit a staged diff to disk, regenerate sidecars |
| `verify` | Run the verifier over given paths, return structured JSON |
| `trace` | Record / retrieve session-scoped agent-initiated events |

Running MCP manually:

```bash
npx -y -p @typed-nl/cli tnl-mcp-server   # stdio JSON-RPC server
```

---

## TNL file format

Machine zone fields (see [`tnl/workflow.tnl`](./tnl/workflow.tnl) for a working example):

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Kebab-case slug matching the filename |
| `title` | yes | Short human label |
| `scope` | yes | `repo-wide` or `feature` |
| `owners` | yes | List of `@handles` |
| `paths` | scope=feature only | Files this TNL governs |
| `surfaces` | optional | Named external surfaces (CLI commands, routes, tools) |
| `dependencies` | optional | Other TNL ids this couples with |
| `intent` | yes | One-paragraph plain English |
| `behaviors` | yes | Numbered clauses using MUST / SHOULD / MAY |
| `non-goals` | yes | Explicit scope fences |
| `rationale` | optional | Tradeoffs, gotchas, why-behind-choices |

RFC 2119 keywords:

- **MUST / MUST NOT** — hard requirement
- **SHOULD / SHOULD NOT** — strong preference
- **MAY** — permission

Clause prefixes:

- `[semantic]` — judgment needed to verify (not structural)
- `[test: <file>::<name>]` — binds the clause to a named test; `tnl verify` checks the test still exists

---

## Development

```bash
git clone https://github.com/janaraj/tnl.git
cd tnl
npm install
npm run build
npm test           # parser, resolver, verifier, CLI, MCP suites
npm run typecheck
```

Every new feature follows the TNL workflow this tool enforces. See [CLAUDE.md](./CLAUDE.md) for session guidance and [`tnl/`](./tnl/) for the contracts governing this repository's own development.

---

## License

MIT. See [LICENSE](./LICENSE).
