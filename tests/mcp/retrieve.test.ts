import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetrieveTnlTool } from '../../src/mcp/tools/retrieve.js';
import { mcpTools } from '../../src/mcp/tools.js';

interface TnlEntry {
  id: string;
  content: string;
}
interface RetrievePayload {
  tnls: TnlEntry[];
  notFound: string[];
}

describe('retrieve_tnl MCP tool', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-mcp-retrieve-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeTnl(id: string, content: string) {
    mkdirSync(join(cwd, 'tnl'), { recursive: true });
    writeFileSync(join(cwd, 'tnl', `${id}.tnl`), content, 'utf8');
  }

  it('exposes the expected name and inputSchema shape', () => {
    const tool = createRetrieveTnlTool({ cwd });
    expect(tool.name).toBe('retrieve_tnl');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
      },
      required: ['ids'],
    });
  });

  it('returns verbatim content for a single existing id', async () => {
    const content = 'id: foo\ntitle: Foo\n\nbody line\n';
    writeTnl('foo', content);
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['foo'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload).toEqual({
      tnls: [{ id: 'foo', content }],
      notFound: [],
    });
  });

  it('preserves input order for multiple ids', async () => {
    writeTnl('a', 'aa\n');
    writeTnl('b', 'bb\n');
    writeTnl('c', 'cc\n');
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['c', 'a', 'b'] });
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(payload.notFound).toEqual([]);
  });

  it('lists unknown ids in notFound without setting isError', async () => {
    writeTnl('foo', 'content\n');
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['foo', 'missing'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls.map((t) => t.id)).toEqual(['foo']);
    expect(payload.notFound).toEqual(['missing']);
  });

  it('deduplicates repeated ids', async () => {
    writeTnl('foo', 'content\n');
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['foo', 'foo', 'foo'] });
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls).toHaveLength(1);
    expect(payload.tnls[0]!.id).toBe('foo');
  });

  it('handles mixed found and missing (preserves order among found)', async () => {
    writeTnl('a', 'aa\n');
    writeTnl('c', 'cc\n');
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['a', 'b', 'c'] });
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls.map((t) => t.id)).toEqual(['a', 'c']);
    expect(payload.notFound).toEqual(['b']);
  });

  it('returns all-unknown ids as empty tnls + populated notFound without isError', async () => {
    mkdirSync(join(cwd, 'tnl'));
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['a', 'b'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls).toEqual([]);
    expect(payload.notFound).toEqual(['a', 'b']);
  });

  it('returns isError when args is not an object', async () => {
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler('bad');
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be an object');
  });

  it("returns isError when 'ids' is missing", async () => {
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'ids' is required");
  });

  it("returns isError when 'ids' is not an array", async () => {
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: 'foo' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be an array');
  });

  it("returns isError when 'ids' is empty", async () => {
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be non-empty');
  });

  it("returns isError when 'ids' contains a non-string element", async () => {
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['foo', 42] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be a string');
  });

  it('returns isError when the tnl/ directory is absent', async () => {
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['foo'] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('no tnl/ directory');
  });

  it('rejects path-traversal ids as notFound and does not read outside tnl/', async () => {
    writeTnl('foo', 'content\n');
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({
      ids: ['../etc/passwd', 'sub/foo', '..\\evil', '..', '.', '', 'foo'],
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls.map((t) => t.id)).toEqual(['foo']);
    for (const traversal of [
      '../etc/passwd',
      'sub/foo',
      '..\\evil',
      '..',
      '.',
      '',
    ]) {
      expect(payload.notFound).toContain(traversal);
    }
  });

  it('registers retrieve_tnl in mcpTools on module import', () => {
    expect(mcpTools.has('retrieve_tnl')).toBe(true);
    expect(mcpTools.get('retrieve_tnl')!.name).toBe('retrieve_tnl');
  });

  it('returns verbatim content byte-for-byte even for malformed TNL', async () => {
    const malformed = 'this is not a valid tnl file\n  and we return it anyway\r\n';
    writeTnl('bad', malformed);
    const tool = createRetrieveTnlTool({ cwd });
    const result = await tool.handler({ ids: ['bad'] });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as RetrievePayload;
    expect(payload.tnls[0]!.content).toBe(malformed);
  });
});
