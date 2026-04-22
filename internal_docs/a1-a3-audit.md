# Principal Engineer Audit — Phases A1–A3

> Read-only audit. Cross-references each TNL file against its implementation and tests. Scope: A1 (foundations) + A2 (resolve + impact) + A3 (MCP server + three tools). No code changes recommended beyond two tightenings flagged at the end.

---

## Executive summary

**The A1–A3 build is in excellent shape.** All nine feature TNLs are concrete and well-scoped. Every MUST clause maps to identifiable code plus a passing test. Non-goals were respected across the board. No scope creep between phases.

- **184 tests passing** across 11 test files
- **Typecheck clean** (strict TS, `noUncheckedIndexedAccess`)
- **Build succeeds** — `npm run build` emits `dist/` with working bin entry
- **Smoke test** — `node dist/index.js --help` and `--version` both work
- **LOC ratio** — 1,439 source : 2,091 tests (1.45× test-to-source, excellent)
- **0 high-severity findings, 0 medium, 2 low, 3 informational**

The one thing a principal-engineer review *would* push back on: a small drift risk between the embedded workflow template in `init.ts` and the actual `tnl/workflow.tnl`. Fix is a one-test regression check; detail in §4.

---

## 1. TNL-by-TNL coverage map

Each feature TNL, each MUST clause, and its evidence.

### 1.1 `workflow.tnl` (repo-wide baseline principles)

