# CLAUDE.md

Guidance for Claude Code sessions in this repository.

## About this project

This repository is the **TNL (Typed Natural Language) tool itself**: a CLI, an MCP server, and a layered verifier. TNL is a structured English contract format for describing features in agent-written codebases. See [README.md](./README.md) for the stack and layout.

The repository is **dogfooded**: every feature of the TNL tool is described in a `tnl/*.tnl` file, reviewed, approved, and only then implemented. This directory's [`tnl/`](./tnl/) contains self-referential contracts governing the tool's own development.

## Important note on tooling state

The `tnl` CLI, MCP server, and verifier are **being built** in this repository. They do not yet exist as runnable tools. Do not invoke `tnl init`, `tnl verify`, or any other `tnl` subcommand during sessions — they will not work. The TNL workflow is enforced through this `CLAUDE.md` + [`tnl/workflow.tnl`](./tnl/workflow.tnl) for now; tooling replaces the manual flow as each phase lands.

---

## This repository uses TNL

TNL is the structured English contract format described below and in [`tnl/workflow.tnl`](./tnl/workflow.tnl). For every new feature, the agent writes a TNL file **before** implementing code, the user reviews and approves the TNL, and the agent then implements against the approved TNL.

TNL files live in [`tnl/`](./tnl/). The top-level workflow principles live in [`tnl/workflow.tnl`](./tnl/workflow.tnl) and apply to every session.

### Session start — always do this

1. **Read [`tnl/workflow.tnl`](./tnl/workflow.tnl) first.** Its clauses apply to every session, regardless of the task. Treat them as baseline MUSTs.
2. **Read any `tnl/*.tnl` file whose `paths:` or `surfaces:` overlap with the code you're about to touch.** These are feature contracts, and their clauses are ground-truth for that surface.
3. Treat the contents as part of your operating context. Implementation MUST satisfy every MUST clause; SHOULD clauses are strong preferences; `[semantic]` clauses require judgment to verify — confirm explicitly when they're satisfied.

### Task flow — new features and edits

Every task runs through the same flow, whether the request is for a new feature or a change to existing behavior.

1. **Scope the task.** Scan `tnl/` for files whose `paths:` or `surfaces:` overlap with the request.
   - If the task modifies behavior already described by an existing TNL, the output is an **edit** to that file.
   - If the task introduces a genuinely new behavioral surface, the output is a **new TNL file**.
   - Property changes to existing surfaces (new validation rule, changed semantics, tightened constraints, new inputs or outputs on existing routes) are **edits**, not new files.
2. **Clarify before proposing.** If the request admits multiple reasonable interpretations, ask targeted clarifying questions first. Do not silently pick one and proceed. (See `workflow.tnl`.)
3. **Propose the TNL diff.** For edits, show the changed clauses against the existing file. For new features, propose the full new TNL. Keep it concrete: real file paths, named function signatures where sensible, edge cases as MUST clauses, explicit non-goals.
4. **Wait for user approval** before writing any code.
5. **Apply the approved TNL.**
   - *Edits:* update the existing `tnl/<slug>.tnl` in place.
   - *New features:* save to `tnl/<new-slug>.tnl` (kebab-case, matching the `id:` field).
   - If an edit to one TNL affects clauses referenced in another TNL, update the related file(s) in the same proposal.
6. **Implement from the TNL.** Every MUST clause must be satisfied by specific code or tests. Paths in the machine zone are the scope fence — do not modify files outside them unless the user explicitly agrees.
7. **Self-attest at end of task.** Report which MUST clauses are satisfied and where (file/line/test name). Flag any that could not be satisfied and why. (See `workflow.tnl` clause on exhaustive self-attestation.)

### When a new TNL file is justified

Only for:

- A genuinely new behavioral surface (new CLI subcommand, new MCP tool, new subsystem)
- A cross-cutting policy that spans multiple existing TNLs (the model: `workflow.tnl`)
- A feature with a clear boundary not already covered by any existing TNL

Any other change — modifying inputs, outputs, semantics, validation, constraints, or identity rules of an existing surface — is an edit to the existing file. Do not create a new TNL to patch an existing one.

### TNL format

```
id: <kebab-case-slug>         # matches filename, lowercase, hyphenated
title: <short human-readable>
scope: repo-wide | feature    # repo-wide applies always; feature applies when paths match
owners: [@<handle>]
paths: [<file paths>]         # omit for scope: repo-wide
surfaces: [<CLI cmds, MCP tools, events>]  # optional — named external surfaces
dependencies: [<other tnl ids>]            # optional — other TNL units this couples with

intent:
  One-paragraph plain-English description of what this unit is for.

behaviors:
  - The system MUST <specific, testable behavior>.
  - When <condition>, the system MUST <response>.
  - [semantic] The system MUST <invariant that needs judgment to verify>.
  - The system SHOULD <strong preference, non-blocking>.

non-goals:
  - <explicit scope fence>

rationale:
  Optional prose — tradeoffs, gotchas, or the "why" behind choices.
```

### RFC 2119 keywords — what they mean here

- **MUST / MUST NOT** — hard requirement. If you cannot satisfy it, flag explicitly.
- **SHOULD / SHOULD NOT** — strong preference. Deviate only with stated reason.
- **MAY** — permission, not requirement.
- **`[semantic]`** prefix — clause requires judgment to verify rather than a structural check. Confirm in self-attestation.

---

## Commands

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

## Project shape conventions

- Source in `src/`, tests in `tests/`.
- Strict TypeScript. No `any` without comment.
- Module-per-responsibility: one concept per file where possible.
- Tests colocated by surface under `tests/<surface>/`.
- ESM only (`"type": "module"` in `package.json`).

These conventions are the floor. Feature TNLs take precedence when they say something more specific.

<!-- tnl:workflow-stanza -->
## TNL — Typed Natural Language

This repository uses TNL (Typed Natural Language): structured English contracts that describe behavioral surfaces for agent-written code. TNL files live in [`tnl/`](./tnl/).

**Session start.** Read [`tnl/workflow.tnl`](./tnl/workflow.tnl) for baseline coding principles, plus any `tnl/*.tnl` file whose `paths:` or `surfaces:` overlap with the code you are about to touch.

**Task flow.**
1. Scope — check `tnl/` for existing TNLs that cover the request.
2. If the task introduces a new behavioral surface, propose a new TNL at `tnl/<slug>.tnl`. If it modifies existing behavior, propose an edit to the existing file.
3. Wait for user approval on the TNL diff before writing code.
4. Implement against the approved TNL. Every MUST clause must map to specific code or tests.
5. Self-attest at end: list each MUST clause and where it is satisfied (or why not).

See [`tnl/workflow.tnl`](./tnl/workflow.tnl) for the full baseline.

**Slash command:** `/tnl-feature <description>` runs the TNL workflow as a single user-invocable command (see [`.claude/commands/tnl-feature.md`](./.claude/commands/tnl-feature.md)).
