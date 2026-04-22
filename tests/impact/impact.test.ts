import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getImpactedTnls, pathsOverlap } from '../../src/impact.js';

function makeTnl(opts: {
  id: string;
  scope: 'repo-wide' | 'feature';
  paths?: string[];
}): string {
  const pathsLine =
    opts.paths !== undefined ? `paths: [${opts.paths.join(', ')}]\n` : '';
  return `id: ${opts.id}
title: ${opts.id} title
scope: ${opts.scope}
owners: [@jana]
${pathsLine}
intent:
  Intent.

behaviors:
  - The system MUST work.
`;
}

describe('pathsOverlap', () => {
  it('matches exact paths', () => {
    expect(pathsOverlap('src/foo.ts', 'src/foo.ts')).toBe(true);
  });

  it('does not match different files', () => {
    expect(pathsOverlap('src/foo.ts', 'src/bar.ts')).toBe(false);
  });

  it('matches when query directory contains the TNL file', () => {
    expect(pathsOverlap('src/', 'src/foo.ts')).toBe(true);
    expect(pathsOverlap('src', 'src/foo.ts')).toBe(true);
  });

  it('matches when TNL directory contains the query file', () => {
    expect(pathsOverlap('src/foo.ts', 'src/')).toBe(true);
    expect(pathsOverlap('src/foo.ts', 'src')).toBe(true);
  });

  it('does not match partial filename prefixes', () => {
    expect(pathsOverlap('src/foo', 'src/foo.ts')).toBe(false);
    expect(pathsOverlap('src/foo.t', 'src/foo.ts')).toBe(false);
  });

  it('does not match sibling directories with shared prefix', () => {
    expect(pathsOverlap('src/authz', 'src/auth/login.ts')).toBe(false);
  });
});

describe('getImpactedTnls', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-impact-test-'));
    mkdirSync(join(cwd, 'tnl'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function write(id: string, content: string) {
    writeFileSync(join(cwd, 'tnl', `${id}.tnl`), content, 'utf8');
  }

  it('always returns repo-wide units regardless of query', () => {
    write('workflow', makeTnl({ id: 'workflow', scope: 'repo-wide' }));
    const r = getImpactedTnls(['any/path.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['workflow']);
  });

  it('returns feature TNL on exact path match', () => {
    write('workflow', makeTnl({ id: 'workflow', scope: 'repo-wide' }));
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }));
    const r = getImpactedTnls(['src/foo.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['workflow', 'foo']);
  });

  it('omits feature TNL when no path overlaps', () => {
    write('workflow', makeTnl({ id: 'workflow', scope: 'repo-wide' }));
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }));
    const r = getImpactedTnls(['src/bar.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['workflow']);
  });

  it('matches when query path is a directory containing the TNL file', () => {
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }));
    const r = getImpactedTnls(['src/'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['foo']);
  });

  it('matches when TNL path is a directory containing the query file', () => {
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/'] }));
    const r = getImpactedTnls(['src/foo.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['foo']);
  });

  it('unions matches across multiple query paths', () => {
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }));
    write('bar', makeTnl({ id: 'bar', scope: 'feature', paths: ['src/bar.ts'] }));
    const r = getImpactedTnls(['src/foo.ts', 'src/bar.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['bar', 'foo']);
  });

  it('does not duplicate a TNL matched by multiple query paths', () => {
    write(
      'multi',
      makeTnl({ id: 'multi', scope: 'feature', paths: ['src/a.ts', 'src/b.ts'] }),
    );
    const r = getImpactedTnls(['src/a.ts', 'src/b.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['multi']);
  });

  it('orders results: repo-wide first (alpha), then feature (alpha)', () => {
    write('z-repo', makeTnl({ id: 'z-repo', scope: 'repo-wide' }));
    write('a-repo', makeTnl({ id: 'a-repo', scope: 'repo-wide' }));
    write(
      'z-feat',
      makeTnl({ id: 'z-feat', scope: 'feature', paths: ['src/foo.ts'] }),
    );
    write(
      'a-feat',
      makeTnl({ id: 'a-feat', scope: 'feature', paths: ['src/foo.ts'] }),
    );
    const r = getImpactedTnls(['src/foo.ts'], { cwd });
    expect(r.map((x) => x.id)).toEqual(['a-repo', 'z-repo', 'a-feat', 'z-feat']);
  });

  it('returns empty when no repo-wide and no feature match', () => {
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }));
    const r = getImpactedTnls(['src/unrelated.ts'], { cwd });
    expect(r).toEqual([]);
  });

  it('propagates parser errors from malformed .tnl', () => {
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), 'not a valid tnl file', 'utf8');
    expect(() => getImpactedTnls(['src/foo.ts'], { cwd })).toThrow();
  });

  it('returns ImpactedTnl with id, title, sourcePath, scope', () => {
    write('foo', makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }));
    const r = getImpactedTnls(['src/foo.ts'], { cwd });
    expect(r[0]).toMatchObject({
      id: 'foo',
      title: 'foo title',
      scope: 'feature',
    });
    expect(r[0]!.sourcePath).toContain('foo.tnl');
  });
});
