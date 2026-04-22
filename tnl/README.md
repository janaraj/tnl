# `tnl/` — Typed Natural Language contracts

This directory holds the TNL files that govern development of this repository. Because this repository *is* the TNL tool, the files here are self-referential: they describe features of the TNL tool itself.

## Files

| File | Scope | When read |
|---|---|---|
| `workflow.tnl` | `repo-wide` | Every session, at start. Baseline coding principles. |
| `<feature-slug>.tnl` | `feature` | When the agent touches paths in the file's `paths:` list. |

## Format

See [`../CLAUDE.md`](../CLAUDE.md) for the full schema, task flow, and RFC 2119 keyword semantics.

## What's here

- `workflow.tnl` — baseline coding principles (six clauses) that apply to every session.

Feature TNLs are added as features are built. The first feature TNL lands during phase A1.
