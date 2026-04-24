import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpTools, type McpTool, type McpToolResult } from '../tools.js';

export interface RetrieveTnlToolOptions {
  cwd?: string;
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function isPathTraversal(id: string): boolean {
  return (
    id === '' ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\')
  );
}

export function createRetrieveTnlTool(
  options: RetrieveTnlToolOptions = {},
): McpTool {
  const cwd = options.cwd ?? process.cwd();
  return {
    name: 'retrieve_tnl',
    title: 'Retrieve TNL',
    description:
      'Return the verbatim content of TNL units identified by id. Ids with no matching file are listed in notFound.',
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'TNL unit ids to fetch.',
        },
      },
      required: ['ids'],
    },
    handler: async (args) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return errorResult("retrieve_tnl: arguments must be an object with an 'ids' array");
      }
      const rec = args as Record<string, unknown>;
      const ids = rec.ids;
      if (ids === undefined) {
        return errorResult("retrieve_tnl: 'ids' is required");
      }
      if (!Array.isArray(ids)) {
        return errorResult("retrieve_tnl: 'ids' must be an array");
      }
      if (ids.length === 0) {
        return errorResult("retrieve_tnl: 'ids' must be non-empty");
      }
      const stringIds: string[] = [];
      for (const id of ids) {
        if (typeof id !== 'string') {
          return errorResult("retrieve_tnl: every element of 'ids' must be a string");
        }
        stringIds.push(id);
      }

      const tnlDir = join(cwd, 'tnl');
      if (!existsSync(tnlDir)) {
        return errorResult(
          `retrieve_tnl: no tnl/ directory in ${cwd}. Run \`tnl init\` first.`,
        );
      }

      const seen = new Set<string>();
      const orderedIds: string[] = [];
      for (const id of stringIds) {
        if (!seen.has(id)) {
          seen.add(id);
          orderedIds.push(id);
        }
      }

      const tnls: Array<{ id: string; content: string }> = [];
      const notFound: string[] = [];
      for (const id of orderedIds) {
        if (isPathTraversal(id)) {
          notFound.push(id);
          continue;
        }
        const filePath = join(tnlDir, `${id}.tnl`);
        try {
          const content = readFileSync(filePath, 'utf8');
          tnls.push({ id, content });
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code === 'ENOENT' || err.code === 'EISDIR') {
            notFound.push(id);
            continue;
          }
          return errorResult(`retrieve_tnl: ${err.message}`);
        }
      }

      return {
        content: [
          { type: 'text', text: JSON.stringify({ tnls, notFound }) },
        ],
      };
    },
  };
}

mcpTools.set('retrieve_tnl', createRetrieveTnlTool());
