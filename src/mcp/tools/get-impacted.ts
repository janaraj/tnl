import { getImpactedTnls } from '../../impact.js';
import { mcpTools, type McpTool, type McpToolResult } from '../tools.js';

export interface GetImpactedToolOptions {
  cwd?: string;
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createGetImpactedTool(
  options: GetImpactedToolOptions = {},
): McpTool {
  const cwd = options.cwd ?? process.cwd();
  return {
    name: 'get_impacted_tnls',
    description:
      'Return TNL units whose declared paths overlap with any of the given code paths. Repo-wide units are always included.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Code paths the agent intends to edit.',
        },
      },
      required: ['paths'],
    },
    handler: async (args) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return errorResult("get_impacted_tnls: arguments must be an object with a 'paths' array");
      }
      const rec = args as Record<string, unknown>;
      const paths = rec.paths;
      if (paths === undefined) {
        return errorResult("get_impacted_tnls: 'paths' is required");
      }
      if (!Array.isArray(paths)) {
        return errorResult("get_impacted_tnls: 'paths' must be an array");
      }
      if (paths.length === 0) {
        return errorResult("get_impacted_tnls: 'paths' must be non-empty");
      }
      const stringPaths: string[] = [];
      for (const p of paths) {
        if (typeof p !== 'string') {
          return errorResult("get_impacted_tnls: every element of 'paths' must be a string");
        }
        stringPaths.push(p);
      }

      try {
        const impacted = getImpactedTnls(stringPaths, { cwd });
        const payload = impacted.map((u) => ({
          id: u.id,
          title: u.title,
          scope: u.scope,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`get_impacted_tnls: ${msg}`);
      }
    },
  };
}

mcpTools.set('get_impacted_tnls', createGetImpactedTool());
