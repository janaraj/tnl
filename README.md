# TNL — Typed Natural Language

AI coding agents make design decisions silently, drift from what was planned, and lose context at session end. TNL (Typed Natural Language) is the fix: a per-feature English contract with a fixed schema — proposed by the agent, approved by you, implemented against, saved on disk, and read by every future session. If you've used plan mode in Claude Code, this is the same discipline made compact, persistent, and machine-checkable.

## The schema

The schema is seven fields:

- `id` / `title` — what this feature is
- `scope` — `feature` or `repo-wide`
- `paths` — which files the change is allowed to touch
- `surfaces` — named external surfaces (CLI commands, routes, MCP tools)
- `behaviors` — numbered MUST / SHOULD / MAY clauses; the contract proper
- `non-goals` — what's explicitly out of scope
- `rationale` — the why, for future readers

You approve this *once*, before any code runs. The agent implements against each MUST clause and self-attests at the end — for every MUST, naming the file or test that satisfies it.

**No new tool, no new agent, no new workflow.** TNL slots into whatever agent you already use. Claude Code, Codex, Gemini get first-class `tnl init` with stanza + hooks + MCP. Any agent that reads a Markdown instruction file adopts with a two-step manual copy — the minimum product is a stanza in your instruction file plus a `tnl/` directory. `tnl verify`, the PreToolUse hook that re-surfaces the contract mid-edit, and the MCP server are optional layers on top.

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

## The workflow

Every feature request — new or modification — runs through 7 steps:

1. **Scope** — agent scans `tnl/` for files whose `paths:` overlap the request. If one exists, the output is an *edit*; if not, a *new* TNL.
2. **Clarify** — ambiguous request? Agent asks questions before proposing anything.
3. **Propose** — agent outputs the full TNL content inline in chat. Nothing on disk yet.
4. **Wait for approval** — you review, push back, approve. Nothing is written until you say go.
5. **Save** — agent writes the approved TNL to `tnl/<slug>.tnl`.
6. **Implement** — agent writes code + tests against the contract. `paths:` bounds the change.
7. **Self-attest** — agent lists every MUST clause and where it was satisfied. Silent omission counts as a miss.

For follow-up work, step 1 returns "edit the existing TNL" — and the next session reads the already-approved contract as context, rather than rediscovering design decisions from the code.

---

## What you get over plan mode

- **Structure.** Seven fixed fields. Reviewers scan the same things every time. Agents produce the same shape every session.
- **Persistence.** Plan mode's output is a chat message — gone when the session ends. A TNL is a file on disk alongside your code. The next session reads the contract instead of re-analysing source.
- **Enforcement.** Every MUST clause maps to a file or test at self-attestation time. `tnl verify` checks paths exist and test bindings resolve. The PreToolUse hook re-injects the contract on every Edit/Write so the agent can't drift silently.
- **Incremental adoption.** No bulk migration. Your next feature gets a TNL; the rest of the repo stays as-is. The knowledge base accumulates as the work accumulates.

---

## Does it actually work?

We ran a controlled A/B. Baseline condition: four working principles — think before coding, simplicity first, surgical edits, goal-driven — written as prose in the project's CLAUDE.md / AGENTS.md. TNL condition: the same four plus two more (match existing conventions; exhaustive end-of-task self-attestation) encoded as [`tnl/workflow.tnl`](./tnl/workflow.tnl), plus a per-feature TNL. Same agent, same project context; only the contract step differs.

Headline task: add event-driven triggers to a 16KLOC Python codebase. 35 behavioural scenarios covering config, cycle prevention, cron coexistence, CLI surfaces.

| Agent | Run | TNL | Baseline | Gap |
|---|:---:|:---:|:---:|:---:|
| Claude Code Opus 4.7 | 1 | 35/35 | 29/35 | +6 |
| Claude Code Opus 4.7 | 2 | 31/35 | 27/35 | +4 |
| Claude Code Opus 4.7 | 3 | 30/35 | 25/35 | +5 |
| Codex GPT-5.4 high | 1 | 32/35 | 26/35 | +6 |
| Codex GPT-5.4 high | 2 | 31/35 | 26/35 | +5 |

