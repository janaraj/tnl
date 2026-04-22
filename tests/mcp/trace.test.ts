import { describe, expect, it } from 'vitest';
import { createTraceTool } from '../../src/mcp/tools/trace.js';
import { mcpTools } from '../../src/mcp/tools.js';

interface RecordedEvent {
  type: string;
  data?: unknown;
  timestamp: string;
}

interface ReadPayload {
  session_id: string;
  events: RecordedEvent[];
}

interface WritePayload {
  session_id: string;
  recorded: true;
  count: number;
}

describe('trace MCP tool', () => {
  it('exposes the expected name and inputSchema shape', () => {
    const tool = createTraceTool();
    expect(tool.name).toBe('trace');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        session_id: { type: 'string', minLength: 1 },
        event: {
          type: 'object',
          required: ['type'],
        },
      },
      required: ['session_id'],
    });
  });

  it('records an event and returns recorded: true with count', async () => {
    const tool = createTraceTool();
    const result = await tool.handler({
      session_id: 'abc',
      event: { type: 'retrieval', data: { unit: 'parser' } },
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as WritePayload;
    expect(payload).toEqual({ session_id: 'abc', recorded: true, count: 1 });
  });

  it('read mode returns empty events for a never-used session_id', async () => {
    const tool = createTraceTool();
    const result = await tool.handler({ session_id: 'never-used' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    expect(payload).toEqual({ session_id: 'never-used', events: [] });
  });

  it('record-then-read round trip returns the recorded event', async () => {
    const tool = createTraceTool();
    await tool.handler({
      session_id: 'x',
      event: { type: 'cited', data: { clause: 'L-1' } },
    });
    const result = await tool.handler({ session_id: 'x' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    expect(payload.session_id).toBe('x');
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      type: 'cited',
      data: { clause: 'L-1' },
    });
    expect(typeof payload.events[0]!.timestamp).toBe('string');
  });

  it('preserves append order across multiple events', async () => {
    const tool = createTraceTool();
    await tool.handler({ session_id: 's', event: { type: 'first' } });
    await tool.handler({ session_id: 's', event: { type: 'second' } });
    await tool.handler({ session_id: 's', event: { type: 'third' } });
    const result = await tool.handler({ session_id: 's' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    expect(payload.events.map((e) => e.type)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('isolates events across distinct session_id values', async () => {
    const tool = createTraceTool();
    await tool.handler({ session_id: 'A', event: { type: 'a-event' } });
    await tool.handler({ session_id: 'B', event: { type: 'b-event' } });
    const a = JSON.parse((await tool.handler({ session_id: 'A' })).content[0]!.text) as ReadPayload;
    const b = JSON.parse((await tool.handler({ session_id: 'B' })).content[0]!.text) as ReadPayload;
    expect(a.events.map((e) => e.type)).toEqual(['a-event']);
    expect(b.events.map((e) => e.type)).toEqual(['b-event']);
  });

  it('generates server-side ISO 8601 timestamps', async () => {
    const tool = createTraceTool();
    await tool.handler({ session_id: 't', event: { type: 'x' } });
    const result = await tool.handler({ session_id: 't' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    expect(payload.events[0]!.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('ignores caller-supplied timestamp in the event body', async () => {
    const tool = createTraceTool();
    await tool.handler({
      session_id: 't',
      event: { type: 'x', timestamp: '1999-01-01T00:00:00.000Z' },
    });
    const result = await tool.handler({ session_id: 't' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    expect(payload.events[0]!.timestamp).not.toBe('1999-01-01T00:00:00.000Z');
    expect(
      new Date(payload.events[0]!.timestamp).getFullYear(),
    ).toBeGreaterThan(2020);
  });

  it('returns isError when args is not an object', async () => {
    const tool = createTraceTool();
    const result = await tool.handler('bad');
    expect(result.isError).toBe(true);
  });

  it("returns isError when 'session_id' is missing", async () => {
    const tool = createTraceTool();
    const result = await tool.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'session_id'");
  });

  it("returns isError when 'session_id' is not a string", async () => {
    const tool = createTraceTool();
    const result = await tool.handler({ session_id: 42 });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('must be a string');
  });

  it("returns isError when 'session_id' is empty", async () => {
    const tool = createTraceTool();
    const result = await tool.handler({ session_id: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('non-empty');
  });

  it("returns isError when 'event' is not an object", async () => {
    const tool = createTraceTool();
    const result = await tool.handler({ session_id: 'x', event: 'string' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'event'");
  });

  it("returns isError when 'event.type' is missing", async () => {
    const tool = createTraceTool();
    const result = await tool.handler({
      session_id: 'x',
      event: { data: 'no type here' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'event.type'");
  });

  it("returns isError when 'event.type' is not a string", async () => {
    const tool = createTraceTool();
    const result = await tool.handler({
      session_id: 'x',
      event: { type: 42 },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'event.type'");
  });

  it('does not mutate state on validation failures', async () => {
    const tool = createTraceTool();
    await tool.handler({});
    await tool.handler({ session_id: '' });
    await tool.handler({ session_id: 'x', event: 'bad' });
    await tool.handler({ session_id: 'x', event: { data: 'no type' } });
    const result = await tool.handler({ session_id: 'x' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    expect(payload.events).toEqual([]);
  });

  it('drops caller-supplied extra fields on the stored event', async () => {
    const tool = createTraceTool();
    await tool.handler({
      session_id: 's',
      event: {
        type: 'x',
        data: { a: 1 },
        extra: 'should-be-dropped',
        another: 42,
      },
    });
    const result = await tool.handler({ session_id: 's' });
    const payload = JSON.parse(result.content[0]!.text) as ReadPayload;
    const event = payload.events[0]!;
    expect(Object.keys(event).sort()).toEqual(['data', 'timestamp', 'type']);
  });

  it('registers trace in mcpTools on module import', () => {
    expect(mcpTools.has('trace')).toBe(true);
    expect(mcpTools.get('trace')!.name).toBe('trace');
  });
});