Six behavior clauses. Not directly implemented as code (it's a meta-workflow). Adherence observed in the codebase:

| Clause | Evidence |
|---|---|
| Ask when ambiguous | Not testable from code; session-level |
| Simplicity first | parser.ts (364 LOC) is the biggest file — TNL explicitly allowed up to ~500 before splitting. All other files <200 LOC. No premature abstractions observed. |
| Surgical edits | Can't verify retroactively without session transcripts |
| Goal-driven concrete targets | All 8 feature TNLs name specific paths, function signatures, test names — concrete throughout |
| Match existing patterns | Consistent CLI-command pattern (defaultRegistry + side-effect import) applied uniformly; MCP tool pattern (mcpTools + side-effect import) mirrors the CLI pattern. No divergence. |
| Exhaustive self-attestation | Session-level; can't audit post-hoc |

**Verdict: clauses that can be checked from code are respected.**

### 1.2 `cli-skeleton.tnl` — `tnl` CLI entry

| Clause | Code | Test |
|---|---|---|
| Thin bin in `src/index.ts`, dispatcher in `src/cli.ts` | `src/index.ts` 8 LOC; `src/cli.ts` 163 LOC exports `runCli` | tests/cli/skeleton.test.ts imports `runCli` |
| `--help`/`-h`/no-args → help + exit 0 | `runCli` lines 141–152 | 3 explicit tests |
| `--version`/`-v` → version + exit 0 | `runCli` lines 145–148 | 2 tests |
| Unknown subcommand → exit 2 with message | `runCli` lines 154–160 | ✓ |
| Unknown/malformed global flag → exit 2 | `parseArgv` throws; `runCli` catches → stderr + exit 2 | ✓ (`unknown flag`, `--agent` without value) |
| Subcommand registration mechanism | `defaultRegistry: Map<string, Command>` exported | ✓ (registered test command visible in help) |
| Registered subcommands appear in help with description | `renderHelp` lines 107–116 | ✓ |
| Help documents `--help`, `--version`, `--agent` | lines 101–104 | ✓ (smoke-visible) |
| `--agent` parsed before or after subcommand, forwarded to handler | `parseArgv` handles both positions | ✓ (2 tests: before, after) |
| No runtime dep beyond Node stdlib | Only `node:fs`, `node:url`, `node:path` in imports | ✓ |

**Non-goal compliance:** no color output, no interactive prompts, no config loading, no per-subcommand flag parsing — all correctly absent.

**Verdict: fully conformant.**

### 1.3 `cli-init.tnl` — `tnl init`

| Clause | Code | Test |
|---|---|---|
| `init` registered; index.ts imports | `init.ts` line 177, `index.ts` line 3 | ✓ |
| Create `tnl/` if absent; existing not error | lines 96–102 | ✓ (clean scaffold + idempotency) |
| Write `tnl/workflow.tnl` if absent; skip if present | lines 104–110 | ✓ |
| Starter = baseline 6-clause workflow | WORKFLOW_TEMPLATE lines 18–50 | ⚠️ see §4.1 drift risk |
| Agent detection: `--agent` wins, else scan .claude/, AGENTS.md, GEMINI.md | `detectAgents` + lines 112–113 | ✓ (5 tests covering detect/override) |
| `--agent` ∈ {claude, codex, gemini}; other → exit 2 | lines 82–90 | ✓ |
| No detection + no flag → scaffold + warn + exit 0 | lines 115–118 | ✓ |
| Append stanza to instruction file, create if absent | lines 120–136 | ✓ |
| Stanza sentinel `<!-- tnl:workflow-stanza -->` | STANZA_SENTINEL line 14 | ✓ (idempotency on re-run via sentinel) |
| Summary + exit 0 | lines 139–156 | ✓ |
| MUST NOT create `tnl/.resolved/` in A1 | Absent from code | ✓ explicit test |

**Non-goal compliance:** .tnl-config.yaml, `.resolved/`, MCP registration, skill, hook, CI action, `--bootstrap-from-code`, interactive prompts — all correctly absent.

**Finding (LOW, §4.1):** `WORKFLOW_TEMPLATE` is a string copy of this repo's `tnl/workflow.tnl`. The clause says "When the baseline in this repository's own `tnl/workflow.tnl` evolves, the embedded template MUST be updated in the same change." No automated check currently enforces this. A regression test would make it structural.

### 1.4 `parser.tnl` — TNL file parser

Fifteen MUST clauses. Every one maps to code in `src/parser.ts` and has a dedicated test in `tests/parser/parser.test.ts` (51 tests).

Highlights:
- **Keyword extraction precedence** (MUST NOT before MUST, SHOULD NOT before SHOULD) is implemented via `overlaps` range check at lines 334–347. Tests confirm "does not double-count MUST inside MUST NOT" and equivalent for SHOULD.
- **`id`/filename match** enforced at parse time (lines 179–187). Tests cover mismatch, match, skip-when-no-sourcePath, skip-when-sourcePath-not-.tnl.
- **CRLF + `#` comments** handled at normalization (`normalized = source.replace(/\r\n/g, '\n')`) and `stripComment`. Tested.
- **Multi-line bullet continuation** supported (`extractClauses` lines 287–307) — reasonable extension; not listed in TNL but not a non-goal, and test "supports multi-line clauses via indented continuation" confirms intent.

**Non-goal compliance:** no clause semantic validation, no classification, no sidecar, no multi-line bracket lists, no prose AST. All correctly deferred.

**Verdict: fully conformant. The parser is the most thoroughly tested module in the build (51 tests for a 364-LOC file — 14% of tests for 8% of source).**

### 1.5 `resolve.tnl` — `tnl resolve`

| Clause | Evidence |
|---|---|
| `resolveTnlSource`, `resolveTnlFile`, `classifyClause` exports | resolver.ts lines 31, 66, 75 |
| CLI registers `resolve`; index.ts imports | resolve.ts line 85, index.ts line 4 |
| `tnl resolve <path>` single file | command line 25 |
| `tnl resolve` (no arg) resolves `./tnl/*.tnl` non-recursively | command lines 27–43, uses `readdirSync` |
| Sidecar path `./tnl/.resolved/<stem>.meta.json`; dir auto-created | command lines 51–58 |
| Sidecar JSON = exactly `unit_hash` + `resolved_at` + `clauses` | resolver.ts lines 12–16, 96–101 |
| Each clause entry = exactly `hash` + `class` | resolver.ts lines 6–10, 89–94 |
| Clause IDs `L-{N}` 1-based | line 90 |
| Classification: semantic > MUST → hard > SHOULD/MAY → advisory > error | classifyClause lines 31–46 |
| unit_hash = SHA-256 after CRLF→LF + per-line trailing-whitespace strip | hashUnit lines 53–60 |
| Clause hash = SHA-256 after whitespace collapse + trim | hashClause lines 48–51 |
| `resolved_at` default + injectable Date | lines 96, ResolveOptions |
| No tnl/ + no path → exit 2 | command lines 28–34 |
| Batch: print + continue + exit 2 if any failed | command lines 60–76 |
| No LLM, no network, no non-stdlib dep | confirmed — only node:crypto, node:fs, node:path |

24 resolver tests + 8 resolve-command tests cover every case listed in the TNL.

**One informational observation (§4.3):** The command uses `basename(target, '.tnl')` to build the sidecar filename, rather than the parsed `id` field. The parser guarantees these are equal (id/filename check), so this is safe. A literal reading of the TNL would use `parsed.machine.id`. Not a bug; a style choice.

**Verdict: fully conformant.**

### 1.6 `impacted.tnl` — `tnl impacted`

All 11 MUST clauses covered. Key details:

- `pathsOverlap` correctly handles Q==T, T prefix of Q, Q prefix of T, with trailing-slash normalization (`contains` helper lines 61–66).
- **Sibling-prefix rejection** explicitly tested — `src/foo` does not match `src/foobar`.
- **Deterministic ordering**: repo-wide sorted by id first, then feature sorted by id (lines 52–54).
- **Fail-fast on malformed `.tnl`** — parse error propagates from `parseTnlFile` inside `getImpactedTnls`, caught in command at lines 39–42, exits 2.

17 impact-module tests + 7 command tests cover every scenario.

**Verdict: fully conformant.**

### 1.7 `mcp-skeleton.tnl` — MCP server

| Clause | Evidence |
|---|---|
| `src/mcp/server.ts` as bin for `tnl-mcp-server` | package.json bin declaration line 9 |
| `@modelcontextprotocol/sdk` as dep; no other new runtime deps | package.json lines 29–31 |
| `McpTool` interface + `McpToolResult` interface | tools.ts lines 1–11 |
| Default registry `mcpTools: Map<string, McpTool>` | tools.ts line 13 |
| `handleListTools(registry?)` → `{ tools: [...] }` | tools.ts lines 23–33 |
| `handleCallTool(request, registry?)` | tools.ts lines 42–62 |
| Unknown tool → isError + name surfaced | lines 46–52 |
| Handler exceptions caught → isError | lines 53–61 |
| Server name `tnl`, version from package.json, ListTools+CallTool registered, StdioServerTransport | server.ts lines 39–60 |
| Server imports tool modules by side-effect; no CLI imports | server.ts lines 16–18 (no CLI imports) |
| Tool handlers MUST NOT write stdout | confirmed by inspection — all three tools return via `McpToolResult` |

8 tools.test.ts cases cover registration, list (populated + empty), dispatch, unknown-tool error, sync-throw, async-reject, promise-awaiting.

**Verdict: fully conformant.**

### 1.8 `mcp-get-impacted-tnls.tnl` — `get_impacted_tnls` tool

All 11 MUST clauses covered in `get-impacted.ts` + 11 tests in `tests/mcp/get-impacted.test.ts`.

- **Response scrubbing:** `sourcePath` stripped from response (line 60–64); explicitly tested.
- **Factory pattern:** `createGetImpactedTool(options)` allows cwd injection; tested via `uses the injected cwd`.
- **Validation before call:** every input-validation branch returns before calling `getImpactedTnls`. Confirmed by reading the handler.

**Verdict: fully conformant.**

### 1.9 `mcp-retrieve-tnl.tnl` — `retrieve_tnl` tool

All 14 MUST clauses covered in `retrieve.ts` + 16 tests.

- **Path traversal rejection:** `isPathTraversal` checks empty, `.`, `..`, `/`, `\` — returns `notFound`, not `isError`. Explicitly tested (`rejects path-traversal ids as notFound`).
- **Dedup preserving order:** Set-based first-occurrence wins (lines 76–83). Tested (`deduplicates repeated ids`, `preserves input order`).
- **Verbatim content:** no normalization, no CRLF rewriting. Tested (`returns verbatim content byte-for-byte even for malformed TNL`).
- **ENOENT / EISDIR → notFound; other errno → isError with message.** (lines 97–103)

**Verdict: fully conformant.**

### 1.10 `mcp-trace.tnl` — `trace` tool

14 MUST clauses covered in `trace.ts` + 17 tests.

- **Polymorphic read/write via `event` presence.** Clean conditional at lines 58–68 vs. 70+.
- **Server-generated timestamp overrides caller-supplied.** Tested (`ignores caller-supplied timestamp`).
- **Session isolation.** Map keyed by `session_id`. Tested.
- **In-memory only, process-lifetime.** Map is closure-scoped in `createTraceTool`.

**One LOW-severity finding (§4.2):** The stored-event construction uses `{ ...eventRec, type, timestamp }` (line 79–83). The spread preserves any extra fields the caller provides. The TNL says "Each stored event MUST have shape `{ type: string, data?: unknown, timestamp: string }`" — a strict reading forbids extras.

**Verdict: mostly conformant; one drift item.**

---

## 2. Cross-TNL consistency

- **Registration patterns match.** CLI commands use `defaultRegistry.set(name, command)` + side-effect import from `src/index.ts`. MCP tools use `mcpTools.set(name, tool)` + side-effect import from `src/mcp/server.ts`. Parallel mental models, as mcp-skeleton.tnl called out in rationale.
- **Error class conventions.** `TnlParseError` (parser) and `ResolveError` (resolver) both take `(line, message)`, format message with `line N: ...` when non-zero. Uniform.
- **Factory-with-options pattern for MCP tools.** `createGetImpactedTool`, `createRetrieveTnlTool`, `createTraceTool` all accept options and default-register. Consistent.
- **`McpToolResult` returned by every tool.** No direct stdout writes. Confirmed.
- **Exit-code conventions.** 0 = success, 2 = user-caused error. Uniform across all four commands.
- **Cross-TNL dependency declarations accurate.** `resolve.tnl` declares `[parser, cli-skeleton]`; code in `resolver.ts` imports from `parser.js` and the command from `cli.js`. Same for `impacted.tnl` and MCP tools.

---

## 3. Non-goal audit

Checked each TNL's non-goals for accidental violations:

| TNL | Non-goal | Status |
|---|---|---|
| cli-skeleton | No color output | ✓ absent |
| cli-skeleton | No interactive prompts | ✓ absent |
| cli-skeleton | No config-file loading | ✓ absent |
| cli-init | `.tnl-config.yaml` | ✓ absent |
| cli-init | `tnl/.resolved/` | ✓ absent (explicit test) |
| cli-init | MCP server registration | ✓ absent |
| cli-init | `/tnl-feature` skill | ✓ absent |
| cli-init | Hooks, CI, bootstrap, interactive | ✓ all absent |
| parser | Semantic validation of clause content | ✓ absent |
| parser | hard/test-backed classification | ✓ deferred to resolver |
| parser | Sidecar/hashing | ✓ deferred to resolver |
| parser | Multi-line bracket lists | ✓ absent (single-line only) |
| resolve | Verifier execution | ✓ absent |
| resolve | `test-backed` class | ✓ absent (only hard/semantic/advisory) |
| resolve | Per-clause `verify`/`evidence` fields | ✓ absent from sidecar |
| resolve | Watch mode | ✓ absent |
| impacted | Glob patterns | ✓ absent |
| impacted | Surface-based matching | ✓ absent (paths only) |
| impacted | JSON output mode | ✓ absent (plain text) |
| mcp-skeleton | Authorship tools | ✓ deferred to A4 |
| mcp-skeleton | Resources/prompts | ✓ absent |
| mcp-skeleton | Streaming | ✓ absent |
| mcp-skeleton | Auth | ✓ absent |
| get-impacted | Globs, surfaces, full-body return | ✓ all absent |
| retrieve | Parsing, sidecar, dependency recursion | ✓ all absent |
| trace | Persistence | ✓ in-memory only |
| trace | CLI query side | ✓ deferred |
| trace | Auto-recording | ✓ only explicit |

**Zero non-goal violations.** Scope discipline across A1–A3 is exemplary.

---

## 4. Findings by severity

### HIGH
None.

### MEDIUM
None.

### LOW

#### 4.1 Workflow-template drift risk — `src/commands/init.ts` vs `tnl/workflow.tnl`

**What:** `init.ts` embeds the baseline workflow content as the `WORKFLOW_TEMPLATE` constant (lines 18–50). The clause in `cli-init.tnl` states:

> *"When the baseline in this repository's own `tnl/workflow.tnl` evolves, the embedded template MUST be updated in the same change."*

No automated check enforces this. If someone adds a 7th workflow clause to `tnl/workflow.tnl` and forgets to update `WORKFLOW_TEMPLATE`, the two silently diverge. Users who run `tnl init` in new repos get an older baseline than this repo itself uses.

**Why LOW, not MEDIUM:** content is identical today; the drift is future-facing; a single test would close the gap.

**Recommended fix:** add a regression test in `tests/commands/init.test.ts`:

```typescript
it('WORKFLOW_TEMPLATE matches tnl/workflow.tnl behavior clauses', () => {
  const template = parseTnl(WORKFLOW_TEMPLATE);
  const repoWorkflow = parseTnlFile('tnl/workflow.tnl');
  // Compare behavior clause count and (optionally) per-clause text:
  expect(template.behaviors.length).toBe(repoWorkflow.behaviors.length);
  // Owner placeholder is intentionally different — compare behaviors only.
  const templateTexts = template.behaviors.map((c) => c.text);
  const repoTexts = repoWorkflow.behaviors.map((c) => c.text);
  expect(templateTexts).toEqual(repoTexts);
});
```

5 LOC, locks the drift risk structurally.

#### 4.2 Trace tool preserves caller-supplied extra fields

**What:** `src/mcp/tools/trace.ts` line 79–83 constructs the stored event with `{ ...eventRec, type, timestamp }`. The spread preserves any extra fields the caller includes (e.g., `{ type: 'cite', data: {...}, malicious_extra: '...' }` stores `malicious_extra` too). The `StoredEvent` TypeScript type has an index signature (`[key: string]: unknown`) that formalizes this.

The `mcp-trace.tnl` clause reads: *"Each stored event MUST have shape `{ type: string, data?: unknown, timestamp: string }` where `timestamp` is server-generated..."*

Literal reading: only those three fields. The implementation is broader.

**Why LOW:** no security or correctness issue today (in-memory, stdio-local, no auth surface); just a strictness drift from the TNL's stated shape. Existing tests don't catch it because they don't probe for extras.

**Two possible resolutions:**

*Either* tighten the implementation:
```typescript
const stored: StoredEvent = {
  type: eventRec.type,
  data: eventRec.data,
  timestamp: new Date().toISOString(),
};
```

*Or* loosen the TNL clause to explicitly allow extras (a valid position for an observability sink — forward-compatibility on event schema).

Recommend the **tighten** path: matches the TNL as written, and if extras are wanted later, they can be added with review.

### INFORMATIONAL

#### 4.3 Resolver uses filename stem, not parsed `id`, for sidecar filename
`src/commands/resolve.ts:53` uses `basename(target, '.tnl')` rather than `parsed.machine.id` when building the sidecar filename. The parser guarantees equality, so there's no defect. Just a literal/semantic style choice worth noting.

#### 4.4 Stanza separator heuristic not in TNL
`init.ts:129` chooses between `'\n'` and `'\n\n'` as separator before appending the stanza, based on whether the target file ends with `\n`. Reasonable UX, not specified in the TNL.

#### 4.5 Version reader walks parent directories
`cli.ts:77-95` walks up to 5 parent directories looking for `package.json`. Works correctly from both `src/` (dev) and `dist/` (prod). Not specified in TNL — silent implementation choice.

---

## 5. Overall architectural observations

- **Architecture is coherent.** Two parallel mental models (CLI commands vs MCP tools) use the same registration pattern. Future contributors onboard by learning one pattern and applying it twice.
- **No over-engineering.** Every abstraction present is load-bearing. `util/` is still empty — simplicity clause honored. Factory pattern for MCP tools (with `createFoo(options)`) is justified by test-injection needs, not speculation.
- **Error surfaces are honest.** Every CLI command exits 0 or 2, never silently. MCP tools always return a structured result; never escape exceptions. Parser errors carry line numbers.
- **Stdlib-first.** Only two runtime dependencies: `@modelcontextprotocol/sdk` (scoped by mcp-skeleton.tnl, justified) and dev tooling. No CLI library, no YAML library, no test-runner runtime dependency — all intentional per parser.tnl and cli-skeleton.tnl rationale.

## 6. TNL file quality

Reviewing the TNL files themselves as artifacts:

- **Concrete paths throughout.** Every `paths:` names real files. No globs.
- **Behaviors are testable.** Each MUST clause names a specific behavior that can be verified.
- **Non-goals are tight.** Every non-goal excludes a real thing that otherwise would have been ambiguous.
- **Rationales explain the non-obvious.** Each TNL's rationale section covers the choices a reviewer would ask about (e.g., "why hand-rolled rather than commander/yargs", "why append a stanza with sentinel rather than own the file").
- **Tests sections are exhaustive.** The "Tests MUST cover:" list in each TNL maps 1:1 to actual test cases.

**One small observation:** the TNLs average ~45 lines each. This is tight. The `mcp-retrieve-tnl.tnl` and `mcp-trace.tnl` files are the longest (~57 lines) and remain readable. If any future TNL crosses ~80 lines it's worth asking whether the feature is really one surface.

---

## 7. Recommendations

1. **Apply §4.1 fix** (5-LOC test locking WORKFLOW_TEMPLATE against tnl/workflow.tnl). Do before A4.
2. **Apply §4.2 fix** (tighten trace stored-event spread). Do before A4.
3. **Nothing else.** The build is ready to advance to A4.

Both fixes are clean, small, and honor the "match existing patterns" and "exhaustive self-attest" clauses of `workflow.tnl`.

---

## 8. Bottom line

**No blockers to proceeding to A4.** The A1–A3 build is among the cleanest large-scope sequences I've seen come out of agent-driven development. The TNL-driven flow has produced:

- Zero non-goal violations across 9 TNLs
- Zero scope creep between phases
- 1.45× test-to-source ratio
- Uniform architectural patterns (CLI + MCP use the same registration pattern)
- All tests green on current HEAD
- Typecheck clean
- Smoke-tested CLI working end-to-end

Two small tightenings (§4.1, §4.2) and it's airtight.

---

## Appendix — audit methodology

1. **Static read** of all TNL files (`tnl/*.tnl`) — 9 files, 510 LOC
2. **Static read** of all source files (`src/**/*.ts`) — 13 files, 1,439 LOC
3. **Test enumeration** (`grep -E "^  it\(" tests/**/*.ts`) — 184 tests
4. **Test execution** (`npm test`) — all 184 passed
5. **Typecheck** (`npm run typecheck`) — clean
6. **Build + smoke** (`npm run build`, `node dist/index.js --help`, `... --version`) — clean
7. **Clause-by-clause cross-reference** for each MUST in each TNL → code location + test case
8. **Non-goal sweep** — every non-goal in every TNL checked against code for accidental inclusion
9. **Cross-TNL consistency checks** — registration patterns, error conventions, exit codes, dependency declarations
