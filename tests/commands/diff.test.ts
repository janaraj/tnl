import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiff } from '../../src/commands/diff.js';
import { defaultRegistry } from '../../src/cli.js';

const FOO_ORIGINAL = `id: foo
title: Foo
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Original intent.

behaviors:
  - The system MUST do X.
  - The system MUST do Y.

non-goals:
  - Goal A.

rationale:
  Original rationale.
`;

const FOO_MODIFIED_CLAUSE = FOO_ORIGINAL.replace(
  'The system MUST do X.',
  'The system MUST do X with a different twist.',
);

const FOO_ADDED_CLAUSE = FOO_ORIGINAL.replace(
  '  - The system MUST do Y.\n',
  '  - The system MUST do Y.\n  - The system MUST do Z.\n',
);

const FOO_REMOVED_CLAUSE = FOO_ORIGINAL.replace(
  '  - The system MUST do Y.\n',
  '',
);

const FOO_INTENT_CHANGED = FOO_ORIGINAL.replace(
  'Original intent.',
  'A totally rewritten intent.',
);

const FOO_NONGOALS_CHANGED = FOO_ORIGINAL.replace(
  '  - Goal A.',
  '  - Goal A.\n  - Goal B.',
);

const FOO_RATIONALE_CHANGED = FOO_ORIGINAL.replace(
  'Original rationale.',
  'New rationale text.',
);

const FOO_MACHINE_CHANGED = FOO_ORIGINAL.replace(
  'paths: [src/foo.ts]',
  'paths: [src/foo.ts, src/bar.ts]',
);

const FOO_MALFORMED = 'this is not a valid tnl file\n';

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

function gitInit(cwd: string) {
  execFileSync('git', ['-C', cwd, 'init', '-q'], { stdio: 'pipe' });
  execFileSync('git', ['-C', cwd, 'config', 'user.email', 't@t.com'], {
    stdio: 'pipe',
  });
  execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Test'], {
    stdio: 'pipe',
  });
  execFileSync('git', ['-C', cwd, 'config', 'commit.gpgsign', 'false'], {
    stdio: 'pipe',
  });
}

function gitCommitAll(cwd: string, msg: string) {
  execFileSync('git', ['-C', cwd, 'add', '-A'], { stdio: 'pipe' });
  execFileSync('git', ['-C', cwd, 'commit', '-q', '-m', msg], {
    stdio: 'pipe',
  });
}

describe('tnl diff', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-diff-'));
    gitInit(cwd);
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_ORIGINAL, 'utf8');
    gitCommitAll(cwd, 'initial foo');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exits 0 with "unchanged at the behavior level" when file matches HEAD', () => {
    const cap = capture();
    const code = runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('unchanged at the behavior level');
    expect(cap.stdout()).toContain('  machine zone: unchanged');
    expect(cap.stdout()).toContain('  intent: unchanged');
    expect(cap.stdout()).toContain('  non-goals: unchanged');
    expect(cap.stdout()).toContain('  rationale: unchanged');
  });

  it('shows an ADDED clause', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_ADDED_CLAUSE, 'utf8');
    const cap = capture();
    const code = runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('+1 added');
    expect(cap.stdout()).toContain('ADDED:');
    expect(cap.stdout()).toContain('L-3: The system MUST do Z.');
  });

  it('shows a REMOVED clause', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_REMOVED_CLAUSE, 'utf8');
    const cap = capture();
    const code = runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('-1 removed');
    expect(cap.stdout()).toContain('REMOVED:');
    expect(cap.stdout()).toContain('L-2: The system MUST do Y.');
  });

  it('shows a MODIFIED clause with before/after', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_MODIFIED_CLAUSE, 'utf8');
    const cap = capture();
    const code = runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('~1 modified');
    expect(cap.stdout()).toContain('MODIFIED:');
    expect(cap.stdout()).toContain('L-1:');
    expect(cap.stdout()).toContain('before: The system MUST do X.');
    expect(cap.stdout()).toContain(
      'after:  The system MUST do X with a different twist.',
    );
  });

  it('shows every clause as ADDED when the file is not in HEAD', () => {
    writeFileSync(join(cwd, 'tnl', 'new.tnl'), FOO_ORIGINAL.replace('id: foo', 'id: new').replace('title: Foo', 'title: New'), 'utf8');
    const cap = capture();
    const code = runDiff(['tnl/new.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('+2 added');
    expect(cap.stdout()).toContain('ADDED:');
    expect(cap.stdout()).toContain('L-1: The system MUST do X.');
    expect(cap.stdout()).toContain('L-2: The system MUST do Y.');
    expect(cap.stdout()).toContain('  machine zone: changed');
  });

  it('detects changes to intent in the zone summary', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_INTENT_CHANGED, 'utf8');
    const cap = capture();
    runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(cap.stdout()).toContain('  intent: changed');
    expect(cap.stdout()).toContain('unchanged at the behavior level');
  });

  it('detects changes to non-goals in the zone summary', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_NONGOALS_CHANGED, 'utf8');
    const cap = capture();
    runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(cap.stdout()).toContain('  non-goals: changed');
  });

  it('detects changes to rationale in the zone summary', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_RATIONALE_CHANGED, 'utf8');
    const cap = capture();
    runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(cap.stdout()).toContain('  rationale: changed');
  });

  it('detects machine-zone changes in the summary', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_MACHINE_CHANGED, 'utf8');
    const cap = capture();
    runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(cap.stdout()).toContain('  machine zone: changed');
  });

  it('exits 2 when the working-tree file does not exist', () => {
    const cap = capture();
    const code = runDiff(['tnl/missing.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('file not found');
  });

  it('exits 2 when the working directory is not a git repo', () => {
    const nonGit = mkdtempSync(join(tmpdir(), 'tnl-diff-notgit-'));
    try {
      writeFileSync(join(nonGit, 'foo.tnl'), FOO_ORIGINAL, 'utf8');
      const cap = capture();
      const code = runDiff(['foo.tnl'], { cwd: nonGit, ...cap.opts });
      expect(code).toBe(2);
      expect(cap.stderr()).toContain('not inside a git repository');
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it('exits 2 when the working-tree content fails to parse', () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FOO_MALFORMED, 'utf8');
    const cap = capture();
    const code = runDiff(['tnl/foo.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('failed to parse');
  });

  it('exits 2 with usage on zero positional args', () => {
    const cap = capture();
    const code = runDiff([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('Usage: tnl diff');
  });

  it('exits 2 with usage on more than one positional arg', () => {
    const cap = capture();
    const code = runDiff(['tnl/foo.tnl', 'tnl/bar.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('Usage: tnl diff');
  });

  it('registers diff in the default registry on module import', () => {
    expect(defaultRegistry.has('diff')).toBe(true);
    expect(defaultRegistry.get('diff')!.name).toBe('diff');
  });
});
