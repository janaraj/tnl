# TNL — Typed Natural Language

Structured English contracts for agent-written code. A persistent, reviewable, verifiable artifact between developer intent and generated code.

> This repository is the TNL tool itself: a CLI (`tnl`), an MCP server, and a layered verifier. It is dogfooded — every feature of the tool is described in `tnl/` files before it is implemented.

## What this repository contains

- `src/` — TypeScript source for the TNL CLI, MCP server, and verifier
- `tests/` — Vitest tests
- `tnl/` — the TNL files governing this project's own development (dogfood)
- `internal_docs/` — planning artifacts (one-pager, implementation doc, evaluation reports)
- `behavioral-tests/` — historical behavioral evaluation on prior test beds

## Stack

- Node 20+, TypeScript (strict)
- Vitest for tests
- MCP SDK for the server (added when needed)
- Tree-sitter for cross-language AST checks in the verifier (added when needed)

## Commands

```bash
npm install
npm run dev         # local dev with file-watch
npm test            # run tests
npm run typecheck   # type check, no emit
npm run build       # compile to dist/
```

## Status

Pre-v1. Scaffold only. Implementation begins with phase A1.

See [CLAUDE.md](./CLAUDE.md) for the TNL workflow that governs development here.
