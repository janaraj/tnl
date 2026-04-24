import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTnlFile } from '../../resolver.js';
import { readStagedDiff } from '../../staging.js';
import { mcpTools, type McpTool, type McpToolResult } from '../tools.js';

export interface ApproveToolOptions {
  cwd?: string;
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createApproveTnlDiffTool(
  options: ApproveToolOptions = {},
): McpTool {
  const cwd = options.cwd ?? process.cwd();
  return {
    name: 'approve_tnl_diff',
    title: 'Approve TNL diff',
    description:
      'Apply a staged proposal: write each tnl/<id>.tnl, regenerate its sidecar, and remove the staging record.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        diff_id: {
          type: 'string',
          minLength: 1,
          description: 'The diff_id returned by propose_tnl_diff.',
        },
      },
      required: ['diff_id'],
    },
    handler: async (args) => {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return errorResult('approve_tnl_diff: arguments must be an object');
      }
      const rec = args as Record<string, unknown>;
      const diffId = rec.diff_id;
      if (typeof diffId !== 'string') {
        return errorResult("approve_tnl_diff: 'diff_id' must be a string");
      }
      if (diffId.length === 0) {
        return errorResult("approve_tnl_diff: 'diff_id' must be non-empty");
      }

      let staged;
      try {
        staged = await readStagedDiff({ cwd }, diffId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`approve_tnl_diff: ${msg}`);
      }
      if (staged === null) {
        return errorResult(
          `approve_tnl_diff: unknown diff_id '${diffId}' (no staging record)`,
        );
      }

      for (const change of staged.changes) {
        const targetPath = join(cwd, 'tnl', `${change.id}.tnl`);
        const exists = existsSync(targetPath);
        if (change.action === 'create' && exists) {
          return errorResult(
            `approve_tnl_diff: revalidation failed — action 'create' for '${change.id}' but tnl/${change.id}.tnl now exists`,
          );
        }
        if (change.action === 'update' && !exists) {
          return errorResult(
            `approve_tnl_diff: revalidation failed — action 'update' for '${change.id}' but tnl/${change.id}.tnl no longer exists`,
          );
        }
      }

      const resolvedDir = join(cwd, 'tnl', '.resolved');
      const applied: Array<{
        id: string;
        action: 'create' | 'update';
        path: string;
        sidecar_path: string;
      }> = [];

      for (const change of staged.changes) {
        const targetPath = join(cwd, 'tnl', `${change.id}.tnl`);

        try {
          writeFileSync(targetPath, change.content, 'utf8');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResult(
            `approve_tnl_diff: failed to write tnl/${change.id}.tnl: ${msg}`,
          );
        }

        let sidecar;
        try {
          sidecar = resolveTnlFile(targetPath);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResult(
            `approve_tnl_diff: failed to resolve tnl/${change.id}.tnl: ${msg}`,
          );
        }

        const sidecarPath = join(resolvedDir, `${change.id}.meta.json`);
        try {
          mkdirSync(resolvedDir, { recursive: true });
          writeFileSync(
            sidecarPath,
            JSON.stringify(sidecar, null, 2) + '\n',
            'utf8',
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResult(
            `approve_tnl_diff: failed to write sidecar for '${change.id}': ${msg}`,
          );
        }

        applied.push({
          id: change.id,
          action: change.action,
          path: `tnl/${change.id}.tnl`,
          sidecar_path: `tnl/.resolved/${change.id}.meta.json`,
        });
      }

      try {
        rmSync(join(cwd, 'tnl', '.staging', `${diffId}.json`));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(
          `approve_tnl_diff: changes applied but failed to remove staging record: ${msg}`,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              diff_id: diffId,
              applied: true,
              changes: applied,
            }),
          },
        ],
      };
    },
  };
}

mcpTools.set('approve_tnl_diff', createApproveTnlDiffTool());
