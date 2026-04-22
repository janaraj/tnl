import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseTnl } from '../../parser.js';
import { stageDiff, type Change } from '../../staging.js';
import { mcpTools, type McpTool, type McpToolResult } from '../tools.js';

export interface ProposeToolOptions {
  cwd?: string;
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

const ID_RE = /^[a-z][a-z0-9-]*$/;

export function createProposeTnlDiffTool(
  options: ProposeToolOptions = {},
): McpTool {
  const cwd = options.cwd ?? process.cwd();
  return {
    name: 'propose_tnl_diff',
    description:
      'Stage a proposed TNL change (batch of creates and updates) for human review. Returns a diff_id for later approve_tnl_diff.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          minLength: 1,
          description: 'Plain-English description of what the proposal is for.',
        },
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              action: { type: 'string', enum: ['create', 'update'] },
              content: { type: 'string' },
            },
            required: ['id', 'action', 'content'],
          },
          description: 'Ordered list of creates/updates.',
        },
      },
      required: ['intent', 'changes'],
    },
    handler: async (args) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return errorResult('propose_tnl_diff: arguments must be an object');
      }
      const rec = args as Record<string, unknown>;
      const intent = rec.intent;
      if (typeof intent !== 'string') {
        return errorResult("propose_tnl_diff: 'intent' must be a string");
      }
      if (intent.length === 0) {
        return errorResult("propose_tnl_diff: 'intent' must be non-empty");
      }
      const changes = rec.changes;
      if (!Array.isArray(changes)) {
        return errorResult("propose_tnl_diff: 'changes' must be an array");
      }
      if (changes.length === 0) {
        return errorResult("propose_tnl_diff: 'changes' must be non-empty");
      }

      const normalized: Change[] = [];
      const seenIds = new Set<string>();
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        if (typeof c !== 'object' || c === null || Array.isArray(c)) {
          return errorResult(`propose_tnl_diff: changes[${i}] must be an object`);
        }
        const ch = c as Record<string, unknown>;
        if (typeof ch.id !== 'string') {
          return errorResult(`propose_tnl_diff: changes[${i}].id must be a string`);
        }
        if (!ID_RE.test(ch.id)) {
          return errorResult(
            `propose_tnl_diff: changes[${i}].id '${ch.id}' must be kebab-case (^[a-z][a-z0-9-]*$)`,
          );
        }
        if (ch.action !== 'create' && ch.action !== 'update') {
          return errorResult(
            `propose_tnl_diff: changes[${i}].action must be 'create' or 'update' (got ${JSON.stringify(ch.action)})`,
          );
        }
        if (typeof ch.content !== 'string') {
          return errorResult(
            `propose_tnl_diff: changes[${i}].content must be a string`,
          );
        }
        if (seenIds.has(ch.id)) {
          return errorResult(
            `propose_tnl_diff: duplicate id '${ch.id}' within proposal`,
          );
        }
        seenIds.add(ch.id);
        normalized.push({
          id: ch.id,
          action: ch.action,
          content: ch.content,
        });
      }

      for (const change of normalized) {
        try {
          parseTnl(change.content, `tnl/${change.id}.tnl`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResult(
            `propose_tnl_diff: content for '${change.id}' is invalid: ${msg}`,
          );
        }

        const targetPath = join(cwd, 'tnl', `${change.id}.tnl`);
        const exists = existsSync(targetPath);
        if (change.action === 'create' && exists) {
          return errorResult(
            `propose_tnl_diff: action 'create' but tnl/${change.id}.tnl already exists`,
          );
        }
        if (change.action === 'update' && !exists) {
          return errorResult(
            `propose_tnl_diff: action 'update' but tnl/${change.id}.tnl does not exist`,
          );
        }
      }

      try {
        const staged = await stageDiff(
          { cwd },
          { intent, changes: normalized },
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                diff_id: staged.diff_id,
                intent: staged.intent,
                change_count: staged.changes.length,
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`propose_tnl_diff: ${msg}`);
      }
    },
  };
}

mcpTools.set('propose_tnl_diff', createProposeTnlDiffTool());
