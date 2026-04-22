import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVerify } from '../../src/commands/verify.js';

function makeTnl(opts: {
  id: string;
  scope: 'repo-wide' | 'feature';
  paths?: string[];
  dependencies?: string[];
  clauses?: string[];
}): string {
  const pathsLine =
    opts.paths !== undefined ? `paths: [${opts.paths.join(', ')}]\n` : '';
  const depsLine =
    opts.dependencies !== undefined
      ? `dependencies: [${opts.dependencies.join(', ')}]\n`
      : '';
  const clauses = (opts.clauses ?? ['The system MUST work.']).map(
    (c) => `  - ${c}`,
  );
  return `id: ${opts.id}
title: ${opts.id} title
scope: ${opts.scope}
owners: [@jana]
${pathsLine}${depsLine}
intent:
  Intent.

behaviors:
${clauses.join('\n')}
`;
}

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

describe('tnl verify CLI', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-verify-cli-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('with no args verifies every TNL and reports per-unit summaries', () => {
    writeFileSync(
      join(cwd, 'tnl', 'a.tnl'),
      makeTnl({ id: 'a', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'b.tnl'),
      makeTnl({ id: 'b', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    const cap = capture();
    const code = runVerify([], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('a: ');
    expect(cap.stdout()).toContain('b: ');
    expect(cap.stdout()).toContain('Summary: 2 TNLs verified');
  });

  it('accepts a mix of TNL ids and file paths', () => {
    writeFileSync(
      join(cwd, 'tnl', 'a.tnl'),
      makeTnl({ id: 'a', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'b.tnl'),
      makeTnl({ id: 'b', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    const cap = capture();
    const code = runVerify(['a', 'tnl/b.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('a: ');
    expect(cap.stdout()).toContain('b: ');
  });

  it('exits 0 when all checks pass or are unchecked', () => {
    writeFileSync(
      join(cwd, 'tnl', 'a.tnl'),
      makeTnl({
        id: 'a',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: ['The system MUST do X.', '[semantic] Intent matters.'],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runVerify([], { cwd, ...cap.opts });
    expect(code).toBe(0);
  });

  it('exits 2 when any check fails and prints a detail line', () => {
    writeFileSync(
      join(cwd, 'tnl', 'bad.tnl'),
      makeTnl({
        id: 'bad',
        scope: 'feature',
        paths: ['src/missing.ts'],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runVerify([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stdout()).toContain('paths-exist FAIL');
    expect(cap.stdout()).toContain('src/missing.ts');
  });

  it('clause failure lines include the (<class>) segment', () => {
    mkdirSync(join(cwd, 'tests'));
    writeFileSync(
      join(cwd, 'tests', 'foo.test.ts'),
      '// no matching test name\n',
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: [
          '[test: tests/foo.test.ts::missing_test] The system MUST work.',
        ],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runVerify([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stdout()).toContain('(test-backed) FAIL');
  });

  it('unit-level failure lines omit the (<class>) segment', () => {
    writeFileSync(
      join(cwd, 'tnl', 'bad.tnl'),
      makeTnl({
        id: 'bad',
        scope: 'feature',
        paths: ['src/missing.ts'],
      }),
      'utf8',
    );
    const cap = capture();
    runVerify([], { cwd, ...cap.opts });
    expect(cap.stdout()).toContain('paths-exist FAIL:');
    expect(cap.stdout()).not.toContain('paths-exist (');
  });

  it('reports malformed .tnl on stderr and exits 2', () => {
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), 'not a valid tnl\n', 'utf8');
    const cap = capture();
    const code = runVerify([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('bad: FAIL');
  });

  it('exits 2 with init hint when no tnl/ directory and no args', () => {
    rmSync(join(cwd, 'tnl'), { recursive: true, force: true });
    const cap = capture();
    const code = runVerify([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('no tnl/ directory');
    expect(cap.stderr()).toContain('tnl init');
  });

  it('stdout summary line has the expected shape', () => {
    writeFileSync(
      join(cwd, 'tnl', 'a.tnl'),
      makeTnl({ id: 'a', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    const cap = capture();
    runVerify([], { cwd, ...cap.opts });
    expect(cap.stdout()).toMatch(
      /Summary: \d+ TNLs verified\. \d+ checks, \d+ failed, \d+ unchecked\./,
    );
  });
});
