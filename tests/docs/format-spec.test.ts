import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTnl } from '../../src/parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const specPath = resolve(repoRoot, 'docs', 'tnl-format.md');

describe('format-spec — docs/tnl-format.md', () => {
  it('exists at docs/tnl-format.md', () => {
    expect(existsSync(specPath)).toBe(true);
  });

  const spec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : '';

  it('contains all required section headings in order', () => {
    const required = [
      'Overview',
      'File layout',
      'Machine zone fields',
      'Contract zone',
      'Clause classification',
      'Human zone',
      'Scope',
      'Dependencies',
      'Sidecar',
      'Verification tiers',
      'Edit-vs-new guidance',
      'Examples',
    ];
    let cursor = 0;
    for (const heading of required) {
      const idx = spec.indexOf(heading, cursor);
      expect(idx, `heading "${heading}" missing or out of order`).toBeGreaterThan(-1);
      cursor = idx + heading.length;
    }
  });

  it('documents RFC 2119 keywords', () => {
    expect(spec).toContain('MUST');
    expect(spec).toContain('MUST NOT');
    expect(spec).toContain('SHOULD');
    expect(spec).toContain('SHOULD NOT');
    expect(spec).toContain('MAY');
  });

  it('documents the four clause classes by name', () => {
    expect(spec).toContain('structural');
    expect(spec).toContain('test-backed');
    expect(spec).toContain('semantic');
    expect(spec).toContain('advisory');
  });

  it('documents the [semantic] and [test:] prefixes and their mutual exclusion', () => {
    expect(spec).toContain('[semantic]');
    expect(spec).toContain('[test:');
    expect(spec.toLowerCase()).toContain('mutually exclusive');
  });

  it('cross-references parser, resolver, and verifier source files', () => {
    expect(spec).toContain('src/parser.ts');
    expect(spec).toContain('src/resolver.ts');
    expect(spec).toContain('src/verifier.ts');
  });

  it('documents the sidecar shape including unit_hash, class, resolved_at', () => {
    expect(spec).toContain('unit_hash');
    expect(spec).toContain('resolved_at');
    expect(spec).toContain('class');
    expect(spec).toContain('tnl/.resolved/');
  });

  it('every fenced ```tnl code block parses via parseTnl()', () => {
    const fenceRe = /```tnl\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    for (const m of spec.matchAll(fenceRe)) {
      blocks.push(m[1]!);
    }
    expect(blocks.length, 'spec has at least one ```tnl code block').toBeGreaterThan(0);
    for (const [i, body] of blocks.entries()) {
      expect(() => parseTnl(body), `tnl fenced block #${i + 1} must parse`).not.toThrow();
    }
  });

  it('Examples section includes at least one scope: feature and one scope: repo-wide block', () => {
    const fenceRe = /```tnl\n([\s\S]*?)```/g;
    const blocks: string[] = [];
    for (const m of spec.matchAll(fenceRe)) {
      blocks.push(m[1]!);
    }
    const hasFeature = blocks.some((b) => /^\s*scope:\s*feature\s*$/m.test(b));
    const hasRepoWide = blocks.some((b) => /^\s*scope:\s*repo-wide\s*$/m.test(b));
    expect(hasFeature, 'at least one fenced block has scope: feature').toBe(true);
    expect(hasRepoWide, 'at least one fenced block has scope: repo-wide').toBe(true);
  });
});
