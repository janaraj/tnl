import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Clause } from '../../src/parser.js';
import {
  classifyClause,
  hashClause,
  hashUnit,
  ResolveError,
  resolveTnlFile,
  resolveTnlSource,
} from '../../src/resolver.js';

function clause(
  partial: Partial<Clause> & Pick<Clause, 'text'>,
): Clause {
  const c: Clause = {
    text: partial.text,
    line: partial.line ?? 1,
    keywords: partial.keywords ?? [],
    semantic: partial.semantic ?? false,
  };
  if (partial.testBinding !== undefined) c.testBinding = partial.testBinding;
  return c;
}

const MINIMAL = `id: example
title: Example
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - The system MUST do X.
  - The agent SHOULD do Y.
  - [semantic] The intent MUST be preserved.
`;

describe('classifyClause', () => {
  it('returns structural for MUST', () => {
    expect(classifyClause(clause({ text: 'x MUST y', keywords: ['MUST'] }))).toBe(
      'structural',
    );
  });

  it('returns structural for MUST NOT', () => {
    expect(
      classifyClause(clause({ text: 'x MUST NOT y', keywords: ['MUST NOT'] })),
    ).toBe('structural');
  });

  it('returns advisory for SHOULD', () => {
    expect(
      classifyClause(clause({ text: 'x SHOULD y', keywords: ['SHOULD'] })),
    ).toBe('advisory');
  });

  it('returns advisory for SHOULD NOT', () => {
    expect(
      classifyClause(
        clause({ text: 'x SHOULD NOT y', keywords: ['SHOULD NOT'] }),
      ),
    ).toBe('advisory');
  });

  it('returns advisory for MAY', () => {
    expect(classifyClause(clause({ text: 'x MAY y', keywords: ['MAY'] }))).toBe(
      'advisory',
    );
  });

  it('returns semantic for [semantic] prefix regardless of keywords', () => {
    expect(
      classifyClause(
        clause({
          text: '[semantic] x MUST y',
          keywords: ['MUST'],
          semantic: true,
        }),
      ),
    ).toBe('semantic');
  });

  it('returns test-backed when testBinding is set', () => {
    expect(
      classifyClause(
        clause({
          text: '[test: tests/foo.test.ts::bar] x',
          keywords: [],
          testBinding: { file: 'tests/foo.test.ts', name: 'bar' },
        }),
      ),
    ).toBe('test-backed');
  });

  it('test-backed wins over MUST keyword', () => {
    expect(
      classifyClause(
        clause({
          text: '[test: tests/foo.test.ts::bar] The system MUST work',
          keywords: ['MUST'],
          testBinding: { file: 'tests/foo.test.ts', name: 'bar' },
        }),
      ),
    ).toBe('test-backed');
  });

  it('returns structural for MUST combined with SHOULD and MAY (MUST dominates)', () => {
    expect(
      classifyClause(
        clause({
          text: 'MUST do X SHOULD do Y MAY do Z',
          keywords: ['MUST', 'SHOULD', 'MAY'],
        }),
      ),
    ).toBe('structural');
  });

  it('throws ResolveError on clause with no keywords, no semantic, no testBinding', () => {
    expect(() =>
      classifyClause(clause({ text: 'just a sentence', keywords: [] })),
    ).toThrow(ResolveError);
  });

  it('error message cites the clause line number', () => {
    try {
      classifyClause(clause({ text: 'nope', keywords: [], line: 42 }));
    } catch (e) {
      expect((e as ResolveError).line).toBe(42);
      expect((e as Error).message).toMatch(/^line 42:/);
      return;
    }
    throw new Error('expected throw');
  });
});

