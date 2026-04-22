import { describe, expect, it } from 'vitest';
import {
  handleCallTool,
  handleListTools,
  type McpTool,
} from '../../src/mcp/tools.js';

function tool(
  name: string,
  handler: McpTool['handler'] = () => ({
    content: [{ type: 'text', text: 'ok' }],
  }),
): McpTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    handler,
  };
}

describe('mcpTools registry', () => {
  it('supports register-and-retrieve round trip', () => {
    const registry = new Map<string, McpTool>();
    const t = tool('foo');
    registry.set(t.name, t);
    expect(registry.get('foo')).toBe(t);
  });
});

describe('handleListTools', () => {
  it('returns name, description, and inputSchema for each registered tool', () => {
    const registry = new Map<string, McpTool>();
    registry.set('foo', tool('foo'));
    registry.set('bar', tool('bar'));
    const result = handleListTools(registry);
    expect(result.tools).toHaveLength(2);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['bar', 'foo']);
    for (const entry of result.tools) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('inputSchema');
    }
  });

  it('returns an empty tools array when registry is empty', () => {
    const result = handleListTools(new Map());
    expect(result.tools).toEqual([]);
  });
});

describe('handleCallTool', () => {
  it('dispatches to the registered handler and returns its result', async () => {
    const registry = new Map<string, McpTool>();
    registry.set(
      'echo',
      tool('echo', (args) => ({
        content: [{ type: 'text', text: JSON.stringify(args) }],
      })),
    );
    const result = await handleCallTool(
      { params: { name: 'echo', arguments: { a: 1 } } },
      registry,
    );
    expect(result.content[0]!.text).toBe('{"a":1}');
    expect(result.isError).toBeUndefined();
  });

  it('returns isError=true with the tool name surfaced for unknown tools', async () => {
    const result = await handleCallTool(
      { params: { name: 'nonesuch' } },
      new Map(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('nonesuch');
  });

  it('converts a synchronously-throwing handler to isError=true', async () => {
    const registry = new Map<string, McpTool>();
    registry.set(
      'boom',
      tool('boom', () => {
        throw new Error('sync failure');
      }),
    );
    const result = await handleCallTool(
      { params: { name: 'boom' } },
      registry,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('sync failure');
  });

  it('converts an async-rejecting handler to isError=true', async () => {
    const registry = new Map<string, McpTool>();
    registry.set(
      'reject',
      tool('reject', async () => {
        throw new Error('async failure');
      }),
    );
    const result = await handleCallTool(
      { params: { name: 'reject' } },
      registry,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('async failure');
  });

  it('awaits a handler that returns a promise and passes through the result', async () => {
    const registry = new Map<string, McpTool>();
    registry.set(
      'async-ok',
      tool('async-ok', async () => ({
        content: [{ type: 'text', text: 'done' }],
      })),
    );
    const result = await handleCallTool(
      { params: { name: 'async-ok' } },
      registry,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('done');
  });
});