**TNL was ahead of baseline in every paired cell across both models.** Gap ranges +4 to +6 scenarios.

Other signals:

- **Contracts retained.** TNL runs encoded 15–38 explicit MUST clauses in the per-feature TNL before any code was written. Baseline produced 0 by construction — there's no contract step. On the cross-session retention question (*"did the next session re-use the contract or re-read code?"*), the TNL agent opened and edited the existing TNL on every follow-up task we measured; baseline re-read source.
- **Follow-up work reused the contract.** On round-2 tasks in the same worktrees, TNL agents edited the existing TNL file rather than creating a new one (4/4 samples). The baseline agent had to re-read the code each time.

**Caveats up front.** Small sample (2–3 per cell), LLM sessions are noisy, and we built the tool. Every script, prompt, raw JSON, and session transcript is committed so you can rerun anything.

**[Full eval report →](evals/full-eval.md)**

---

## Built with TNL

We built this tool using its own workflow — the minimal form (CLAUDE.md stanza + `tnl/`, no hooks or MCP). The baseline rules live in [`tnl/workflow.tnl`](./tnl/workflow.tnl) and every feature has its own TNL in [`tnl/`](./tnl/). In practice: faster turnaround, few rework cycles, each next change edits the spec instead of re-analysing code. One project's worth of evidence, but the meta-test isn't nothing.

---

## What TNL builds on

Two of Andrej Karpathy's observations framed the problem we're solving:

- [**"Agents make wrong assumptions silently"**](https://x.com/karpathy/status/2015883857489522876) — coding agents don't manage confusion, don't seek clarification, don't surface tradeoffs. Prompting norms help but they're vibes, not gates.
- [**"The LLM is the programmer, the wiki is the codebase"**](https://x.com/karpathy/status/2039805659525644595) — structured Markdown the model can reason over directly beats fuzzy RAG for mid-sized bodies of knowledge.

TNL is our answer: a concrete contract format with a fixed schema, a review workflow, and enforcement plumbing that turns both observations into a daily practice.

---

## Install

```bash
# One-off, no install
npx -y typed-nl <command>

# Or install globally
npm install -g typed-nl
tnl <command>
```

Requires Node 20 or later.

### Other agents (manual install)

If your agent reads a markdown instruction file but isn't in `tnl init`'s native list, the minimum adoption is two copies:

1. Copy [`tnl/workflow.tnl`](./tnl/workflow.tnl) from this repo into `tnl/workflow.tnl` in your project.
2. Paste the TNL workflow stanza (the block under `<!-- tnl:workflow-stanza -->` that `tnl init --agent claude` would emit into `CLAUDE.md`) into your agent's instruction file.

That's it — the workflow fires from the stanza, contracts live in `tnl/`. The hook, MCP server, and CI action are all optional and agent-specific; they can be added later if your stack supports them.

## Quickstart

### 1. Start minimal

Begin with just the baseline TNL scaffold — no MCP, no hooks, no CI. The agent follows the workflow from the appended CLAUDE.md stanza alone.

```bash
cd /path/to/your/repo
npx -y typed-nl init --agent claude --minimal
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
npx -y typed-nl verify
```

Runs **tier 1** (paths and dependencies exist) and **tier 2** (test-binding integrity — each `[test:]` annotation names a test that still exists). Exits 2 on any failure; CI uses this gate.

### 4. Add capabilities as you need them

You can always re-run `tnl init` to layer on more. Each step is independent and safe to re-run (idempotent):

```bash
# Full install: MCP server + PreToolUse hook + CI workflow
npx -y typed-nl init --agent claude

# Everything except CI
npx -y typed-nl init --agent claude --no-ci

# Everything except the PreToolUse hook
npx -y typed-nl init --agent claude --no-hook

# Claude only: add the /tnl-feature slash command
npx -y typed-nl init --agent claude --with-skill
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
npx -y -p typed-nl tnl-mcp-server   # stdio JSON-RPC server
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
