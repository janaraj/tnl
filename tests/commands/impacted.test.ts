import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImpacted } from '../../src/commands/impacted.js';

const REPO_WIDE_TNL = `id: workflow
title: Workflow
scope: repo-wide
owners: [@jana]

intent:
  Intent.

behaviors:
  - The system MUST work.
`;

const FEATURE_TNL = `id: foo
title: Foo
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - The system MUST work.
`;

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

describe('tnl impacted', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-impacted-cmd-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('prints one id per line and exits 0', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'workflow.tnl'), REPO_WIDE_TNL, 'utf8');
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE_TNL, 'utf8');
    const cap = capture();
    const code = runImpacted(['src/foo.ts'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('workflow\nfoo\n');
  });

  it('exits 2 with a usage message when no paths are provided', () => {
    mkdirSync(join(cwd, 'tnl'));
    const cap = capture();
    const code = runImpacted([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('requires one or more paths');
  });

  it('exits 2 when no tnl/ directory exists', () => {
    const cap = capture();
    const code = runImpacted(['src/foo.ts'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('no tnl/ directory');
    expect(cap.stderr()).toContain('tnl init');
  });

  it('exits 2 when a .tnl file is malformed', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), 'not a valid tnl', 'utf8');
    const cap = capture();
    const code = runImpacted(['src/foo.ts'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('tnl impacted:');
  });

  it('exits 0 with empty stdout when no TNL matches', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE_TNL, 'utf8');
    const cap = capture();
    const code = runImpacted(['src/unrelated.ts'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('');
  });

  it('prints only repo-wide when query matches no feature TNL', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'workflow.tnl'), REPO_WIDE_TNL, 'utf8');
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE_TNL, 'utf8');
    const cap = capture();
    const code = runImpacted(['src/unrelated.ts'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('workflow\n');
  });

  it('accepts multiple path arguments', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE_TNL, 'utf8');
    const barTnl = FEATURE_TNL.replace('id: foo', 'id: bar')
      .replace('title: Foo', 'title: Bar')
      .replace('paths: [src/foo.ts]', 'paths: [src/bar.ts]');
    writeFileSync(join(cwd, 'tnl', 'bar.tnl'), barTnl, 'utf8');
    const cap = capture();
    const code = runImpacted(['src/foo.ts', 'src/bar.ts'], {
      cwd,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('bar\nfoo\n');
  });
});
