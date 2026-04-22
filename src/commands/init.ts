import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';

type AgentName = 'claude' | 'codex' | 'gemini';
const ALLOWED_AGENTS: readonly AgentName[] = ['claude', 'codex', 'gemini'] as const;

const INSTRUCTION_FILES: Record<AgentName, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
};

const STANZA_SENTINEL = '<!-- tnl:workflow-stanza -->';

// Baseline workflow; keep in sync with this repo's tnl/workflow.tnl.
// The `owners` field is a placeholder that adopters replace after init.
// Exported for the drift-guard test in tests/commands/init.test.ts.
export const WORKFLOW_TEMPLATE = `id: workflow
title: Baseline coding principles
scope: repo-wide
owners: [@TODO]

intent:
  Baseline workflow principles that apply to every coding session in this
  repository. These clauses are read at session start regardless of the
  task. They describe how work is done here — not what is being built —
  and address recurring failure modes in agent-driven development.

behaviors:
  - When a request admits more than one reasonable interpretation, the agent MUST ask clarifying questions before proposing a TNL or writing code. The agent MUST NOT silently pick one interpretation and proceed.
  - The agent MUST write the minimum code that satisfies the request. Abstractions, helpers, generic utilities, and configuration hooks MUST NOT be introduced unless the current task requires them — three similar lines beat a premature abstraction. Do not generalize for hypothetical future needs.
  - The agent MUST modify only code directly necessary for the requested change. Refactoring, renaming, or cleaning up neighboring code MUST NOT happen on the way by. Adjacent issues MUST be surfaced separately, not bundled.
  - Before writing code, the agent MUST translate the request into concrete, verifiable targets: specific file paths, function signatures, test names, or TNL clauses. Fuzzy requirements MUST NOT be implemented directly. If targets cannot be named, the agent MUST ask until they can.
  - When adding code to an existing codebase, the agent MUST first identify the conventions in use (naming, error handling, test structure, file organization) and follow them. New patterns MAY be introduced only when no existing pattern fits, and MUST be surfaced explicitly rather than introduced silently.
  - At the end of every task that produced code changes, the agent MUST list each MUST clause from the active TNL files (this file plus any feature TNLs touched) and state for each: (a) satisfied — by which file/function/test, (b) could not satisfy — why, or (c) did not apply — why. The list MUST be exhaustive; silent omission counts as a failure.

non-goals:
  - These principles do not override feature-specific TNL clauses. When a feature TNL states a MUST that conflicts with or narrows one of these, the feature TNL takes precedence.
  - These principles are a floor, not a ceiling. They do not enumerate every good engineering practice — only the ones that address recurring failure modes.
  - Design principles (DRY, SOLID, composition patterns) belong in project-specific documentation, not here. This file governs session workflow, not code architecture.

rationale:
  Each behavior targets a specific failure pattern observed in prior sessions:
    - Silent interpretation of ambiguous requests leads to the wrong feature shipped fast.
    - Overengineering produces code that must be maintained forever for a problem that never materializes.
    - Incidental refactoring bundles unreviewed changes into a focused diff, hiding what actually changed.
    - Fuzzy requirements produce fuzzy implementations with edge cases silently dropped.
    - Introducing new patterns silently creates invisible architectural drift — the codebase gains a second way to do everything, and no one reviewed the split.
    - Exhaustive self-attestation forces the agent to reconcile "what the contract required" against "what I actually wrote," which is where misses have historically been caught.
`;

const STANZA_TEMPLATE = `${STANZA_SENTINEL}
## TNL — Typed Natural Language

This repository uses TNL (Typed Natural Language): structured English contracts that describe behavioral surfaces for agent-written code. TNL files live in [\`tnl/\`](./tnl/).

**Session start.** Read [\`tnl/workflow.tnl\`](./tnl/workflow.tnl) for baseline coding principles, plus any \`tnl/*.tnl\` file whose \`paths:\` or \`surfaces:\` overlap with the code you are about to touch.

**Task flow.**
1. Scope — check \`tnl/\` for existing TNLs that cover the request.
2. If the task introduces a new behavioral surface, propose a new TNL at \`tnl/<slug>.tnl\`. If it modifies existing behavior, propose an edit to the existing file.
3. Wait for user approval on the TNL diff before writing code.
4. Implement against the approved TNL. Every MUST clause must map to specific code or tests.
5. Self-attest at end: list each MUST clause and where it is satisfied (or why not).

See [\`tnl/workflow.tnl\`](./tnl/workflow.tnl) for the full baseline.
`;

