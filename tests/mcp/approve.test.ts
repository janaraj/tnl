import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApproveTnlDiffTool } from '../../src/mcp/tools/approve.js';
import { createProposeTnlDiffTool } from '../../src/mcp/tools/propose.js';
import { mcpTools } from '../../src/mcp/tools.js';

const FOO_CONTENT = `id: foo
title: Foo
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - The system MUST work.
`;

const BAR_CONTENT = `id: bar
title: Bar
scope: feature
owners: [@jana]
paths: [src/bar.ts]

intent:
  Intent.

behaviors:
  - The system MUST work.
`;

interface ChangeInput {
  id: string;
  action: 'create' | 'update';
  content: string;
}

async function propose(
  cwd: string,
  intent: string,
  changes: ChangeInput[],
): Promise<string> {
  const tool = createProposeTnlDiffTool({ cwd });
  const result = await tool.handler({ intent, changes });
  if (result.isError) throw new Error(result.content[0]!.text);
  return (JSON.parse(result.content[0]!.text) as { diff_id: string }).diff_id;
}

describe('approve_tnl_diff MCP tool', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-approve-'));
    mkdirSync(join(cwd, 'tnl'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exposes the expected name and inputSchema shape', () => {
    const tool = createApproveTnlDiffTool({ cwd });
    expect(tool.name).toBe('approve_tnl_diff');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: { diff_id: { type: 'string', minLength: 1 } },
      required: ['diff_id'],
    });
  });

  it('applies a create: writes tnl file + sidecar, removes staging', async () => {
    const diffId = await propose(cwd, 'Add foo', [
      { id: 'foo', action: 'create', content: FOO_CONTENT },
    ]);
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler({ diff_id: diffId });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as {
      diff_id: string;
      applied: boolean;
      changes: Array<{ id: string; action: string; path: string; sidecar_path: string }>;
    };
    expect(payload.diff_id).toBe(diffId);
    expect(payload.applied).toBe(true);
    expect(payload.changes).toEqual([
      {
        id: 'foo',
        action: 'create',
        path: 'tnl/foo.tnl',
        sidecar_path: 'tnl/.resolved/foo.meta.json',
      },
    ]);
    expect(existsSync(join(cwd, 'tnl', 'foo.tnl'))).toBe(true);
    expect(readFileSync(join(cwd, 'tnl', 'foo.tnl'), 'utf8')).toBe(FOO_CONTENT);
    expect(existsSync(join(cwd, 'tnl', '.resolved', 'foo.meta.json'))).toBe(true);
    expect(existsSync(join(cwd, 'tnl', '.staging', `${diffId}.json`))).toBe(false);
  });

  it('applies an update: overwrites file, regenerates sidecar', async () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), 'original\n', 'utf8');
    const diffId = await propose(cwd, 'Update foo', [
      { id: 'foo', action: 'update', content: FOO_CONTENT },
    ]);
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler({ diff_id: diffId });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(cwd, 'tnl', 'foo.tnl'), 'utf8')).toBe(FOO_CONTENT);
    expect(existsSync(join(cwd, 'tnl', '.resolved', 'foo.meta.json'))).toBe(true);
    expect(existsSync(join(cwd, 'tnl', '.staging', `${diffId}.json`))).toBe(false);
  });

  it('applies a multi-change proposal and records each in the response', async () => {
    const diffId = await propose(cwd, 'Add foo and bar', [
      { id: 'foo', action: 'create', content: FOO_CONTENT },
      { id: 'bar', action: 'create', content: BAR_CONTENT },
    ]);
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler({ diff_id: diffId });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as {
      changes: Array<{ id: string }>;
    };
    expect(payload.changes.map((c) => c.id)).toEqual(['foo', 'bar']);
    expect(existsSync(join(cwd, 'tnl', 'foo.tnl'))).toBe(true);
    expect(existsSync(join(cwd, 'tnl', 'bar.tnl'))).toBe(true);
    expect(existsSync(join(cwd, 'tnl', '.resolved', 'foo.meta.json'))).toBe(true);
    expect(existsSync(join(cwd, 'tnl', '.resolved', 'bar.meta.json'))).toBe(true);
  });

  it('returns isError for unknown diff_id', async () => {
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler({ diff_id: '0000000000000000' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('unknown diff_id');
  });

  it('revalidation failure: create when file appeared since propose', async () => {
    const diffId = await propose(cwd, 'Add foo', [
      { id: 'foo', action: 'create', content: FOO_CONTENT },
    ]);
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), 'raced\n', 'utf8');
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler({ diff_id: diffId });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('revalidation failed');
    expect(readFileSync(join(cwd, 'tnl', 'foo.tnl'), 'utf8')).toBe('raced\n');
    expect(existsSync(join(cwd, 'tnl', '.staging', `${diffId}.json`))).toBe(true);
  });

  it('revalidation failure: update when file deleted since propose', async () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), 'existing\n', 'utf8');
    const diffId = await propose(cwd, 'Update foo', [
      { id: 'foo', action: 'update', content: FOO_CONTENT },
    ]);
    rmSync(join(cwd, 'tnl', 'foo.tnl'));
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler({ diff_id: diffId });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('revalidation failed');
    expect(existsSync(join(cwd, 'tnl', '.staging', `${diffId}.json`))).toBe(true);
  });

  it('double-approve of the same diff_id: second fails with unknown-diff-id', async () => {
    const diffId = await propose(cwd, 'Add foo', [
      { id: 'foo', action: 'create', content: FOO_CONTENT },
    ]);
    const tool = createApproveTnlDiffTool({ cwd });
    const first = await tool.handler({ diff_id: diffId });
    expect(first.isError).toBeUndefined();
    const second = await tool.handler({ diff_id: diffId });
    expect(second.isError).toBe(true);
    expect(second.content[0]!.text).toContain('unknown diff_id');
  });

  it('returns isError when args is not an object', async () => {
    const tool = createApproveTnlDiffTool({ cwd });
    const result = await tool.handler('bad');
    expect(result.isError).toBe(true);
  });

  it("returns isError when 'diff_id' is missing / empty / wrong-type", async () => {
    const tool = createApproveTnlDiffTool({ cwd });
    expect((await tool.handler({})).isError).toBe(true);
    expect((await tool.handler({ diff_id: '' })).isError).toBe(true);
    expect((await tool.handler({ diff_id: 42 })).isError).toBe(true);
  });

  it('registers approve_tnl_diff in mcpTools on module import', () => {
    expect(mcpTools.has('approve_tnl_diff')).toBe(true);
  });
});
