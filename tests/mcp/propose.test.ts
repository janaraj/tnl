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

describe('propose_tnl_diff MCP tool', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-propose-'));
    mkdirSync(join(cwd, 'tnl'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('exposes the expected name and inputSchema shape', () => {
    const tool = createProposeTnlDiffTool({ cwd });
    expect(tool.name).toBe('propose_tnl_diff');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        intent: { type: 'string', minLength: 1 },
        changes: { type: 'array', minItems: 1 },
      },
      required: ['intent', 'changes'],
    });
  });

  it('returns diff_id and stages for a valid create', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'Add foo feature',
      changes: [{ id: 'foo', action: 'create', content: FOO_CONTENT }],
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.diff_id).toMatch(/^[0-9a-f]{16}$/);
    expect(payload.intent).toBe('Add foo feature');
    expect(payload.change_count).toBe(1);
    expect(
      existsSync(join(cwd, 'tnl', '.staging', `${payload.diff_id}.json`)),
    ).toBe(true);
    expect(existsSync(join(cwd, 'tnl', 'foo.tnl'))).toBe(false);
  });

  it('returns diff_id and stages for a valid update without touching the existing file', async () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), 'original content', 'utf8');
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'Update foo',
      changes: [{ id: 'foo', action: 'update', content: FOO_CONTENT }],
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.diff_id).toMatch(/^[0-9a-f]{16}$/);
    expect(readFileSync(join(cwd, 'tnl', 'foo.tnl'), 'utf8')).toBe(
      'original content',
    );
  });

  it('returns isError when content fails to parse', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'x',
      changes: [
        { id: 'foo', action: 'create', content: 'not a valid tnl file' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'foo' is invalid");
  });

  it('returns isError when content id does not match declared id', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'x',
      changes: [{ id: 'bar', action: 'create', content: FOO_CONTENT }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('does not match filename stem');
  });

  it("returns isError when action='create' but file already exists", async () => {
    writeFileSync(join(cwd, 'tnl', 'foo.tnl'), 'exists', 'utf8');
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'x',
      changes: [{ id: 'foo', action: 'create', content: FOO_CONTENT }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('already exists');
  });

  it("returns isError when action='update' but file does not exist", async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'x',
      changes: [{ id: 'foo', action: 'update', content: FOO_CONTENT }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('does not exist');
  });

  it('returns isError on duplicate ids within a proposal', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'x',
      changes: [
        { id: 'foo', action: 'create', content: FOO_CONTENT },
        { id: 'foo', action: 'create', content: FOO_CONTENT },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('duplicate id');
  });

  it("returns isError when action is not 'create' or 'update'", async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler({
      intent: 'x',
      changes: [{ id: 'foo', action: 'delete', content: FOO_CONTENT }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'create' or 'update'");
  });

  it('returns isError on path-traversal / non-kebab id', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    for (const badId of ['../evil', 'sub/foo', 'Foo', 'foo_bar', '']) {
      const result = await tool.handler({
        intent: 'x',
        changes: [{ id: badId, action: 'create', content: FOO_CONTENT }],
      });
      expect(result.isError).toBe(true);
    }
  });

  it('returns isError when args is not an object', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const result = await tool.handler('bad');
    expect(result.isError).toBe(true);
  });

  it("returns isError when 'intent' is missing / empty / wrong-type", async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    expect(
      (await tool.handler({ changes: [] })).isError,
    ).toBe(true);
    expect(
      (await tool.handler({ intent: '', changes: [] })).isError,
    ).toBe(true);
    expect(
      (await tool.handler({ intent: 42, changes: [] })).isError,
    ).toBe(true);
  });

  it("returns isError when 'changes' is missing / empty / wrong-type", async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    expect((await tool.handler({ intent: 'x' })).isError).toBe(true);
    expect(
      (await tool.handler({ intent: 'x', changes: [] })).isError,
    ).toBe(true);
    expect(
      (await tool.handler({ intent: 'x', changes: 'nope' })).isError,
    ).toBe(true);
  });

  it('returns isError when change has wrong shape', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    expect(
      (await tool.handler({ intent: 'x', changes: ['string'] })).isError,
    ).toBe(true);
    expect(
      (
        await tool.handler({
          intent: 'x',
          changes: [{ action: 'create', content: FOO_CONTENT }],
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await tool.handler({
          intent: 'x',
          changes: [{ id: 'foo', action: 'create' }],
        })
      ).isError,
    ).toBe(true);
  });

  it('does not stage anything when any change fails validation (all-or-nothing)', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    const stagingDir = join(cwd, 'tnl', '.staging');
    const result = await tool.handler({
      intent: 'x',
      changes: [
        { id: 'foo', action: 'create', content: FOO_CONTENT },
        { id: 'bar', action: 'update', content: BAR_CONTENT },
      ],
    });
    expect(result.isError).toBe(true);
    expect(existsSync(stagingDir)).toBe(false);
    expect(existsSync(join(cwd, 'tnl', 'foo.tnl'))).toBe(false);
  });

  it('does not write target tnl/*.tnl files — only staging', async () => {
    const tool = createProposeTnlDiffTool({ cwd });
    await tool.handler({
      intent: 'x',
      changes: [{ id: 'foo', action: 'create', content: FOO_CONTENT }],
    });
    expect(existsSync(join(cwd, 'tnl', 'foo.tnl'))).toBe(false);
  });

  it('registers propose_tnl_diff in mcpTools on module import', () => {
    expect(mcpTools.has('propose_tnl_diff')).toBe(true);
  });
});