const CLAUDE_STANZA_ADDITION = `
**Slash command:** \`/tnl-feature <description>\` runs the TNL workflow as a single user-invocable command (see [\`.claude/commands/tnl-feature.md\`](./.claude/commands/tnl-feature.md)).
`;

export const TNL_FEATURE_SKILL_TEMPLATE = `---
description: Propose a TNL for a feature, get user approval, then implement against the contract
---

# /tnl-feature

Arguments: $ARGUMENTS

Run the TNL workflow for the feature described in arguments. Follow these steps exactly.

## 1. Scope

Read [\`tnl/workflow.tnl\`](../../tnl/workflow.tnl) and any \`tnl/*.tnl\` whose \`paths:\` or \`surfaces:\` overlap with the code you are about to touch. If the TNL MCP server is configured, use the \`get_impacted_tnls\` tool with the likely target code paths.

## 2. Clarify

If the request admits more than one reasonable interpretation, ask targeted clarifying questions BEFORE proposing a TNL. Do NOT silently pick an interpretation.

## 3. Propose

Draft a TNL diff:

- **New behavioral surface** → new \`tnl/<slug>.tnl\` with \`id:\` matching the filename stem.
- **Modified behavior** → edit to the existing TNL.

Every MUST clause must be concrete and testable (specific file paths, function names, test names). If the MCP \`propose_tnl_diff\` tool is configured, use it to stage the proposal and return a \`diff_id\`.

## 4. Wait for approval

Do NOT write code until the user approves the TNL diff. Incorporate any edits the user makes before proceeding.

## 5. Implement

Write the code and tests the approved TNL requires. Modify only files listed in the TNL's \`paths:\` unless the user explicitly agrees to scope expansion. If \`propose_tnl_diff\` staged the diff, call \`approve_tnl_diff\` now to write the TNL file and regenerate its sidecar.

## 6. Self-attest

List each MUST clause from \`workflow.tnl\` plus the feature TNL(s) touched. For each state: (a) satisfied — by which file/function/test, (b) could not satisfy — why, or (c) did not apply — why. The list MUST be exhaustive.
`;

export interface InitOptions {
  agent?: string;
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  minimal?: boolean;
  noCi?: boolean;
  noMcp?: boolean;
  noHook?: boolean;
  noSkill?: boolean;
}

