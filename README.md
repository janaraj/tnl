# TNL — Typed Natural Language

Structured English contracts for agent-written code. Describe features as reviewable specs, then have your coding agent implement against them.

```bash
npx -y @typed-nl/cli init
```

---

## What is TNL?

TNL (Typed Natural Language) is a **contract format** for features in agent-written codebases. A TNL file is a short, structured English document that describes one behavioral surface — a CLI command, an MCP tool, a route handler, a workflow — with machine-readable metadata and human-readable clauses.

A TNL file has three zones:

- **Machine zone** — `id`, `scope`, `paths`, `surfaces`, `dependencies`. Metadata the tool reads.
- **Contract zone** — `behaviors` with RFC 2119 keywords (MUST / SHOULD / MAY) and the `[semantic]` / `[test: file::name]` clause prefixes.
- **Human zone** — `intent`, `non-goals`, `rationale`. The "why" for future readers.

A minimal example:

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
  - [test: tests/rate_limit.test.ts::returns_429_on_exceeded] The 429 response MUST include a `Retry-After` header with the seconds until window reset.
  - [semantic] The middleware SHOULD log the user ID and request path on every 429, without leaking the request body.

non-goals:
  - Per-IP rate limiting — authenticated surface only.
  - Distributed rate state — in-memory per instance for now.
```

## Why TNL?

Coding agents work best when they have a concrete target. Freeform prompts produce freeform results: different sessions interpret the same request differently, forget constraints, silently expand scope. CLAUDE.md-style guidance helps but can be skipped under session pressure.

TNL shifts the contract from "transient prompt" to "durable file":

- **Reviewable.** The TNL is proposed before any code. You review it, push back, approve. Then code.
- **Verifiable.** `tnl verify` checks structural invariants: paths exist, dependencies resolve, declared tests still exist in the named files.
- **Discoverable.** The MCP server exposes TNL retrieval, proposal, and verification as tools your agent reaches for naturally.
- **Dogfooded.** This repository's own 23 features are each governed by a TNL in [`tnl/`](./tnl).

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

## The TNL workflow

Every feature request — new or modification — runs through the same cycle:

| Step | What happens | Output |
|---|---|---|
| 1. Scope | Find existing TNLs with overlapping `paths:` or `surfaces:` | Edit-or-new decision |
| 2. Clarify | Agent asks structured questions if interpretation is ambiguous | Shared understanding |
| 3. Propose | Agent drafts a TNL inline in chat | Reviewable spec |
| 4. Approve | You review, revise, approve | Contract |
| 5. Save | TNL is written to `tnl/<slug>.tnl` | Durable artifact |
| 6. Implement | Agent writes code + tests against the TNL | Code |
| 7. Self-attest | Agent lists each MUST clause → where it was satisfied | Receipts |

Property changes to existing features are **edits** to their TNL, not new files. Genuinely new behavioral surfaces warrant a new TNL.

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
