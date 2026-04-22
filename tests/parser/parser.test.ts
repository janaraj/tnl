import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTnl, parseTnlFile, TnlParseError } from '../../src/parser.js';

const MINIMAL_FEATURE = `id: example
title: Example feature
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  One-line intent.

behaviors:
  - The system MUST work.
`;

const MINIMAL_REPO_WIDE = `id: example
title: Example
scope: repo-wide
owners: [@jana]

intent:
  Intent.

behaviors:
  - The agent MUST follow rules.
`;

describe('parseTnl — valid inputs', () => {
  it('roundtrips tnl/workflow.tnl', () => {
    const result = parseTnlFile('tnl/workflow.tnl');
    expect(result.machine.id).toBe('workflow');
    expect(result.machine.scope).toBe('repo-wide');
    expect(result.machine.paths).toBeUndefined();
    expect(result.behaviors.length).toBeGreaterThan(0);
    expect(result.nonGoals.length).toBeGreaterThan(0);
    expect(result.rationale).not.toBe('');
  });

  it('roundtrips tnl/cli-skeleton.tnl', () => {
    const result = parseTnlFile('tnl/cli-skeleton.tnl');
    expect(result.machine.id).toBe('cli-skeleton');
    expect(result.machine.scope).toBe('feature');
    expect(result.machine.paths).toEqual(['src/index.ts', 'src/cli.ts']);
    expect(result.machine.surfaces).toEqual(['tnl']);
  });

  it('roundtrips tnl/cli-init.tnl', () => {
    const result = parseTnlFile('tnl/cli-init.tnl');
    expect(result.machine.id).toBe('cli-init');
    expect(result.machine.dependencies).toEqual(['cli-skeleton']);
  });

  it('parses a minimal feature TNL', () => {
    const r = parseTnl(MINIMAL_FEATURE);
    expect(r.machine.id).toBe('example');
    expect(r.machine.scope).toBe('feature');
    expect(r.machine.owners).toEqual(['@jana']);
    expect(r.machine.paths).toEqual(['src/foo.ts']);
    expect(r.intent).toBe('One-line intent.');
    expect(r.behaviors).toHaveLength(1);
    expect(r.behaviors[0]!.keywords).toEqual(['MUST']);
  });

  it('parses a minimal repo-wide TNL', () => {
    const r = parseTnl(MINIMAL_REPO_WIDE);
    expect(r.machine.scope).toBe('repo-wide');
    expect(r.machine.paths).toBeUndefined();
  });

  it('parses empty bracket list', () => {
    const src = MINIMAL_FEATURE.replace(
      'owners: [@jana]\npaths: [src/foo.ts]',
      'owners: [@jana]\npaths: [src/foo.ts]\nsurfaces: []',
    );
    const r = parseTnl(src);
    expect(r.machine.surfaces).toEqual([]);
  });
});

