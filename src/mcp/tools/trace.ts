import { mcpTools, type McpTool, type McpToolResult } from '../tools.js';

interface StoredEvent {
  type: string;
  data?: unknown;
  timestamp: string;
  [key: string]: unknown;
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createTraceTool(): McpTool {
  const store: Map<string, StoredEvent[]> = new Map();

  return {
    name: 'trace',
    description:
      'Record or read session events documenting how TNL was used. Pass `event` to record; omit it to read.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          minLength: 1,
          description: 'Opaque session identifier chosen by the caller.',
        },
        event: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            data: {},
          },
          required: ['type'],
          description:
            'If present, append this event to the session log. Server overwrites any caller-supplied timestamp.',
        },
      },
      required: ['session_id'],
    },
    handler: async (args) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return errorResult('trace: arguments must be an object');
      }
      const rec = args as Record<string, unknown>;
      const sessionId = rec.session_id;
      if (typeof sessionId !== 'string') {
        return errorResult("trace: 'session_id' must be a string");
      }
      if (sessionId.length === 0) {
        return errorResult("trace: 'session_id' must be non-empty");
      }

      const event = rec.event;
      if (event === undefined) {
        const events = store.get(sessionId) ?? [];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ session_id: sessionId, events }),
            },
          ],
        };
      }

      if (typeof event !== 'object' || event === null || Array.isArray(event)) {
        return errorResult("trace: 'event' must be an object");
      }
      const eventRec = event as Record<string, unknown>;
      if (typeof eventRec.type !== 'string') {
        return errorResult("trace: 'event.type' must be a string");
      }

      const stored: StoredEvent = {
        type: eventRec.type,
        timestamp: new Date().toISOString(),
      };
      if (eventRec.data !== undefined) {
        stored.data = eventRec.data;
      }

      const existing = store.get(sessionId) ?? [];
      existing.push(stored);
      store.set(sessionId, existing);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              session_id: sessionId,
              recorded: true,
              count: existing.length,
            }),
          },
        ],
      };
    },
  };
}

mcpTools.set('trace', createTraceTool());
