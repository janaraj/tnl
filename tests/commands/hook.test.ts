import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../../src/commands/hook.js';

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

function featureTnl(id: string, paths: string[]): string {
  return `id: ${id}
title: ${id}
scope: feature
owners: [@jana]
paths: [${paths.join(', ')}]

intent:
  Intent.

behaviors:
  - The system MUST work.
`;
}

const REPO_WIDE_TNL = `id: workflow
title: Workflow
scope: repo-wide
owners: [@jana]

intent:
  Intent.

behaviors:
  - The agent MUST follow rules.
`;

describe('tnl hook pre-tool-use', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-hook-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty stdout on empty stdin', async () => {
    const cap = capture();
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: '',
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('returns empty stdout on malformed JSON', async () => {
    const cap = capture();
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: 'not json',
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('returns empty stdout when tool_name is unsupported', async () => {
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'echo' },
    });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('returns empty stdout when file_path is missing', async () => {
    const cap = capture();
    const input = JSON.stringify({ tool_name: 'Edit', tool_input: {} });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('returns empty stdout when no feature TNL impacts the path', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      featureTnl('foo', ['src/foo.ts']),
      'utf8',
    );
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/unrelated.ts') },
    });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('emits additionalContext JSON when a feature TNL impacts the edit', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      featureTnl('foo', ['src/foo.ts']),
      'utf8',
    );
    writeFileSync(join(cwd, 'src', 'foo.ts'), '', 'utf8');
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/foo.ts') },
    });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'TNL contracts apply',
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      '--- foo (feature)',
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain('id: foo');
  });

  it('excludes repo-wide TNLs from additionalContext', async () => {
    writeFileSync(join(cwd, 'tnl', 'workflow.tnl'), REPO_WIDE_TNL, 'utf8');
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      featureTnl('foo', ['src/foo.ts']),
      'utf8',
    );
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/foo.ts') },
    });
    await runHook(['pre-tool-use'], { cwd, stdin: input, ...cap.opts });
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      '--- workflow',
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain('--- foo');
  });

  it('returns empty stdout when only a repo-wide TNL would match', async () => {
    writeFileSync(join(cwd, 'tnl', 'workflow.tnl'), REPO_WIDE_TNL, 'utf8');
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/any.ts') },
    });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('strips cwd prefix from absolute file_path', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      featureTnl('foo', ['src/foo.ts']),
      'utf8',
    );
    writeFileSync(join(cwd, 'src', 'foo.ts'), '', 'utf8');
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src', 'foo.ts') },
    });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.hookSpecificOutput.additionalContext).toContain('--- foo');
  });

  it('returns empty stdout when getImpactedTnls throws (malformed .tnl)', async () => {
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), 'not a valid tnl\n', 'utf8');
    const cap = capture();
    const input = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(cwd, 'src/foo.ts') },
    });
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: input,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('unknown sub-subcommand exits 0 silently', async () => {
    const cap = capture();
    const code = await runHook(['post-tool-use'], {
      cwd,
      stdin: 'anything',
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('accepts stdin via the options parameter for testing', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      featureTnl('foo', ['src/foo.ts']),
      'utf8',
    );
    const cap = capture();
    const code = await runHook(['pre-tool-use'], {
      cwd,
      stdin: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: join(cwd, 'src/foo.ts') },
      }),
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).not.toBe('');
  });
});
