# TNL — Contract Infrastructure for Personal Coding Agents

> Companion to [`tnl-one-pager-v2.md`](./tnl-one-pager-v2.md). That one pitches TNL as a developer-facing contract layer. This one pitches TNL to the authors of coding agents themselves — openclaw, hermes, or any homegrown tool-use loop wrapping an LLM API.

---

## The thesis

Mainstream coding agents (Claude Code, Codex, Gemini CLI, Cursor) already ship their own retrieval primitives, plan modes, hooks, session logs, and instruction-file conventions. TNL *augments* what they have. For personal or DIY coding agents — the ones built by individuals or small teams on top of raw LLM APIs — **TNL isn't an augmentation. It's the contract, verification, and observability layer that would otherwise have to be built from scratch.**

That's a meaningfully stronger proposition for that audience.

---

## What personal agents typically lack

| | Mainstream agents | Personal agents |
|---|:---:|:---:|
| Structured retrieval | built-in | hand-rolled grep |
| Plan / review step | native plan mode | none |
| Hook-based enforcement | yes (Claude Code) | wrap every tool call yourself |
| Observability / trace | session logs + telemetry | stdout logs, nothing structured |
| Instruction-file convention | CLAUDE.md / AGENTS.md / GEMINI.md | none |
| Test-to-spec traceability | nothing native | nothing — and no one will build it for one personal agent |

TNL fills every gap in the second column **at once**, through a single MCP-server integration.

---

## What TNL gives a personal agent, for free

Spawn `tnl-mcp-server` as a subprocess. Your agent now has:

- **`get_impacted_tnls(paths)`** — structured retrieval of relevant contracts for any code path. No glob logic to build.
- **`retrieve_tnl(ids)`** — verbatim content for a set of TNL ids.
- **`propose_tnl_diff(intent, changes[])`** — staged contract proposals with persistent ids, so proposals can span session boundaries.
- **`approve_tnl_diff(diff_id)`** — commit the proposal, regenerate sidecars automatically.
- **`verify(paths)`** — run the language-agnostic verifier; get typed per-clause feedback on structural and test-binding drift.
- **`trace(session_id, event?)`** — free structured observability layer. Record retrievals, citations, self-attestations per session. Read them back for audit or agent self-improvement.

All over standard MCP stdio. Integration is typically ~20 LOC on your end.

---

## What TNL doesn't do

Honest callouts:

- **TNL doesn't write your agent.** You still own the tool-use loop, model routing, prompt shaping.
- **TNL doesn't host your model.** LLM calls, API keys, billing are yours.
- **TNL doesn't wrap your tool surface.** You still need your own `read_file`, `edit_file`, `run_command` implementations.

TNL fills the *spec, contract, verification, observability* slice. Substrate is still yours.

---

## Why this matters strategically (for TNL)

If personal agents adopt TNL's MCP surface as their default contract layer, TNL stops being *"a feature that makes Claude Code better"* and becomes *"the contract standard any coding agent can plug into."*

That's an ecosystem play, not a tool play. The analogs are:

- **Language Server Protocol (LSP)** — not a tool, a contract anyone can implement. Every editor + every language tool interoperates through it.
- **MCP itself** — Anthropic launched it, but it's infrastructure anyone can host or consume.

TNL-as-contract-standard fits that shape: agent-agnostic, model-agnostic, language-agnostic, file-based, MCP-accessible.

---

## Concrete integration path

For a personal agent that already supports MCP:

1. `npx create-tnl` in the target repo (one-time setup; works today once v1 ships).
2. In your agent's MCP config, add: `"tnl": { "command": "npx", "args": ["-y", "@tnl/mcp-server"] }`.
3. Teach your agent (via its system prompt or equivalent) to call `get_impacted_tnls` before editing code in a TNL-enabled repo, and to call `trace` when citing clauses.

That's it. Verification, drift detection, and session observability are now a standard part of your agent's capability surface — same as for Claude Code, same as for Codex, same as for any other MCP-capable agent.

---

## Where this leads

TNL v1 ships with Claude Code as the reference integration. Codex and Gemini CLI land as basic-tier adapters. Personal agents are the asymmetric win — they get the same infrastructure as the mainstream agents through the same MCP surface, without waiting for a per-agent adapter.

If you're building a personal coding agent, TNL is probably the cheapest way to add contract-level rigor to your codebase today: one subprocess, six tools, zero model-specific code.