export function runInit(options: InitOptions = {}): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  let requestedAgent: AgentName | undefined;
  if (options.agent !== undefined) {
    if (!(ALLOWED_AGENTS as readonly string[]).includes(options.agent)) {
      err(
        `tnl init: unknown --agent value '${options.agent}'. Allowed: ${ALLOWED_AGENTS.join(', ')}\n`,
      );
      return 2;
    }
    requestedAgent = options.agent as AgentName;
  }

  const noCi = options.minimal || options.noCi || false;
  const noMcp = options.minimal || options.noMcp || false;
  const noHook = options.minimal || options.noHook || false;
  const noSkill = options.minimal || options.noSkill || false;

  const created: string[] = [];
  const skipped: string[] = [];
  const suppressed: string[] = [];
  const warnings: string[] = [];

  const tnlDir = join(cwd, 'tnl');
  if (existsSync(tnlDir)) {
    skipped.push('tnl/');
  } else {
    mkdirSync(tnlDir, { recursive: true });
    created.push('tnl/');
  }

  const workflowPath = join(tnlDir, 'workflow.tnl');
  if (existsSync(workflowPath)) {
    skipped.push('tnl/workflow.tnl');
  } else {
    writeFileSync(workflowPath, WORKFLOW_TEMPLATE, 'utf8');
    created.push('tnl/workflow.tnl');
  }

  const targets: AgentName[] =
    requestedAgent !== undefined ? [requestedAgent] : detectAgents(cwd);

  if (targets.length === 0) {
    warnings.push(
      'No agent detected (no .claude/, AGENTS.md, or GEMINI.md in cwd) and --agent not passed. Skipped instruction-file stanza. Run `tnl init --agent <claude|codex|gemini>` to add one.',
    );
  } else {
    for (const agent of targets) {
      const file = INSTRUCTION_FILES[agent];
      const filePath = join(cwd, file);
      const stanza =
        agent === 'claude'
          ? STANZA_TEMPLATE + CLAUDE_STANZA_ADDITION
          : STANZA_TEMPLATE;
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        if (content.includes(STANZA_SENTINEL)) {
          skipped.push(file);
          continue;
        }
        const separator = content.endsWith('\n') ? '\n' : '\n\n';
        writeFileSync(filePath, content + separator + stanza, 'utf8');
        created.push(`${file} (stanza appended)`);
      } else {
        writeFileSync(filePath, stanza, 'utf8');
        created.push(file);
      }
    }

    if (targets.includes('claude')) {
      const skillDir = join(cwd, '.claude', 'commands');
      const skillPath = join(skillDir, 'tnl-feature.md');
      if (noSkill) {
        suppressed.push('.claude/commands/tnl-feature.md');
      } else if (existsSync(skillPath)) {
        skipped.push('.claude/commands/tnl-feature.md');
      } else {
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillPath, TNL_FEATURE_SKILL_TEMPLATE, 'utf8');
        created.push('.claude/commands/tnl-feature.md');
      }

      if (noHook) {
        suppressed.push('.claude/settings.json');
      } else {
        installClaudeHook(cwd, created, skipped, warnings, err);
      }

      if (noMcp) {
        suppressed.push('.mcp.json');
      } else {
        installMcpConfig(cwd, created, skipped, warnings, err);
      }
    }

    if (targets.some((t) => t === 'codex' || t === 'gemini')) {
      warnings.push(
        'MCP server registration for codex/gemini is not automated. Add `{"mcpServers": {"tnl": {"command": "npx", "args": ["-y", "@tnl/mcp-server"]}}}` to your user-scoped MCP config manually.',
      );
    }
  }

  if (noCi) {
    suppressed.push('.github/workflows/tnl-verify.yml');
  } else {
    installCiWorkflow(cwd, created, skipped);
  }

  const lines: string[] = [];
  if (created.length > 0) {
    lines.push('Created:');
    for (const c of created) lines.push(`  ${c}`);
  }
  if (skipped.length > 0) {
    lines.push('Skipped (already present):');
    for (const s of skipped) lines.push(`  ${s}`);
  }
  if (suppressed.length > 0) {
    lines.push('Skipped (opt-out):');
    for (const s of suppressed) lines.push(`  ${s}`);
  }
  if (warnings.length > 0) {
    lines.push('Warnings:');
    for (const w of warnings) lines.push(`  ${w}`);
  }
  if (lines.length === 0) {
    lines.push('Nothing to do.');
  }
  out(lines.join('\n') + '\n');
  return 0;
}

const HOOK_COMMAND = 'npx @tnl/cli hook pre-tool-use';
const HOOK_MATCHER = 'Edit|Write|MultiEdit';

const CI_WORKFLOW_TEMPLATE = `name: TNL Verify

on:
  push:
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx -y @tnl/cli verify
`;

function installCiWorkflow(
  cwd: string,
  created: string[],
  skipped: string[],
): void {
  const workflowPath = join(cwd, '.github', 'workflows', 'tnl-verify.yml');
  if (existsSync(workflowPath)) {
    skipped.push('.github/workflows/tnl-verify.yml');
    return;
  }
  mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
  writeFileSync(workflowPath, CI_WORKFLOW_TEMPLATE, 'utf8');
  created.push('.github/workflows/tnl-verify.yml');
}