describe('hashClause', () => {
  it('is stable under leading/trailing whitespace', () => {
    expect(hashClause('foo bar')).toBe(hashClause('  foo bar  '));
  });

  it('is stable under internal whitespace variation', () => {
    expect(hashClause('foo   bar\n\tbaz')).toBe(hashClause('foo bar baz'));
  });

  it('differs when content differs', () => {
    expect(hashClause('foo')).not.toBe(hashClause('bar'));
  });

  it('produces a 64-char lowercase hex string', () => {
    expect(hashClause('foo')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashUnit', () => {
  it('is stable under CRLF vs LF', () => {
    const lf = 'a\nb\nc\n';
    const crlf = 'a\r\nb\r\nc\r\n';
    expect(hashUnit(lf)).toBe(hashUnit(crlf));
  });

  it('is stable under per-line trailing whitespace', () => {
    expect(hashUnit('a\nb\n')).toBe(hashUnit('a   \nb\t\t\n'));
  });

  it('differs when content differs', () => {
    expect(hashUnit('a\nb\n')).not.toBe(hashUnit('a\nc\n'));
  });

  it('is NOT stable under leading whitespace changes', () => {
    // leading whitespace is structural (indicates section nesting)
    expect(hashUnit('a\n')).not.toBe(hashUnit('  a\n'));
  });
});

describe('resolveTnlSource', () => {
  it('produces a sidecar with unit_hash, resolved_at, and clauses', () => {
    const fixedNow = new Date('2026-01-15T12:00:00Z');
    const sidecar = resolveTnlSource(MINIMAL, undefined, { now: fixedNow });
    expect(sidecar.unit_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar.resolved_at).toBe('2026-01-15T12:00:00.000Z');
    expect(Object.keys(sidecar.clauses)).toEqual(['L-1', 'L-2', 'L-3']);
  });

  it('classifies each clause correctly', () => {
    const sidecar = resolveTnlSource(MINIMAL);
    expect(sidecar.clauses['L-1']!.class).toBe('structural');
    expect(sidecar.clauses['L-2']!.class).toBe('advisory');
    expect(sidecar.clauses['L-3']!.class).toBe('semantic');
  });

  it('sidecar entries for non-test-backed classes do not carry a test field', () => {
    const sidecar = resolveTnlSource(MINIMAL);
    expect(sidecar.clauses['L-1']!.test).toBeUndefined();
    expect(sidecar.clauses['L-2']!.test).toBeUndefined();
    expect(sidecar.clauses['L-3']!.test).toBeUndefined();
  });

  it('test-backed sidecar entry carries the test binding', () => {
    const withTest = `id: example
title: Example
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - [test: tests/foo.test.ts::xff_isolation] The system MUST isolate X-Forwarded-For.
`;
    const sidecar = resolveTnlSource(withTest);
    const entry = sidecar.clauses['L-1']!;
    expect(entry.class).toBe('test-backed');
    expect(entry.test).toEqual({
      file: 'tests/foo.test.ts',
      name: 'xff_isolation',
    });
  });

  it('assigns each clause a unique content hash', () => {
    const sidecar = resolveTnlSource(MINIMAL);
    const hashes = Object.values(sidecar.clauses).map((c) => c.hash);
    expect(new Set(hashes).size).toBe(3);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses injected now for resolved_at', () => {
    const fixed = new Date('2030-12-31T23:59:59Z');
    const sidecar = resolveTnlSource(MINIMAL, undefined, { now: fixed });
    expect(sidecar.resolved_at).toBe('2030-12-31T23:59:59.000Z');
  });

  it('propagates parser errors', () => {
    expect(() => resolveTnlSource('not a valid tnl')).toThrow();
  });

  it('roundtrips this repo tnl/workflow.tnl', () => {
    const sidecar = resolveTnlFile('tnl/workflow.tnl');
    expect(Object.keys(sidecar.clauses).length).toBeGreaterThan(0);
    for (const entry of Object.values(sidecar.clauses)) {
      expect(['structural', 'test-backed', 'semantic', 'advisory']).toContain(
        entry.class,
      );
    }
  });
});

describe('resolveTnlFile', () => {
  it('reads from disk and resolves', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tnl-resolve-test-'));
    try {
      const path = join(dir, 'example.tnl');
      writeFileSync(path, MINIMAL, 'utf8');
      const sidecar = resolveTnlFile(path);
      expect(sidecar.clauses['L-1']!.class).toBe('structural');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