describe('parseTnl — machine zone validation', () => {
  it('rejects missing id', () => {
    const src = MINIMAL_FEATURE.replace('id: example\n', '');
    expect(() => parseTnl(src)).toThrow(/missing required machine-zone field: id/);
  });

  it('rejects missing title', () => {
    const src = MINIMAL_FEATURE.replace('title: Example feature\n', '');
    expect(() => parseTnl(src)).toThrow(/missing required machine-zone field: title/);
  });

  it('rejects missing scope', () => {
    const src = MINIMAL_FEATURE.replace('scope: feature\n', '');
    expect(() => parseTnl(src)).toThrow(/missing required machine-zone field: scope/);
  });

  it('rejects missing owners', () => {
    const src = MINIMAL_FEATURE.replace('owners: [@jana]\n', '');
    expect(() => parseTnl(src)).toThrow(/missing required machine-zone field: owners/);
  });

  it('rejects invalid scope value', () => {
    const src = MINIMAL_FEATURE.replace('scope: feature', 'scope: widespread');
    expect(() => parseTnl(src)).toThrow(/scope must be 'repo-wide' or 'feature'/);
  });

  it('rejects invalid id format', () => {
    const src = MINIMAL_FEATURE.replace('id: example', 'id: Example_One');
    expect(() => parseTnl(src)).toThrow(/must be kebab-case/);
  });

  it('rejects unknown machine-zone field', () => {
    const src = MINIMAL_FEATURE.replace(
      'owners: [@jana]\n',
      'owners: [@jana]\nversion: 2\n',
    );
    expect(() => parseTnl(src)).toThrow(/unknown machine-zone field 'version'/);
  });

  it('rejects duplicate machine-zone field', () => {
    const src = MINIMAL_FEATURE.replace('id: example\n', 'id: example\nid: other\n');
    expect(() => parseTnl(src)).toThrow(/duplicate machine-zone field 'id'/);
  });

  it('rejects scope=feature without paths', () => {
    const src = MINIMAL_FEATURE.replace('paths: [src/foo.ts]\n', '');
    expect(() => parseTnl(src)).toThrow(/scope 'feature' requires a 'paths' field/);
  });

  it('rejects scope=feature with empty paths', () => {
    const src = MINIMAL_FEATURE.replace('paths: [src/foo.ts]', 'paths: []');
    expect(() => parseTnl(src)).toThrow(/non-empty 'paths'/);
  });

  it('rejects scope=repo-wide with paths', () => {
    const src = MINIMAL_REPO_WIDE.replace(
      'scope: repo-wide\nowners: [@jana]',
      'scope: repo-wide\nowners: [@jana]\npaths: [src/foo.ts]',
    );
    expect(() => parseTnl(src)).toThrow(/scope 'repo-wide' forbids 'paths'/);
  });

  it('rejects malformed bracket list', () => {
    const src = MINIMAL_FEATURE.replace('owners: [@jana]', 'owners: @jana');
    expect(() => parseTnl(src)).toThrow(/must be a bracket list/);
  });

  it('rejects empty owners list', () => {
    const src = MINIMAL_FEATURE.replace('owners: [@jana]', 'owners: []');
    expect(() => parseTnl(src)).toThrow(/owners must be a non-empty list/);
  });
});

describe('parseTnl — id/filename', () => {
  it('rejects mismatch when sourcePath is a .tnl file', () => {
    expect(() => parseTnl(MINIMAL_FEATURE, 'tnl/other.tnl')).toThrow(
      /does not match filename stem 'other'/,
    );
  });

  it('accepts match', () => {
    expect(() => parseTnl(MINIMAL_FEATURE, 'tnl/example.tnl')).not.toThrow();
  });

  it('skips check when sourcePath not provided', () => {
    expect(() => parseTnl(MINIMAL_FEATURE)).not.toThrow();
  });

  it('skips check when sourcePath does not end in .tnl', () => {
    expect(() => parseTnl(MINIMAL_FEATURE, 'some/other.md')).not.toThrow();
  });
});

describe('parseTnl — section validation', () => {
  it('rejects missing intent', () => {
    const src = MINIMAL_FEATURE.replace('intent:\n  One-line intent.\n\n', '');
    expect(() => parseTnl(src)).toThrow(/missing required section: intent/);
  });

  it('rejects missing behaviors', () => {
    const src = MINIMAL_FEATURE.replace(
      'behaviors:\n  - The system MUST work.\n',
      '',
    );
    expect(() => parseTnl(src)).toThrow(/missing required section: behaviors/);
  });

  it('rejects unknown top-level section', () => {
    const src = MINIMAL_FEATURE + '\nassumptions:\n  - foo\n';
    expect(() => parseTnl(src)).toThrow(/unknown top-level section 'assumptions:'/);
  });

  it('rejects empty behaviors', () => {
    const src = MINIMAL_FEATURE.replace('  - The system MUST work.\n', '');
    expect(() => parseTnl(src)).toThrow(/at least one clause/);
  });

  it('parses with non-goals absent', () => {
    const r = parseTnl(MINIMAL_FEATURE);
    expect(r.nonGoals).toEqual([]);
  });

  it('parses with rationale absent', () => {
    const r = parseTnl(MINIMAL_FEATURE);
    expect(r.rationale).toBe('');
  });

  it('parses non-goals as plain strings (no keyword classification)', () => {
    const src =
      MINIMAL_FEATURE +
      `
non-goals:
  - Performance tuning MUST NOT be the focus.
  - Second goal.
`;
    const r = parseTnl(src);
    expect(r.nonGoals).toEqual([
      'Performance tuning MUST NOT be the focus.',
      'Second goal.',
    ]);
  });
});

