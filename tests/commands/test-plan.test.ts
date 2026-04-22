import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTestPlan } from '../../src/commands/test-plan.js';
import { defaultRegistry } from '../../src/cli.js';

function makeTnl(opts: {
  id: string;
  scope: 'repo-wide' | 'feature';
  paths?: string[];
  clauses?: string[];
}): string {
  const pathsLine =
    opts.paths !== undefined ? `paths: [${opts.paths.join(', ')}]\n` : '';
  const clauses = (opts.clauses ?? ['The system MUST work.']).map(
    (c) => `  - ${c}`,
  );
  return `id: ${opts.id}
title: ${opts.id} title
scope: ${opts.scope}
owners: [@jana]
${pathsLine}
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

describe('tnl test-plan', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-test-plan-'));
    mkdirSync(join(cwd, 'tnl'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('registers test-plan in the default registry on module import', () => {
    expect(defaultRegistry.has('test-plan')).toBe(true);
    expect(defaultRegistry.get('test-plan')!.name).toBe('test-plan');
  });

  it('prints L-N <file>::<name> for each test-backed clause', () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: [
          '[test: tests/foo.test.ts::a_test] The system MUST do X.',
          '[test: tests/foo.test.ts::b_test] The system MUST do Y.',
        ],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runTestPlan(['foo'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe(
      'L-1 tests/foo.test.ts::a_test\nL-2 tests/foo.test.ts::b_test\n',
    );
  });

  it('excludes structural, semantic, and advisory clauses from output', () => {
    writeFileSync(
      join(cwd, 'tnl', 'mixed.tnl'),
      makeTnl({
        id: 'mixed',
        scope: 'feature',
        paths: ['src/mixed.ts'],
        clauses: [
          'The system MUST do X.',
          '[test: tests/mixed.test.ts::y_test] The system MUST do Y.',
          '[semantic] Intent MUST be preserved.',
          'The agent SHOULD log.',
        ],
      }),
      'utf8',
    );
    const cap = capture();
    runTestPlan(['mixed'], { cwd, ...cap.opts });
    expect(cap.stdout()).toBe('L-2 tests/mixed.test.ts::y_test\n');
  });

  it('preserves clause order in output', () => {
    writeFileSync(
      join(cwd, 'tnl', 'ordered.tnl'),
      makeTnl({
        id: 'ordered',
        scope: 'feature',
        paths: ['src/ordered.ts'],
        clauses: [
          '[test: tests/a.test.ts::first] MUST a.',
          'The system MUST do middle.',
          '[test: tests/a.test.ts::third] MUST c.',
        ],
      }),
      'utf8',
    );
    const cap = capture();
    runTestPlan(['ordered'], { cwd, ...cap.opts });
    expect(cap.stdout()).toBe(
      'L-1 tests/a.test.ts::first\nL-3 tests/a.test.ts::third\n',
    );
  });

  it('prints "No test-backed clauses" message and exits 0 when none present', () => {
    writeFileSync(
      join(cwd, 'tnl', 'plain.tnl'),
      makeTnl({
        id: 'plain',
        scope: 'feature',
        paths: ['src/plain.ts'],
        clauses: ['The system MUST do X.'],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runTestPlan(['plain'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toBe('No test-backed clauses in plain.\n');
  });

  it('resolves an id argument to ./tnl/<id>.tnl', () => {
    writeFileSync(
      join(cwd, 'tnl', 'byid.tnl'),
      makeTnl({
        id: 'byid',
        scope: 'feature',
        paths: ['src/byid.ts'],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runTestPlan(['byid'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('No test-backed clauses in byid.');
  });

  it('accepts a relative path argument', () => {
    writeFileSync(
      join(cwd, 'tnl', 'bypath.tnl'),
      makeTnl({
        id: 'bypath',
        scope: 'feature',
        paths: ['src/bypath.ts'],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runTestPlan(['tnl/bypath.tnl'], { cwd, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('No test-backed clauses in bypath.');
  });

  it('accepts an absolute path argument', () => {
    writeFileSync(
      join(cwd, 'tnl', 'byabs.tnl'),
      makeTnl({
        id: 'byabs',
        scope: 'feature',
        paths: ['src/byabs.ts'],
      }),
      'utf8',
    );
    const cap = capture();
    const code = runTestPlan([join(cwd, 'tnl', 'byabs.tnl')], {
      cwd,
      ...cap.opts,
    });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('No test-backed clauses in byabs.');
  });

  it('exits 2 with usage when no positional args are given', () => {
    const cap = capture();
    const code = runTestPlan([], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('Usage: tnl test-plan');
  });

  it('exits 2 with usage when more than one positional arg is given', () => {
    const cap = capture();
    const code = runTestPlan(['foo', 'bar'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('Usage: tnl test-plan');
  });

  it('exits 2 on missing TNL file', () => {
    const cap = capture();
    const code = runTestPlan(['nonesuch'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('tnl test-plan:');
  });

  it('exits 2 on malformed TNL', () => {
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), 'not a valid tnl', 'utf8');
    const cap = capture();
    const code = runTestPlan(['bad'], { cwd, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('tnl test-plan:');
  });
});
