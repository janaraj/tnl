import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export const STANZA_TEMPLATE = `${STANZA_SENTINEL}
## TNL — Typed Natural Language

This repository uses TNL (Typed Natural Language): structured English contracts that describe behavioral surfaces for agent-written code. TNL files live in [\`tnl/\`](./tnl/).

**Session start.** Read [\`tnl/workflow.tnl\`](./tnl/workflow.tnl) for baseline coding principles, plus any \`tnl/*.tnl\` file whose \`paths:\` or \`surfaces:\` overlap with the code you are about to touch.

**Task flow.**
1. **Scope.** Check \`tnl/\` for existing TNLs covering the request. If the task modifies behavior already described, the output is an *edit* to that file; if it introduces a genuinely new behavioral surface, the output is a *new TNL*. Property changes to existing surfaces (new validation rule, tightened constraint, new input/output on an existing route) are edits, not new files.
2. **Clarify.** If the request admits multiple reasonable interpretations, ask targeted clarifying questions first. Do not silently pick one. When your tool surface supports structured multiple-choice prompts (e.g. Claude Code's \`AskUserQuestion\` tool), use them instead of free text so the user can select rather than type.
3. **Propose the TNL inline in the chat reply.** Output the full proposed TNL content as a fenced code block in your chat reply. Do NOT write it to a file yet. Keep it concrete: real paths, named function signatures, edge cases as MUST clauses, explicit non-goals.
4. **Wait for user approval.** Nothing is written to disk — including the TNL file itself — until the user approves. Incorporate any edits the user requests before proceeding.
5. **Save the approved TNL** to \`tnl/<slug>.tnl\` (kebab-case, matching the \`id:\` field). For edits, update the existing file in place.
6. **Implement against the approved TNL.** Every MUST clause must map to specific code or tests. Paths in the machine zone are the scope fence — do not modify files outside \`paths:\` unless the user explicitly agrees.
7. **Self-attest.** List each MUST clause from \`workflow.tnl\` plus the feature TNL(s) touched. For each, state: (a) satisfied — by which file/function/test, (b) could not satisfy — why, or (c) did not apply — why. Exhaustive; silent omission counts as a miss.

### When a new TNL file is justified

Only for:
- A genuinely new behavioral surface (new CLI subcommand, new MCP tool, new subsystem)
- A cross-cutting policy that spans multiple existing TNLs (the model: \`workflow.tnl\`)
- A feature with a clear boundary not already covered by any existing TNL

Any other change — modifying inputs, outputs, semantics, validation, constraints, or identity rules of an existing surface — is an edit to the existing file. Do not create a new TNL to patch an existing one.

### TNL format

\`\`\`
id: <kebab-case-slug>         # matches filename, lowercase, hyphenated
title: <short human-readable>
scope: repo-wide | feature    # repo-wide applies always; feature applies when paths match
owners: [@<handle>]
paths: [<file paths>]         # omit for scope: repo-wide
surfaces: [<CLI cmds, MCP tools, events>]  # optional
dependencies: [<other tnl ids>]            # optional

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
\`\`\`

### RFC 2119 keywords

- **MUST / MUST NOT** — hard requirement. If you cannot satisfy it, flag explicitly.
- **SHOULD / SHOULD NOT** — strong preference. Deviate only with stated reason.
- **MAY** — permission, not requirement.
- **\`[semantic]\`** prefix — clause requires judgment to verify rather than a structural check. Confirm in self-attestation.

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

Run the TNL workflow for the feature described above.

Follow the numbered task flow defined in [\`CLAUDE.md\`](../../CLAUDE.md) (the "TNL — Typed Natural Language" section). Those steps — scope, clarify, propose inline, wait for approval, save, implement, self-attest — are authoritative. This skill does not re-specify them. If \`CLAUDE.md\` is missing the stanza, run \`tnl init --agent claude\` first.

If the MCP TNL server is configured, prefer \`get_impacted_tnls\` during scope and \`propose_tnl_diff\` / \`approve_tnl_diff\` during propose/save.
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
  withSkill?: boolean;
  localInstall?: boolean;
  /** Test injection: override the resolved package root when `localInstall` is set. */
  pkgRoot?: string;
}

interface InstallTemplates {
  hookCommand: string;
  mcpServerEntry: { command: string; args: string[] };
  codexBlock: string;
}

const DEFAULT_TEMPLATES: InstallTemplates = {
  hookCommand: 'npx @tnl/cli hook pre-tool-use',
  mcpServerEntry: {
    command: 'npx',
    args: ['-y', '-p', '@tnl/cli', 'tnl-mcp-server'],
  },
  codexBlock:
    '[mcp_servers.tnl]\ncommand = "npx"\nargs = ["-y", "-p", "@tnl/cli", "tnl-mcp-server"]\n',
};

function findPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return here;
}

function buildLocalTemplates(pkgRoot: string): InstallTemplates {
  const distIndex = join(pkgRoot, 'dist', 'index.js');
  const distMcp = join(pkgRoot, 'dist', 'mcp', 'server.js');
  return {
    hookCommand: `node ${distIndex} hook pre-tool-use`,
    mcpServerEntry: { command: 'node', args: [distMcp] },
    codexBlock: `[mcp_servers.tnl]\ncommand = "node"\nargs = ["${distMcp}"]\n`,
  };
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
  const withSkill = options.withSkill || false;
  const localInstall = options.localInstall || false;

  const created: string[] = [];
  const skipped: string[] = [];
  const suppressed: string[] = [];
  const warnings: string[] = [];

  let templates: InstallTemplates = DEFAULT_TEMPLATES;
  if (localInstall) {
    const pkgRoot = options.pkgRoot ?? findPackageRoot();
    templates = buildLocalTemplates(pkgRoot);
    if (!existsSync(join(pkgRoot, 'dist'))) {
      warnings.push(
        `--local-install: ${join(pkgRoot, 'dist')} does not exist. Run \`npm run build\` in the TNL repo before using the generated configs.`,
      );
    }
  }

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
        agent === 'claude' && withSkill
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
      if (withSkill) {
        const skillDir = join(cwd, '.claude', 'commands');
        const skillPath = join(skillDir, 'tnl-feature.md');
        if (existsSync(skillPath)) {
          skipped.push('.claude/commands/tnl-feature.md');
        } else {
          mkdirSync(skillDir, { recursive: true });
          writeFileSync(skillPath, TNL_FEATURE_SKILL_TEMPLATE, 'utf8');
          created.push('.claude/commands/tnl-feature.md');
        }
      }

      if (noHook) {
        suppressed.push('.claude/settings.json');
      } else {
        installClaudeHook(cwd, created, skipped, warnings, err, templates);
      }

      if (noMcp) {
        suppressed.push('.mcp.json');
      } else {
        installMcpConfig(cwd, created, skipped, warnings, err, templates);
      }
    }

    if (targets.includes('gemini')) {
      if (noMcp) {
        suppressed.push('.gemini/settings.json');
      } else {
        installGeminiMcpConfig(cwd, created, skipped, warnings, err, templates);
      }
    }

    if (targets.includes('codex')) {
      if (noMcp) {
        suppressed.push('.codex/config.toml');
      } else {
        installCodexMcpConfig(cwd, created, skipped, warnings, templates);
      }
    }
  }

  if (noCi || localInstall) {
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

const HOOK_SENTINEL = 'hook pre-tool-use';
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
  templates: InstallTemplates,
): void {
  const mcpPath = join(cwd, '.mcp.json');

  if (!existsSync(mcpPath)) {
    const initial: McpConfigShape = {
      mcpServers: { tnl: templates.mcpServerEntry },
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

  mcpServers.tnl = templates.mcpServerEntry;
  parsed.mcpServers = mcpServers;

  writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  created.push('.mcp.json (tnl added)');
}

const CODEX_SENTINEL = '[mcp_servers.tnl]';

function installCodexMcpConfig(
  cwd: string,
  created: string[],
  skipped: string[],
  warnings: string[],
  templates: InstallTemplates,
): void {
  const codexDir = join(cwd, '.codex');
  const configPath = join(codexDir, 'config.toml');

  let wroteSomething = false;
  if (!existsSync(configPath)) {
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(configPath, templates.codexBlock, 'utf8');
    created.push('.codex/config.toml');
    wroteSomething = true;
  } else {
    const content = readFileSync(configPath, 'utf8');
    if (content.includes(CODEX_SENTINEL)) {
      skipped.push('.codex/config.toml');
    } else {
      const separator = content.endsWith('\n') ? '\n' : '\n\n';
      writeFileSync(
        configPath,
        content + separator + templates.codexBlock,
        'utf8',
      );
      created.push('.codex/config.toml (tnl added)');
      wroteSomething = true;
    }
  }

  if (wroteSomething) {
    warnings.push(
      `Codex project trust: add \`projects."${cwd}".trust_level = "trusted"\` to ~/.codex/config.toml so Codex loads .codex/config.toml.`,
    );
  }
}

function installGeminiMcpConfig(
  cwd: string,
  created: string[],
  skipped: string[],
  warnings: string[],
  err: (s: string) => void,
  templates: InstallTemplates,
): void {
  const geminiDir = join(cwd, '.gemini');
  const settingsPath = join(geminiDir, 'settings.json');

  if (!existsSync(settingsPath)) {
    mkdirSync(geminiDir, { recursive: true });
    const initial: McpConfigShape = {
      mcpServers: { tnl: templates.mcpServerEntry },
    };
    writeFileSync(
      settingsPath,
      JSON.stringify(initial, null, 2) + '\n',
      'utf8',
    );
    created.push('.gemini/settings.json');
    return;
  }

  const content = readFileSync(settingsPath, 'utf8');
  let parsed: McpConfigShape;
  try {
    parsed = JSON.parse(content) as McpConfigShape;
  } catch {
    const msg =
      '.gemini/settings.json is not valid JSON; skipped MCP server registration. Fix the file and re-run `tnl init --agent gemini`.';
    warnings.push(msg);
    err(`tnl init: ${msg}\n`);
    return;
  }

  const mcpServers = parsed.mcpServers ?? {};
  if ('tnl' in mcpServers) {
    skipped.push('.gemini/settings.json');
    return;
  }

  mcpServers.tnl = templates.mcpServerEntry;
  parsed.mcpServers = mcpServers;

  writeFileSync(
    settingsPath,
    JSON.stringify(parsed, null, 2) + '\n',
    'utf8',
  );
  created.push('.gemini/settings.json (tnl added)');
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
  templates: InstallTemplates,
): void {
  const settingsPath = join(cwd, '.claude', 'settings.json');
  const hookEntry = {
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: templates.hookCommand }],
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
  if (content.includes(HOOK_SENTINEL)) {
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
      withSkill: flags.has('--with-skill'),
      localInstall: flags.has('--local-install'),
    });
  },
};

defaultRegistry.set('init', initCommand);
