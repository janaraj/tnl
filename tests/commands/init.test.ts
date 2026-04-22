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
import { runInit, WORKFLOW_TEMPLATE } from '../../src/commands/init.js';
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

  it('emits a manual-MCP-registration warning for codex/gemini targets', () => {
    const cap = capture();
    runInit({ cwd, agent: 'codex', ...cap.opts });
    expect(cap.stdout()).toContain('MCP server registration');
    expect(cap.stdout()).toContain('codex/gemini');

    const cwd2 = mkdtempSync(join(tmpdir(), 'tnl-init-gemini-'));
    try {
      const cap2 = capture();
      runInit({ cwd: cwd2, agent: 'gemini', ...cap2.opts });
      expect(cap2.stdout()).toContain('MCP server registration');
    } finally {
      rmSync(cwd2, { recursive: true, force: true });
    }
  });

  it('Claude + Codex mixed target writes .mcp.json AND emits the codex warning', () => {
    mkdirSync(join(cwd, '.claude'));
    writeFileSync(join(cwd, 'AGENTS.md'), '# agents\n', 'utf8');
    const cap = capture();
    runInit({ cwd, ...cap.opts });
    expect(existsSync(join(cwd, '.mcp.json'))).toBe(true);
    expect(cap.stdout()).toContain('MCP server registration');
    expect(cap.stdout()).toContain('codex/gemini');
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
});
