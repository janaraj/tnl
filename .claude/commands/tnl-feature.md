---
description: Propose a TNL for a feature, get user approval, then implement against the contract
---

# /tnl-feature

Arguments: $ARGUMENTS

Run the TNL workflow for the feature described in arguments. Follow these steps exactly.

## 1. Scope

Read [`tnl/workflow.tnl`](../../tnl/workflow.tnl) and any `tnl/*.tnl` whose `paths:` or `surfaces:` overlap with the code you are about to touch. If the TNL MCP server is configured, use the `get_impacted_tnls` tool with the likely target code paths.

## 2. Clarify

If the request admits more than one reasonable interpretation, ask targeted clarifying questions BEFORE proposing a TNL. Do NOT silently pick an interpretation.

## 3. Propose

Draft a TNL diff:

- **New behavioral surface** → new `tnl/<slug>.tnl` with `id:` matching the filename stem.
- **Modified behavior** → edit to the existing TNL.

Every MUST clause must be concrete and testable (specific file paths, function names, test names). If the MCP `propose_tnl_diff` tool is configured, use it to stage the proposal and return a `diff_id`.

## 4. Wait for approval

Do NOT write code until the user approves the TNL diff. Incorporate any edits the user makes before proceeding.

## 5. Implement

Write the code and tests the approved TNL requires. Modify only files listed in the TNL's `paths:` unless the user explicitly agrees to scope expansion. If `propose_tnl_diff` staged the diff, call `approve_tnl_diff` now to write the TNL file and regenerate its sidecar.

## 6. Self-attest

List each MUST clause from `workflow.tnl` plus the feature TNL(s) touched. For each state: (a) satisfied — by which file/function/test, (b) could not satisfy — why, or (c) did not apply — why. The list MUST be exhaustive.
