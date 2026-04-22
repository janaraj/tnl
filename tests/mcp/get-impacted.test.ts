import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGetImpactedTool } from '../../src/mcp/tools/get-impacted.js';
import { mcpTools } from '../../src/mcp/tools.js';

const REPO_WIDE = `id: workflow
title: Workflow
scope: repo-wide
owners: [@jana]

intent:
  Intent.

behaviors:
  - The agent MUST follow rules.
`;

const FEATURE = `id: foo
title: Foo feature
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - The system MUST work.
`;

describe('get_impacted_tnls MCP tool', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-mcp-get-impacted-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exposes the expected name and inputSchema shape', () => {
    const tool = createGetImpactedTool({ cwd });
    expect(tool.name).toBe('get_impacted_tnls');
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

  it('returns id/title/scope as JSON on a valid call', async () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'workflow.tnl'), REPO_WIDE, 'utf8');
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE, 'utf8');
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload).toEqual([
      { id: 'workflow', title: 'Workflow', scope: 'repo-wide' },
      { id: 'foo', title: 'Foo feature', scope: 'feature' },
    ]);
  });

  it('does not include absolute paths or sourcePath in the response', async () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE, 'utf8');
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.content[0]!.text).not.toContain(cwd);
    expect(result.content[0]!.text).not.toContain('sourcePath');
  });

  it('returns isError when args is not an object', async () => {
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler('not an object');
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be an object');
  });

  it("returns isError when 'paths' is missing", async () => {
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'paths' is required");
  });

  it("returns isError when 'paths' is not an array", async () => {
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: 'src/foo.ts' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("must be an array");
  });

  it("returns isError when 'paths' is empty", async () => {
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be non-empty');
  });

  it("returns isError when 'paths' contains a non-string element", async () => {
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts', 42] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be a string');
  });

  it('returns isError when the underlying impact module throws (no tnl/ dir)', async () => {
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('get_impacted_tnls:');
  });

  it('uses the injected cwd when provided', async () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), FEATURE, 'utf8');
    const tool = createGetImpactedTool({ cwd });
    const result = await tool.handler({ paths: ['src/foo.ts'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as Array<{
      id: string;
    }>;
    expect(payload.map((x) => x.id)).toContain('foo');
  });

  it('registers get_impacted_tnls in mcpTools on module import', () => {
    expect(mcpTools.has('get_impacted_tnls')).toBe(true);
    expect(mcpTools.get('get_impacted_tnls')!.name).toBe('get_impacted_tnls');
  });
});
