import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerifyTool } from '../../src/mcp/tools/verify.js';
import { mcpTools } from '../../src/mcp/tools.js';

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

interface FailureEntry {
  kind: 'unit' | 'clause';
  name: string;
  class?: string;
  reason: string;
}

interface VerifyPayload {
  verified: Array<{
    id: string;
    passed: number;
    failed: number;
    unchecked: number;
    failures: FailureEntry[];
  }>;
  errors: Array<{ sourcePath: string; message: string }>;
  summary: {
    total_units: number;
    total_checks: number;
    total_failed: number;
    total_unchecked: number;
    total_errors: number;
  };
}

describe('verify MCP tool', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-mcp-verify-'));
    mkdirSync(join(cwd, 'tnl'));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'foo.ts'), '// foo\n', 'utf8');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exposes the expected name and inputSchema shape', () => {
    const tool = createVerifyTool({ cwd });
    expect(tool.name).toBe('verify');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
      },
      required: ['paths'],
    });
  });

  it('returns verify results for impacted TNLs on a valid call', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as VerifyPayload;
    expect(payload.verified.map((v) => v.id)).toContain('foo');
    expect(payload.summary.total_failed).toBe(0);
    expect(payload.errors).toEqual([]);
  });

  it('includes repo-wide TNLs in the result', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'workflow.tnl'),
      makeTnl({ id: 'workflow', scope: 'repo-wide' }),
      'utf8',
    );
    writeFileSync(
      join(cwd, 'tnl', 'foo.tnl'),
      makeTnl({ id: 'foo', scope: 'feature', paths: ['src/foo.ts'] }),
      'utf8',
    );
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    const payload = JSON.parse(result.content[0]!.text) as VerifyPayload;
    const ids = payload.verified.map((v) => v.id);
    expect(ids).toContain('workflow');
    expect(ids).toContain('foo');
  });

  it('unit-level failures appear in the unit failures array without class, isError unset', async () => {
    writeFileSync(
      join(cwd, 'tnl', 'bad.tnl'),
      makeTnl({ id: 'bad', scope: 'feature', paths: ['src/missing.ts'] }),
      'utf8',
    );
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/missing.ts'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as VerifyPayload;
    const bad = payload.verified.find((v) => v.id === 'bad')!;
    expect(bad.failed).toBeGreaterThan(0);
    const pathsFail = bad.failures.find((f) => f.name === 'paths-exist');
    expect(pathsFail).toBeDefined();
    expect(pathsFail!.kind).toBe('unit');
    expect(pathsFail!.class).toBeUndefined();
    expect(payload.summary.total_failed).toBeGreaterThan(0);
  });

  it('test-binding failures include class: test-backed', async () => {
    mkdirSync(join(cwd, 'tests'));
    writeFileSync(join(cwd, 'tests', 'foo.test.ts'), '// no match\n', 'utf8');
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
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    const payload = JSON.parse(result.content[0]!.text) as VerifyPayload;
    const foo = payload.verified.find((v) => v.id === 'foo')!;
    const testFail = foo.failures.find((f) => f.name === 'L-1');
    expect(testFail).toBeDefined();
    expect(testFail!.class).toBe('test-backed');
    expect(testFail!.kind).toBe('clause');
  });

  it('returns isError when args is not an object', async () => {
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler('bad');
    expect(result.isError).toBe(true);
  });

  it("returns isError when 'paths' is missing", async () => {
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'paths' is required");
  });

  it("returns isError when 'paths' is not an array", async () => {
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: 'foo' });
    expect(result.isError).toBe(true);
  });

  it("returns isError when 'paths' is empty", async () => {
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: [] });
    expect(result.isError).toBe(true);
  });

  it("returns isError when 'paths' contains a non-string", async () => {
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts', 42] });
    expect(result.isError).toBe(true);
  });

  it('returns isError when a malformed .tnl is present in tnl/', async () => {
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), 'not a valid tnl\n', 'utf8');
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.isError).toBe(true);
  });

  it('returns isError when no tnl/ directory exists', async () => {
    rmSync(join(cwd, 'tnl'), { recursive: true, force: true });
    const tool = createVerifyTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.isError).toBe(true);
  });

  it('registers verify in mcpTools on module import', () => {
    expect(mcpTools.has('verify')).toBe(true);
    expect(mcpTools.get('verify')!.name).toBe('verify');
  });
});
