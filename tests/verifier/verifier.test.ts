import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAll, verifyTnl } from '../../src/verifier.js';

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

describe('verifyTnl — tier 1 paths-exist', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-verify-'));
    mkdirSync(join(cwd, 'tnl'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('passes when every declared path exists', () => {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
    writeFileSync(join(cwd, 'src', 'bar.ts'), '// bar\n', 'utf8');
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts', 'src/bar.ts'],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    const pathsCheck = r.checks.find((c) => c.name === 'paths-exist');
    expect(pathsCheck?.status).toBe('passed');
  });

  it('fails and names the missing path when one declared path is absent', () => {
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts', 'src/missing.ts'],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    const pathsCheck = r.checks.find((c) => c.name === 'paths-exist');
    expect(pathsCheck?.status).toBe('failed');
    expect(pathsCheck?.reason).toContain('src/missing.ts');
  });

  it('skips the paths-exist check entirely for repo-wide TNLs', () => {
    writeFileSync(
      join(cwd, 'tnl', 'workflow.tnl'),
      makeTnl({ id: 'workflow', scope: 'repo-wide' }),
      'utf8',
    );
    const r = verifyTnl('tnl/workflow.tnl', { cwd });
    expect(r.checks.some((c) => c.name === 'paths-exist')).toBe(false);
  });
});

describe('verifyTnl — tier 1 dependencies-resolve', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-verify-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('passes when every dependency resolves to a tnl file', () => {
    writeFileSync(
      join(cwd, 'tnl', 'alpha.tnl'),
      makeTnl({ id: 'alpha', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'beta.tnl'),
      makeTnl({
        id: 'beta',
        scope: 'feature',
        paths: ['src/foo.ts'],
        dependencies: ['alpha'],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/beta.tnl', { cwd });
    const depsCheck = r.checks.find((c) => c.name === 'dependencies-resolve');
    expect(depsCheck?.status).toBe('passed');
  });

  it('fails naming the dangling id when a dependency does not resolve', () => {
    writeFileSync(
      join(cwd, 'tnl', 'beta.tnl'),
      makeTnl({
        id: 'beta',
        scope: 'feature',
        paths: ['src/foo.ts'],
        dependencies: ['missing-dep'],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/beta.tnl', { cwd });
    const depsCheck = r.checks.find((c) => c.name === 'dependencies-resolve');
    expect(depsCheck?.status).toBe('failed');
    expect(depsCheck?.reason).toContain('missing-dep');
  });

  it('skips the dependencies-resolve check when no dependencies are declared', () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    expect(r.checks.some((c) => c.name === 'dependencies-resolve')).toBe(
      false,
    );
  });
});

describe('verifyTnl — tier 2 test-binding', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-verify-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('passes when the test name is found in the named file', () => {
    mkdirSync(join(cwd, 'tests'));
    writeFileSync(
      join(cwd, 'tests', 'foo.test.ts'),
      `it('returns_429_on_exceeded', () => {});\n`,
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: [
          '[test: tests/foo.test.ts::returns_429_on_exceeded] The system MUST work.',
        ],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    const check = r.checks.find((c) => c.name === 'L-1');
    expect(check?.status).toBe('passed');
    expect(check?.class).toBe('test-backed');
  });

  it('fails naming the missing test when the name is not in the file', () => {
    mkdirSync(join(cwd, 'tests'));
    writeFileSync(
      join(cwd, 'tests', 'foo.test.ts'),
      `it('different_test', () => {});\n`,
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: [
          '[test: tests/foo.test.ts::returns_429_on_exceeded] The system MUST work.',
        ],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    const check = r.checks.find((c) => c.name === 'L-1');
    expect(check?.status).toBe('failed');
    expect(check?.reason).toContain('returns_429_on_exceeded');
    expect(check?.reason).toContain('tests/foo.test.ts');
  });

  it('fails with a file-missing reason when the test file does not exist', () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: [
          '[test: tests/gone.test.ts::whatever] The system MUST work.',
        ],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    const check = r.checks.find((c) => c.name === 'L-1');
    expect(check?.status).toBe('failed');
    expect(check?.reason).toContain('tests/gone.test.ts does not exist');
  });
});

describe('verifyTnl — unchecked clauses', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-verify-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('emits unchecked for structural / semantic / advisory clauses', () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({
        id: 'foo',
        scope: 'feature',
        paths: ['src/foo.ts'],
        clauses: [
          'The system MUST work.',
          'The agent SHOULD log.',
          '[semantic] The intent MUST be preserved.',
        ],
      }),
      'utf8',
    );
    const r = verifyTnl('tnl/foo.tnl', { cwd });
    const l1 = r.checks.find((c) => c.name === 'L-1')!;
    const l2 = r.checks.find((c) => c.name === 'L-2')!;
    const l3 = r.checks.find((c) => c.name === 'L-3')!;
    expect(l1.status).toBe('unchecked');
    expect(l1.class).toBe('structural');
    expect(l2.status).toBe('unchecked');
    expect(l2.class).toBe('advisory');
    expect(l3.status).toBe('unchecked');
    expect(l3.class).toBe('semantic');
  });
});

describe('verifyAll', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-verify-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns a result per .tnl file when no ids are given', () => {
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
    const results = verifyAll({ cwd });
    expect(results.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('accepts an ids option and only verifies those', () => {
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
    const results = verifyAll({ cwd, ids: ['a'] });
    expect(results.map((r) => r.id)).toEqual(['a']);
  });

  it('returns empty array when no tnl/ directory exists', () => {
    rmSync(join(cwd, 'tnl'), { recursive: true, force: true });
    expect(verifyAll({ cwd })).toEqual([]);
  });
});