const MCP_SERVER_ENTRY = {
  command: 'npx',
  args: ['-y', '@tnl/mcp-server'],
};

interface McpConfigShape {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

function installMcpConfig(
  cwd: string,
  created: string[],
  skipped: string[],
  warnings: string[],
  err: (s: string) => void,
): void {
  const mcpPath = join(cwd, '.mcp.json');

  if (!existsSync(mcpPath)) {
    const initial: McpConfigShape = {
      mcpServers: { tnl: MCP_SERVER_ENTRY },
    };
    writeFileSync(mcpPath, JSON.stringify(initial, null, 2) + '\n', 'utf8');
    created.push('.mcp.json');
    return;
  }

  const content = readFileSync(mcpPath, 'utf8');
  let parsed: McpConfigShape;
  try {
    parsed = JSON.parse(content) as McpConfigShape;
  } catch {
    const msg =
      '.mcp.json is not valid JSON; skipped MCP server registration. Fix the file and re-run `tnl init --agent claude`.';
    warnings.push(msg);
    err(`tnl init: ${msg}\n`);
    return;
  }

  const mcpServers = parsed.mcpServers ?? {};
  if ('tnl' in mcpServers) {
    skipped.push('.mcp.json');
    return;
  }

  mcpServers.tnl = MCP_SERVER_ENTRY;
  parsed.mcpServers = mcpServers;

  writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  created.push('.mcp.json (tnl added)');
}

interface SettingsShape {
  hooks?: {
    PreToolUse?: Array<{
      matcher?: string;
      hooks?: Array<{ type?: string; command?: string }>;
    }>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function installClaudeHook(
  cwd: string,
  created: string[],
  skipped: string[],
  warnings: string[],
  err: (s: string) => void,
): void {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  const hookEntry = {
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  };

  if (!existsSync(settingsPath)) {
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    const initial: SettingsShape = {
      hooks: { PreToolUse: [hookEntry] },
    };
    writeFileSync(
      settingsPath,
      JSON.stringify(initial, null, 2) + '\n',
      'utf8',
    );
    created.push('.claude/settings.json');
    return;
  }

  const content = readFileSync(settingsPath, 'utf8');
  if (content.includes(HOOK_COMMAND)) {
    skipped.push('.claude/settings.json');
    return;
  }

  let parsed: SettingsShape;
  try {
    parsed = JSON.parse(content) as SettingsShape;
  } catch {
    const msg =
      '.claude/settings.json is not valid JSON; skipped hook registration. Fix the file and re-run `tnl init --agent claude`.';
    warnings.push(msg);
    err(`tnl init: ${msg}\n`);
    return;
  }

  const hooks = parsed.hooks ?? {};
  const preToolUse = hooks.PreToolUse ?? [];
  preToolUse.push(hookEntry);
  hooks.PreToolUse = preToolUse;
  parsed.hooks = hooks;

  writeFileSync(
    settingsPath,
    JSON.stringify(parsed, null, 2) + '\n',
    'utf8',
  );
  created.push('.claude/settings.json (hook added)');
}

function detectAgents(cwd: string): AgentName[] {
  const agents: AgentName[] = [];
  try {
    if (statSync(join(cwd, '.claude')).isDirectory()) agents.push('claude');
  } catch {
    // not present
  }
  if (existsSync(join(cwd, 'AGENTS.md'))) agents.push('codex');
  if (existsSync(join(cwd, 'GEMINI.md'))) agents.push('gemini');
  return agents;
}

const initCommand: Command = {
  name: 'init',
  description: 'Initialize TNL in the current directory',
  handler: (args: CommandArgs) => {
    const flags = new Set(args.rest.filter((a) => a.startsWith('--')));
    return runInit({
      agent: args.agent,
      minimal: flags.has('--minimal'),
      noCi: flags.has('--no-ci'),
      noMcp: flags.has('--no-mcp'),
      noHook: flags.has('--no-hook'),
      noSkill: flags.has('--no-skill'),
    });
  },
};

defaultRegistry.set('init', initCommand);