describe('parseTnl — clause parsing', () => {
  function parseOneClause(clauseText: string): import('../../src/parser.js').Clause {
    const src = MINIMAL_FEATURE.replace(
      '- The system MUST work.',
      `- ${clauseText}`,
    );
    const r = parseTnl(src);
    return r.behaviors[0]!;
  }

  it('extracts MUST', () => {
    expect(parseOneClause('The system MUST do X.').keywords).toEqual(['MUST']);
  });

  it('extracts MUST NOT', () => {
    expect(parseOneClause('The system MUST NOT do X.').keywords).toEqual([
      'MUST NOT',
    ]);
  });

  it('extracts SHOULD', () => {
    expect(parseOneClause('The system SHOULD do X.').keywords).toEqual(['SHOULD']);
  });

  it('extracts SHOULD NOT', () => {
    expect(parseOneClause('The system SHOULD NOT do X.').keywords).toEqual([
      'SHOULD NOT',
    ]);
  });

  it('extracts MAY', () => {
    expect(parseOneClause('The system MAY do X.').keywords).toEqual(['MAY']);
  });

  it('extracts combinations in textual order', () => {
    expect(
      parseOneClause('The system MUST do X but MAY skip Y.').keywords,
    ).toEqual(['MUST', 'MAY']);
    expect(
      parseOneClause('The system MUST NOT do X and MUST do Y.').keywords,
    ).toEqual(['MUST NOT', 'MUST']);
  });

  it('deduplicates repeated keywords', () => {
    expect(
      parseOneClause('The system MUST do X and MUST do Y.').keywords,
    ).toEqual(['MUST']);
  });

  it('does not double-count MUST inside MUST NOT', () => {
    expect(parseOneClause('The system MUST NOT do X.').keywords).toEqual([
      'MUST NOT',
    ]);
  });

  it('does not double-count SHOULD inside SHOULD NOT', () => {
    expect(parseOneClause('The system SHOULD NOT do X.').keywords).toEqual([
      'SHOULD NOT',
    ]);
  });

  it('ignores lowercase keywords', () => {
    expect(parseOneClause('The system must do X.').keywords).toEqual([]);
  });

  it('detects [semantic] prefix', () => {
    const c = parseOneClause('[semantic] The key MUST be derived from the IP.');
    expect(c.semantic).toBe(true);
    expect(c.text.startsWith('[semantic]')).toBe(true);
    expect(c.keywords).toEqual(['MUST']);
  });

  it('does not detect [semantic] mid-clause', () => {
    const c = parseOneClause('The system MUST use [semantic] markup.');
    expect(c.semantic).toBe(false);
  });

  it('extracts [test: file::name] prefix into testBinding', () => {
    const c = parseOneClause(
      '[test: tests/foo.test.ts::xff_isolation] The key MUST be from the client IP.',
    );
    expect(c.testBinding).toEqual({
      file: 'tests/foo.test.ts',
      name: 'xff_isolation',
    });
    expect(c.semantic).toBe(false);
    expect(c.keywords).toEqual(['MUST']);
  });

  it('does not detect [test: ...] mid-clause', () => {
    const c = parseOneClause('The system MUST use [test: x::y] markup.');
    expect(c.testBinding).toBeUndefined();
  });

  it('rejects [test: prefix missing ::', () => {
    expect(() =>
      parseOneClause('[test: tests/foo.test.ts] The system MUST work.'),
    ).toThrow(/missing `::` separator/);
  });

  it('rejects [test: prefix missing closing ]', () => {
    expect(() =>
      parseOneClause('[test: tests/foo.test.ts::name The system MUST work.'),
    ).toThrow(/missing closing/);
  });

  it('rejects [test: prefix with empty file', () => {
    expect(() =>
      parseOneClause('[test: ::name] The system MUST work.'),
    ).toThrow(/empty file/);
  });

  it('rejects [test: prefix with empty name', () => {
    expect(() =>
      parseOneClause('[test: tests/foo.test.ts::] The system MUST work.'),
    ).toThrow(/empty name/);
  });

  it('rejects clause combining [semantic] and [test: ...]', () => {
    expect(() =>
      parseOneClause(
        '[semantic][test: tests/foo.test.ts::name] The system MUST work.',
      ),
    ).toThrow(/cannot combine \[semantic\] and \[test:/);
    expect(() =>
      parseOneClause(
        '[test: tests/foo.test.ts::name][semantic] The system MUST work.',
      ),
    ).toThrow(/cannot combine \[semantic\] and \[test:/);
  });

  it('[semantic] alone leaves testBinding undefined', () => {
    const c = parseOneClause('[semantic] The key MUST be X.');
    expect(c.semantic).toBe(true);
    expect(c.testBinding).toBeUndefined();
  });

  it('no prefix yields semantic=false and testBinding=undefined', () => {
    const c = parseOneClause('The system MUST work.');
    expect(c.semantic).toBe(false);
    expect(c.testBinding).toBeUndefined();
  });

  it('records 1-based line numbers for each clause', () => {
    const src = `id: example
title: Example
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - First clause MUST be tested.
  - Second clause MUST also be tested.
`;
    const r = parseTnl(src);
    expect(r.behaviors[0]!.line).toBe(11);
    expect(r.behaviors[1]!.line).toBe(12);
  });

  it('supports multi-line clauses via indented continuation', () => {
    const src = `id: example
title: Example
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - The system MUST handle long clauses that wrap
    across multiple lines and still parse as one.
`;
    const r = parseTnl(src);
    expect(r.behaviors).toHaveLength(1);
    expect(r.behaviors[0]!.text).toBe(
      'The system MUST handle long clauses that wrap across multiple lines and still parse as one.',
    );
  });
});

describe('parseTnl — comments and line endings', () => {
  it('strips # comments', () => {
    const src = `id: example   # a comment
title: Example
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.   # trailing comment on prose

behaviors:
  - The system MUST work.   # inline comment
`;
    const r = parseTnl(src);
    expect(r.machine.id).toBe('example');
    expect(r.behaviors[0]!.text).toBe('The system MUST work.');
  });

  it('treats comment-only lines as blank', () => {
    const src = `# top-of-file comment
id: example
title: Example
scope: feature
owners: [@jana]
paths: [src/foo.ts]
# between fields
intent:
  Intent.

behaviors:
  - The system MUST work.
`;
    expect(() => parseTnl(src)).not.toThrow();
  });

  it('handles CRLF line endings', () => {
    const src = MINIMAL_FEATURE.replace(/\n/g, '\r\n');
    const r = parseTnl(src);
    expect(r.machine.id).toBe('example');
    expect(r.behaviors).toHaveLength(1);
  });
});

describe('parseTnlFile', () => {
  it('reads from disk and parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tnl-parser-test-'));
    const path = join(dir, 'example.tnl');
    writeFileSync(path, MINIMAL_FEATURE, 'utf8');
    try {
      const r = parseTnlFile(path);
      expect(r.machine.id).toBe('example');
      expect(r.sourcePath).toBe(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces id/filename mismatch from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tnl-parser-test-'));
    const path = join(dir, 'other.tnl');
    writeFileSync(path, MINIMAL_FEATURE, 'utf8');
    try {
      expect(() => parseTnlFile(path)).toThrow(/does not match filename stem/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TnlParseError', () => {
  it('has a line property', () => {
    try {
      parseTnl(MINIMAL_FEATURE.replace('id: example', 'id: BAD_ID'));
    } catch (e) {
      expect(e).toBeInstanceOf(TnlParseError);
      expect((e as TnlParseError).line).toBeGreaterThan(0);
      expect((e as TnlParseError).message).toMatch(/^line \d+:/);
      return;
    }
    throw new Error('expected parse error');
  });

  it('omits line number when line is 0', () => {
    try {
      parseTnl(MINIMAL_FEATURE.replace('intent:\n  One-line intent.\n\n', ''));
    } catch (e) {
      expect(e).toBeInstanceOf(TnlParseError);
      expect((e as TnlParseError).line).toBe(0);
      expect((e as TnlParseError).message).not.toMatch(/^line /);
      return;
    }
    throw new Error('expected parse error');
  });
});
