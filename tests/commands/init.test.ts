import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runInit,
  STANZA_TEMPLATE,
  TNL_FEATURE_SKILL_TEMPLATE,
  WORKFLOW_TEMPLATE,
} from '../../src/commands/init.js';
import { parseTnl, parseTnlFile } from '../../src/parser.js';

function capture(): {
  opts: { stdout: (s: string) => void; stderr: (s: string) => void };
  stdout: () => string;
  stderr: () => string;
} {
  let stdout = '';
  let stderr = '';
  return {
    opts: {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('tnl init', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-init-test-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('scaffolds tnl/ and workflow.tnl in a clean dir (no agent)', () => {
    const cap = capture();
    const code = runInit({ cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'tnl'))).toBe(true);
    expect(existsSync(join(cwd, 'tnl', 'workflow.tnl'))).toBe(true);
    const workflow = readFileSync(join(cwd, 'tnl', 'workflow.tnl'), 'utf8');
    expect(workflow).toContain('id: workflow');
    expect(workflow).toContain('owners: [@TODO]');
  });

  it('is idempotent: second run writes nothing new', () => {
    runInit({ cwd, stdout: () => {}, stderr: () => {} });
    const before = readFileSync(join(cwd, 'tnl', 'workflow.tnl'), 'utf8');
    const cap = capture();
    const code = runInit({ cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(readFileSync(join(cwd, 'tnl', 'workflow.tnl'), 'utf8')).toBe(before);
    expect(cap.stdout()).toContain('Skipped');
    expect(cap.stdout()).toContain('tnl/workflow.tnl');
  });

  it('exits 2 on unknown --agent value and makes no filesystem changes', () => {
    const cap = capture();
    const code = runInit({ cwd, agent: 'cursor', ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain("unknown --agent value 'cursor'");
    expect(cap.stderr()).toContain('claude');
    expect(cap.stderr()).toContain('codex');
    expect(cap.stderr()).toContain('gemini');
    expect(existsSync(join(cwd, 'tnl'))).toBe(false);
  });

  it('warns but still scaffolds when no detection and no flag', () => {
    const cap = capture();
    const code = runInit({ cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, 'tnl', 'workflow.tnl'))).toBe(true);
    expect(cap.stdout()).toContain('Warnings');
    expect(cap.stdout()).toContain('tnl init --agent');
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(cwd, 'GEMINI.md'))).toBe(false);
  });

  it('detects .claude/ and writes CLAUDE.md stanza', () => {
    mkdirSync(join(cwd, '.claude'));
    const cap = capture();
    const code = runInit({ cwd, ...cap.opts });
    expect(code).toBe(0);
    const claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('<!-- tnl:workflow-stanza -->');
    expect(claudeMd).toContain('TNL — Typed Natural Language');
  });

  it('appends stanza to existing AGENTS.md without destroying content', () => {
    const existing = '# My Project\n\nSome project content.\n';
    writeFileSync(join(cwd, 'AGENTS.md'), existing, 'utf8');
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith(existing)).toBe(true);
    expect(agents).toContain('<!-- tnl:workflow-stanza -->');
  });

  it('detects GEMINI.md and appends stanza', () => {
    writeFileSync(join(cwd, 'GEMINI.md'), '# gemini project\n', 'utf8');
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    const gemini = readFileSync(join(cwd, 'GEMINI.md'), 'utf8');
    expect(gemini).toContain('<!-- tnl:workflow-stanza -->');
    expect(gemini.startsWith('# gemini project\n')).toBe(true);
  });

  it('configures every detected agent when multiple markers exist', () => {
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, 'AGENTS.md'), '# agents\n', 'utf8');
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toContain(
      '<!-- tnl:workflow-stanza -->',
    );
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toContain(
      '<!-- tnl:workflow-stanza -->',
    );
  });

  it('--agent flag overrides detection: writes only the specified agent', () => {
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, 'AGENTS.md'), '# agents\n', 'utf8');
    const cap = capture();
    runInit({ cwd, agent: 'gemini', ...cap.opts });
    expect(existsSync(join(cwd, 'GEMINI.md'))).toBe(true);
    expect(readFileSync(join(cwd, 'GEMINI.md'), 'utf8')).toContain(
      '<!-- tnl:workflow-stanza -->',
    );
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('# agents\n');
  });

  it('does not create tnl/.resolved/ in A1', () => {
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    expect(existsSync(join(cwd, 'tnl', '.resolved'))).toBe(false);
  });

  it('skips instruction file on second run via sentinel detection', () => {
    mkdirSync(join(cwd, '.claude'));
    runInit({ cwd, stdout: () => {}, stderr: () => {} });
    const first = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    const second = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(second).toBe(first);
    expect(cap.stdout()).toContain('Skipped');
    expect(cap.stdout()).toContain('CLAUDE.md');
  });

  it('writes .claude/commands/tnl-feature.md when --agent claude on an empty cwd', () => {
    const cap = capture();
    const code = runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(code).toBe(0);
    const skillPath = join(cwd, '.claude', 'commands', 'tnl-feature.md');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf8');
    expect(content).toContain('description:');
    expect(content).toContain('$ARGUMENTS');
    expect(content).toContain('Self-attest');
  });

  it('auto-creates .claude/commands/ directory when installing the skill', () => {
    expect(existsSync(join(cwd, '.claude'))).toBe(false);
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.claude', 'commands'))).toBe(true);
  });

  it('skips the skill and reports it when the file already exists', () => {
    mkdirSync(join(cwd, '.claude', 'commands'), { recursive: true });
    const existing = '# custom skill\n';
    writeFileSync(
      join(cwd, '.claude', 'commands', 'tnl-feature.md'),
      existing,
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(
      readFileSync(
        join(cwd, '.claude', 'commands', 'tnl-feature.md'),
        'utf8',
      ),
    ).toBe(existing);
    expect(cap.stdout()).toContain('Skipped');
    expect(cap.stdout()).toContain('.claude/commands/tnl-feature.md');
  });

  it('does NOT install the skill when --agent codex', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(false);
  });

  it('does NOT install the skill when --agent gemini', () => {
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(false);
  });

  it('Claude stanza references /tnl-feature; codex and gemini stanzas do not', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toContain(
      '/tnl-feature',
    );

    const cwd2 = mkdtempSync(join(tmpdir(), 'tnl-init-codex-'));
    try {
      runInit({ cwd: cwd2, agent: 'codex', stdout: () => {}, stderr: () => {} });
      expect(readFileSync(join(cwd2, 'AGENTS.md'), 'utf8')).not.toContain(
        '/tnl-feature',
      );
    } finally {
      rmSync(cwd2, { recursive: true, force: true });
    }

    const cwd3 = mkdtempSync(join(tmpdir(), 'tnl-init-gemini-'));
    try {
      runInit({
        cwd: cwd3,
        agent: 'gemini',
        stdout: () => {},
        stderr: () => {},
      });
      expect(readFileSync(join(cwd3, 'GEMINI.md'), 'utf8')).not.toContain(
        '/tnl-feature',
      );
    } finally {
      rmSync(cwd3, { recursive: true, force: true });
    }
  });

  it('summary lists the skill path on first run', () => {
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(cap.stdout()).toContain('.claude/commands/tnl-feature.md');
  });

  it('writes .claude/settings.json with the PreToolUse hook entry when absent', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    const path = join(cwd, '.claude', 'settings.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(parsed.hooks.PreToolUse[0].matcher).toContain('Edit');
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain(
      '@tnl/cli hook pre-tool-use',
    );
  });

  it('preserves existing top-level settings fields when merging', () => {
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ model: 'sonnet', nested: { a: 1 } }),
      'utf8',
    );
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    const parsed = JSON.parse(
      readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'),
    );
    expect(parsed.model).toBe('sonnet');
    expect(parsed.nested.a).toBe(1);
    expect(parsed.hooks.PreToolUse).toBeDefined();
  });

  it('is idempotent: second run with the hook entry present skips', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    const first = readFileSync(
      join(cwd, '.claude', 'settings.json'),
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    const second = readFileSync(
      join(cwd, '.claude', 'settings.json'),
      'utf8',
    );
    expect(second).toBe(first);
    expect(cap.stdout()).toContain('.claude/settings.json');
  });

  it('warns (stderr + summary) and skips when existing settings.json is malformed JSON', () => {
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      'not valid json',
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(
      readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'),
    ).toBe('not valid json');
    expect(cap.stdout()).toContain('Warnings');
    expect(cap.stdout()).toContain('settings.json');
    expect(cap.stderr()).toContain('settings.json');
  });

  it('does NOT register the hook when --agent codex', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);
  });

  it('does NOT register the hook when --agent gemini', () => {
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);
  });

  it('WORKFLOW_TEMPLATE behaviors match tnl/workflow.tnl (drift guard)', () => {
    const embedded = parseTnl(WORKFLOW_TEMPLATE);
    const repo = parseTnlFile('tnl/workflow.tnl');
    expect(embedded.behaviors.map((c) => c.text)).toEqual(
      repo.behaviors.map((c) => c.text),
    );
  });

  it('writes .mcp.json with the tnl server entry when --agent claude on empty cwd', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    const path = join(cwd, '.mcp.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.tnl).toEqual({
      command: 'npx',
      args: ['-y', '@tnl/mcp-server'],
    });
  });

  it('preserves existing top-level fields and other mcpServers entries when merging .mcp.json', () => {
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({
        someOtherField: { nested: 1 },
        mcpServers: {
          other: { command: 'node', args: ['foo.js'] },
        },
      }),
      'utf8',
    );
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    const parsed = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    expect(parsed.someOtherField.nested).toBe(1);
    expect(parsed.mcpServers.other).toEqual({
      command: 'node',
      args: ['foo.js'],
    });
    expect(parsed.mcpServers.tnl).toBeDefined();
  });

  it('is idempotent when mcpServers.tnl already exists (any shape)', () => {
    writeFileSync(
      join(cwd, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          tnl: { command: 'custom-command', args: ['--user-override'] },
        },
      }),
      'utf8',
    );
    const before = readFileSync(join(cwd, '.mcp.json'), 'utf8');
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    const after = readFileSync(join(cwd, '.mcp.json'), 'utf8');
    expect(after).toBe(before);
    expect(cap.stdout()).toContain('.mcp.json');
  });

  it('warns (stderr + summary) and skips when .mcp.json is malformed JSON', () => {
    writeFileSync(join(cwd, '.mcp.json'), 'not valid json', 'utf8');
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(readFileSync(join(cwd, '.mcp.json'), 'utf8')).toBe('not valid json');
    expect(cap.stdout()).toContain('Warnings');
    expect(cap.stdout()).toContain('.mcp.json');
    expect(cap.stderr()).toContain('.mcp.json');
  });

  it('does NOT create .mcp.json for --agent codex alone', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
  });

  it('does NOT create .mcp.json for --agent gemini alone', () => {
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
  });

  it('Claude + Codex mixed target writes both .mcp.json and .codex/config.toml', () => {
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, 'AGENTS.md'), '# agents\n', 'utf8');
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(true);
    expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(true);
    // A7's "not automated" warning no longer fires — Codex is automated now
    expect(cap.stdout()).not.toContain(
      'MCP server registration for codex is not automated',
    );
    // Codex trust-flag hint fires for the Codex write
    expect(cap.stdout()).toContain('Codex project trust');
  });

  it('writes .github/workflows/tnl-verify.yml with expected content on an empty cwd', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    const path = join(cwd, '.github', 'workflows', 'tnl-verify.yml');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('npx -y @tnl/cli verify');
    expect(content).toContain('push:');
    expect(content).toContain('pull_request:');
  });

  it('auto-creates .github/workflows/ when installing the CI workflow', () => {
    expect(existsSync(join(cwd, '.github'))).toBe(false);
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.github', 'workflows'))).toBe(true);
  });

  it('skips and reports an existing CI workflow file', () => {
    mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
    const existing = '# user-customized workflow\n';
    writeFileSync(
      join(cwd, '.github', 'workflows', 'tnl-verify.yml'),
      existing,
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(
      readFileSync(
        join(cwd, '.github', 'workflows', 'tnl-verify.yml'),
        'utf8',
      ),
    ).toBe(existing);
    expect(cap.stdout()).toContain('Skipped');
    expect(cap.stdout()).toContain('.github/workflows/tnl-verify.yml');
  });

  it('summary lists the CI workflow path on first run', () => {
    const cap = capture();
    runInit({ cwd, agent: 'claude', ...cap.opts });
    expect(cap.stdout()).toContain('.github/workflows/tnl-verify.yml');
  });

  it('writes the CI workflow regardless of target agent (codex)', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    expect(
      existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml')),
    ).toBe(true);
  });

  it('writes the CI workflow even when no agent is detected', () => {
    runInit({ cwd, stdout: () => {}, stderr: () => {} });
    expect(
      existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml')),
    ).toBe(true);
  });

  it('--minimal suppresses CI, MCP, hook, and skill installs', () => {
    const cap = capture();
    runInit({ cwd, agent: 'claude', minimal: true, ...cap.opts });
    expect(existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml'))).toBe(
      false,
    );
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(false);
    // Baseline artifacts still written
    expect(existsSync(join(cwd, 'tnl', 'workflow.tnl'))).toBe(true);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    // Summary lists them under opt-out
    expect(cap.stdout()).toContain('Skipped (opt-out):');
    expect(cap.stdout()).toContain('.github/workflows/tnl-verify.yml');
    expect(cap.stdout()).toContain('.mcp.json');
    expect(cap.stdout()).toContain('.claude/settings.json');
    expect(cap.stdout()).toContain('.claude/commands/tnl-feature.md');
  });

  it('--no-ci suppresses only the CI workflow', () => {
    runInit({ cwd, agent: 'claude', noCi: true, stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml'))).toBe(
      false,
    );
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(true);
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(true);
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(true);
  });

  it('--no-mcp suppresses only .mcp.json', () => {
    runInit({ cwd, agent: 'claude', noMcp: true, stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
    expect(existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml'))).toBe(
      true,
    );
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(true);
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(true);
  });

  it('--no-hook suppresses only the .claude/settings.json hook entry', () => {
    runInit({ cwd, agent: 'claude', noHook: true, stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml'))).toBe(
      true,
    );
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(true);
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(true);
  });

  it('--no-skill suppresses only the slash command file', () => {
    runInit({ cwd, agent: 'claude', noSkill: true, stdout: () => {}, stderr: () => {} });
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(false);
    expect(existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml'))).toBe(
      true,
    );
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(true);
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(true);
  });

  it('--minimal combined with individual --no-* flags is a union (all suppressions still apply)', () => {
    runInit({
      cwd,
      agent: 'claude',
      minimal: true,
      noHook: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml'))).toBe(
      false,
    );
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(false);
    expect(existsSync(join(cwd, '.claude', 'settings.json'))).toBe(false);
    expect(
      existsSync(join(cwd, '.claude', 'commands', 'tnl-feature.md')),
    ).toBe(false);
  });

  it('tnl/, workflow.tnl, and CLAUDE.md stanza are always written regardless of flags', () => {
    runInit({
      cwd,
      agent: 'claude',
      minimal: true,
      stdout: () => {},
      stderr: () => {},
    });
    expect(existsSync(join(cwd, 'tnl', 'workflow.tnl'))).toBe(true);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(true);
    const claudeMd = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('<!-- tnl:workflow-stanza -->');
  });

  it('writes .gemini/settings.json with the tnl server entry when --agent gemini on empty cwd', () => {
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    const path = join(cwd, '.gemini', 'settings.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers.tnl).toEqual({
      command: 'npx',
      args: ['-y', '@tnl/mcp-server'],
    });
  });

  it('auto-creates .gemini/ directory when installing the Gemini MCP config', () => {
    expect(existsSync(join(cwd, '.gemini'))).toBe(false);
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.gemini'))).toBe(true);
  });

  it('preserves existing top-level fields and other mcpServers entries when merging .gemini/settings.json', () => {
    mkdirSync(join(cwd, '.gemini'));
    writeFileSync(
      join(cwd, '.gemini', 'settings.json'),
      JSON.stringify({
        model: 'gemini-pro',
        mcpServers: {
          other: { command: 'node', args: ['foo.js'] },
        },
      }),
      'utf8',
    );
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    const parsed = JSON.parse(
      readFileSync(join(cwd, '.gemini', 'settings.json'), 'utf8'),
    );
    expect(parsed.model).toBe('gemini-pro');
    expect(parsed.mcpServers.other).toEqual({
      command: 'node',
      args: ['foo.js'],
    });
    expect(parsed.mcpServers.tnl).toBeDefined();
  });

  it('is idempotent when mcpServers.tnl already exists in .gemini/settings.json', () => {
    mkdirSync(join(cwd, '.gemini'));
    writeFileSync(
      join(cwd, '.gemini', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          tnl: { command: 'custom-command', args: ['--user-override'] },
        },
      }),
      'utf8',
    );
    const before = readFileSync(
      join(cwd, '.gemini', 'settings.json'),
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'gemini', ...cap.opts });
    const after = readFileSync(
      join(cwd, '.gemini', 'settings.json'),
      'utf8',
    );
    expect(after).toBe(before);
    expect(cap.stdout()).toContain('.gemini/settings.json');
  });

  it('warns (stderr + summary) and skips when .gemini/settings.json is malformed JSON', () => {
    mkdirSync(join(cwd, '.gemini'));
    writeFileSync(
      join(cwd, '.gemini', 'settings.json'),
      'not valid json',
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'gemini', ...cap.opts });
    expect(
      readFileSync(join(cwd, '.gemini', 'settings.json'), 'utf8'),
    ).toBe('not valid json');
    expect(cap.stdout()).toContain('Warnings');
    expect(cap.stdout()).toContain('.gemini/settings.json');
    expect(cap.stderr()).toContain('.gemini/settings.json');
  });

  it('does NOT create .gemini/settings.json for --agent claude alone', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.gemini', 'settings.json'))).toBe(false);
  });

  it('does NOT create .gemini/settings.json for --agent codex alone', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.gemini', 'settings.json'))).toBe(false);
  });

  it('--no-mcp suppresses .gemini/settings.json for gemini targets', () => {
    const cap = capture();
    runInit({ cwd, agent: 'gemini', noMcp: true, ...cap.opts });
    expect(existsSync(join(cwd, '.gemini', 'settings.json'))).toBe(false);
    expect(cap.stdout()).toContain('Skipped (opt-out)');
    expect(cap.stdout()).toContain('.gemini/settings.json');
  });

  it('--minimal suppresses .gemini/settings.json for gemini targets', () => {
    const cap = capture();
    runInit({ cwd, agent: 'gemini', minimal: true, ...cap.opts });
    expect(existsSync(join(cwd, '.gemini', 'settings.json'))).toBe(false);
    expect(cap.stdout()).toContain('Skipped (opt-out)');
    expect(cap.stdout()).toContain('.gemini/settings.json');
  });

  it('no manual-MCP warning fires when --agent gemini alone (now automated)', () => {
    const cap = capture();
    runInit({ cwd, agent: 'gemini', ...cap.opts });
    expect(cap.stdout()).not.toContain('MCP server registration for');
  });

  it('writes .codex/config.toml with the [mcp_servers.tnl] block when --agent codex on empty cwd', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    const path = join(cwd, '.codex', 'config.toml');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toBe(
      '[mcp_servers.tnl]\ncommand = "npx"\nargs = ["-y", "@tnl/mcp-server"]\n',
    );
  });

  it('auto-creates .codex/ directory when installing the Codex MCP config', () => {
    expect(existsSync(join(cwd, '.codex'))).toBe(false);
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.codex'))).toBe(true);
  });

  it('preserves unrelated TOML sections when appending the tnl block', () => {
    mkdirSync(join(cwd, '.codex'));
    const existing = '# user config\n[profile]\nmodel = "gpt-5"\n';
    writeFileSync(join(cwd, '.codex', 'config.toml'), existing, 'utf8');
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    const content = readFileSync(
      join(cwd, '.codex', 'config.toml'),
      'utf8',
    );
    expect(content.startsWith(existing)).toBe(true);
    expect(content).toContain('[mcp_servers.tnl]');
  });

  it('is idempotent: second run leaves .codex/config.toml byte-identical', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    const before = readFileSync(
      join(cwd, '.codex', 'config.toml'),
      'utf8',
    );
    const cap = capture();
    runInit({ cwd, agent: 'codex', ...cap.opts });
    const after = readFileSync(
      join(cwd, '.codex', 'config.toml'),
      'utf8',
    );
    expect(after).toBe(before);
    expect(cap.stdout()).toContain('.codex/config.toml');
  });

  it('does NOT create .codex/config.toml for --agent claude alone', () => {
    runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(false);
  });

  it('does NOT create .codex/config.toml for --agent gemini alone', () => {
    runInit({ cwd, agent: 'gemini', stdout: () => {}, stderr: () => {} });
    expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(false);
  });

  it('--no-mcp suppresses .codex/config.toml for codex targets', () => {
    const cap = capture();
    runInit({ cwd, agent: 'codex', noMcp: true, ...cap.opts });
    expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(false);
    expect(cap.stdout()).toContain('Skipped (opt-out)');
    expect(cap.stdout()).toContain('.codex/config.toml');
  });

  it('--minimal suppresses .codex/config.toml for codex targets', () => {
    const cap = capture();
    runInit({ cwd, agent: 'codex', minimal: true, ...cap.opts });
    expect(existsSync(join(cwd, '.codex', 'config.toml'))).toBe(false);
  });

  it('trust-flag hint fires on first Codex write and includes the cwd absolute path', () => {
    const cap = capture();
    runInit({ cwd, agent: 'codex', ...cap.opts });
    expect(cap.stdout()).toContain('Codex project trust');
    expect(cap.stdout()).toContain(`projects."${cwd}".trust_level = "trusted"`);
  });

  it('trust-flag hint does NOT fire on a skip-as-already-present run', () => {
    runInit({ cwd, agent: 'codex', stdout: () => {}, stderr: () => {} });
    const cap = capture();
    runInit({ cwd, agent: 'codex', ...cap.opts });
    expect(cap.stdout()).not.toContain('Codex project trust');
  });

  it('A7 "MCP server registration for codex is not automated" warning no longer fires', () => {
    const cap = capture();
    runInit({ cwd, agent: 'codex', ...cap.opts });
    expect(cap.stdout()).not.toContain(
      'MCP server registration for codex is not automated',
    );
  });

  describe('--local-install', () => {
    it('writes absolute node paths in .mcp.json (Claude)', () => {
      runInit({
        cwd,
        agent: 'claude',
        localInstall: true,
        stdout: () => {},
        stderr: () => {},
      });
      const parsed = JSON.parse(
        readFileSync(join(cwd, '.mcp.json'), 'utf8'),
      );
      expect(parsed.mcpServers.tnl.command).toBe('node');
      expect(parsed.mcpServers.tnl.args[0]).toMatch(/\/dist\/mcp\/server\.js$/);
      expect(parsed.mcpServers.tnl.args[0]).not.toContain('npx');
    });

    it('writes absolute node paths in .gemini/settings.json', () => {
      runInit({
        cwd,
        agent: 'gemini',
        localInstall: true,
        stdout: () => {},
        stderr: () => {},
      });
      const parsed = JSON.parse(
        readFileSync(join(cwd, '.gemini', 'settings.json'), 'utf8'),
      );
      expect(parsed.mcpServers.tnl.command).toBe('node');
      expect(parsed.mcpServers.tnl.args[0]).toMatch(/\/dist\/mcp\/server\.js$/);
    });

    it('writes node + absolute path in .codex/config.toml', () => {
      runInit({
        cwd,
        agent: 'codex',
        localInstall: true,
        stdout: () => {},
        stderr: () => {},
      });
      const content = readFileSync(
        join(cwd, '.codex', 'config.toml'),
        'utf8',
      );
      expect(content).toContain('command = "node"');
      expect(content).toMatch(/args = \["[^"]+\/dist\/mcp\/server\.js"\]/);
      expect(content).not.toContain('npx');
    });

    it('writes absolute node command in .claude/settings.json hook', () => {
      runInit({
        cwd,
        agent: 'claude',
        localInstall: true,
        stdout: () => {},
        stderr: () => {},
      });
      const parsed = JSON.parse(
        readFileSync(join(cwd, '.claude', 'settings.json'), 'utf8'),
      );
      const cmd = parsed.hooks.PreToolUse[0].hooks[0].command;
      expect(cmd).toMatch(/^node .*\/dist\/index\.js hook pre-tool-use$/);
      expect(cmd).not.toContain('npx');
    });

    it('suppresses the CI workflow under --local-install', () => {
      const cap = capture();
      runInit({
        cwd,
        agent: 'claude',
        localInstall: true,
        ...cap.opts,
      });
      expect(
        existsSync(join(cwd, '.github', 'workflows', 'tnl-verify.yml')),
      ).toBe(false);
      expect(cap.stdout()).toContain('Skipped (opt-out)');
      expect(cap.stdout()).toContain('.github/workflows/tnl-verify.yml');
    });

    it('warns when the resolved pkgRoot dist/ does not exist', () => {
      const fakePkg = mkdtempSync(join(tmpdir(), 'tnl-init-fakepkg-'));
      try {
        writeFileSync(
          join(fakePkg, 'package.json'),
          '{"name":"fake"}',
          'utf8',
        );
        // No dist/ inside fakePkg
        const cap = capture();
        runInit({
          cwd,
          agent: 'claude',
          localInstall: true,
          pkgRoot: fakePkg,
          ...cap.opts,
        });
        expect(cap.stdout()).toContain('Warnings');
        expect(cap.stdout()).toContain('npm run build');
        expect(cap.stdout()).toContain(join(fakePkg, 'dist'));
      } finally {
        rmSync(fakePkg, { recursive: true, force: true });
      }
    });

    it('proceeds with absolute paths even when dist/ is absent', () => {
      const fakePkg = mkdtempSync(join(tmpdir(), 'tnl-init-fakepkg-'));
      try {
        writeFileSync(
          join(fakePkg, 'package.json'),
          '{"name":"fake"}',
          'utf8',
        );
        runInit({
          cwd,
          agent: 'claude',
          localInstall: true,
          pkgRoot: fakePkg,
          stdout: () => {},
          stderr: () => {},
        });
        const parsed = JSON.parse(
          readFileSync(join(cwd, '.mcp.json'), 'utf8'),
        );
        expect(parsed.mcpServers.tnl.args[0]).toBe(
          join(fakePkg, 'dist', 'mcp', 'server.js'),
        );
      } finally {
        rmSync(fakePkg, { recursive: true, force: true });
      }
    });

    it('idempotent: second run with local-install form skips via hook sentinel', () => {
      runInit({
        cwd,
        agent: 'claude',
        localInstall: true,
        stdout: () => {},
        stderr: () => {},
      });
      const before = readFileSync(
        join(cwd, '.claude', 'settings.json'),
        'utf8',
      );
      const cap = capture();
      runInit({
        cwd,
        agent: 'claude',
        localInstall: true,
        ...cap.opts,
      });
      const after = readFileSync(
        join(cwd, '.claude', 'settings.json'),
        'utf8',
      );
      expect(after).toBe(before);
      expect(cap.stdout()).toContain('Skipped');
    });

    it('idempotent: default-form existing hook is recognized by local-install sentinel too', () => {
      // First run without --local-install
      runInit({ cwd, agent: 'claude', stdout: () => {}, stderr: () => {} });
      const before = readFileSync(
        join(cwd, '.claude', 'settings.json'),
        'utf8',
      );
      // Second run with --local-install — sentinel matches, skip
      const cap = capture();
      runInit({
        cwd,
        agent: 'claude',
        localInstall: true,
        ...cap.opts,
      });
      const after = readFileSync(
        join(cwd, '.claude', 'settings.json'),
        'utf8',
      );
      expect(after).toBe(before);
      expect(cap.stdout()).toContain('Skipped');
    });
  });

  describe('stanza content — approval order and schema', () => {
    it('STANZA_TEMPLATE contains anti-file-write phrasing in propose step', () => {
      expect(STANZA_TEMPLATE).toContain('inline in the chat reply');
    });

    it('STANZA_TEMPLATE has a distinct Save step numbered after the Wait step', () => {
      const waitIdx = STANZA_TEMPLATE.indexOf('Wait for user approval');
      const saveIdx = STANZA_TEMPLATE.indexOf('Save the approved TNL');
      expect(waitIdx).toBeGreaterThan(-1);
      expect(saveIdx).toBeGreaterThan(waitIdx);
      expect(STANZA_TEMPLATE).toContain('`tnl/<slug>.tnl`');
    });

    it('STANZA_TEMPLATE does NOT use "before writing code" as approval gate', () => {
      expect(STANZA_TEMPLATE).not.toContain('before writing code');
    });

    it('STANZA_TEMPLATE contains a TNL-format fenced schema block with required field labels', () => {
      expect(STANZA_TEMPLATE).toContain('### TNL format');
      expect(STANZA_TEMPLATE).toContain('id:');
      expect(STANZA_TEMPLATE).toContain('behaviors:');
      expect(STANZA_TEMPLATE).toContain('non-goals:');
      expect(STANZA_TEMPLATE).toContain('rationale:');
      const fenceCount = (STANZA_TEMPLATE.match(/```/g) ?? []).length;
      expect(fenceCount).toBeGreaterThanOrEqual(2);
    });

    it('STANZA_TEMPLATE defines MUST, SHOULD, MAY, and [semantic]', () => {
      expect(STANZA_TEMPLATE).toContain('MUST');
      expect(STANZA_TEMPLATE).toContain('SHOULD');
      expect(STANZA_TEMPLATE).toContain('MAY');
      expect(STANZA_TEMPLATE).toContain('[semantic]');
      expect(STANZA_TEMPLATE).toContain('### RFC 2119 keywords');
    });

    it('STANZA_TEMPLATE contains edit-vs-new guidance', () => {
      expect(STANZA_TEMPLATE).toContain('When a new TNL file is justified');
    });

    it('AGENTS.md carries the identical schema block after --agent codex', () => {
      const cap = capture();
      runInit({ cwd, agent: 'codex', ...cap.opts });
      const agentsMd = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
      expect(agentsMd).toContain('### TNL format');
      expect(agentsMd).toContain('### RFC 2119 keywords');
      expect(agentsMd).toContain('When a new TNL file is justified');
      expect(agentsMd).toContain('inline in the chat reply');
      expect(agentsMd).not.toContain('before writing code');
    });

    it('GEMINI.md carries the identical schema block after --agent gemini', () => {
      const cap = capture();
      runInit({ cwd, agent: 'gemini', ...cap.opts });
      const geminiMd = readFileSync(join(cwd, 'GEMINI.md'), 'utf8');
      expect(geminiMd).toContain('### TNL format');
      expect(geminiMd).toContain('### RFC 2119 keywords');
      expect(geminiMd).toContain('When a new TNL file is justified');
      expect(geminiMd).toContain('inline in the chat reply');
      expect(geminiMd).not.toContain('before writing code');
    });

    it('TNL_FEATURE_SKILL_TEMPLATE contains anti-file-write phrasing in propose section', () => {
      expect(TNL_FEATURE_SKILL_TEMPLATE).toContain('inline in the chat reply');
    });

    it('TNL_FEATURE_SKILL_TEMPLATE has a ## 5 Save heading after ## 4 Wait', () => {
      const waitIdx = TNL_FEATURE_SKILL_TEMPLATE.indexOf('## 4. Wait');
      const saveIdx = TNL_FEATURE_SKILL_TEMPLATE.indexOf('## 5. Save');
      expect(waitIdx).toBeGreaterThan(-1);
      expect(saveIdx).toBeGreaterThan(waitIdx);
      expect(TNL_FEATURE_SKILL_TEMPLATE).toContain('`tnl/<slug>.tnl`');
    });

    it('TNL_FEATURE_SKILL_TEMPLATE does NOT contain "before writing code"', () => {
      expect(TNL_FEATURE_SKILL_TEMPLATE).not.toContain('before writing code');
    });
  });
});
