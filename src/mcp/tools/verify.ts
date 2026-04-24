import { getImpactedTnls } from '../../impact.js';
import { verifyTnl, type UnitVerifyResult } from '../../verifier.js';
import { mcpTools, type McpTool, type McpToolResult } from '../tools.js';

export interface VerifyToolOptions {
  cwd?: string;
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

interface FailureEntry {
  kind: 'unit' | 'clause';
  name: string;
  class?: string;
  reason: string;
}

interface VerifiedEntry {
  id: string;
  passed: number;
  failed: number;
  unchecked: number;
  failures: FailureEntry[];
}

interface ErrorEntry {
  sourcePath: string;
  message: string;
}

interface VerifyResponse {
  verified: VerifiedEntry[];
  errors: ErrorEntry[];
  summary: {
    total_units: number;
    total_checks: number;
    total_failed: number;
    total_unchecked: number;
    total_errors: number;
  };
}

function extractFailures(result: UnitVerifyResult): FailureEntry[] {
  return result.checks
    .filter((c) => c.status === 'failed')
    .map((c) => {
      const entry: FailureEntry = {
        kind: c.kind,
        name: c.name,
        reason: c.reason ?? '',
      };
      if (c.class !== undefined) entry.class = c.class;
      return entry;
    });
}

export function createVerifyTool(
  options: VerifyToolOptions = {},
): McpTool {
  const cwd = options.cwd ?? process.cwd();
  return {
    name: 'verify',
    title: 'Verify TNLs',
    description:
      'Verify the TNLs impacted by a set of code paths. Returns a structured report; verify failures are data, not isError.',
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
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
        return errorResult("verify: arguments must be an object with a 'paths' array");
      }
      const rec = args as Record<string, unknown>;
      const paths = rec.paths;
      if (paths === undefined) {
        return errorResult("verify: 'paths' is required");
      }
      if (!Array.isArray(paths)) {
        return errorResult("verify: 'paths' must be an array");
      }
      if (paths.length === 0) {
        return errorResult("verify: 'paths' must be non-empty");
      }
      const stringPaths: string[] = [];
      for (const p of paths) {
        if (typeof p !== 'string') {
          return errorResult("verify: every element of 'paths' must be a string");
        }
        stringPaths.push(p);
      }

      let impacted;
      try {
        impacted = getImpactedTnls(stringPaths, { cwd });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult(`verify: ${msg}`);
      }

      const verified: VerifiedEntry[] = [];
      const errors: ErrorEntry[] = [];
      let totalChecks = 0;
      let totalFailed = 0;
      let totalUnchecked = 0;

      for (const unit of impacted) {
        try {
          const result = verifyTnl(unit.sourcePath, { cwd });
          verified.push({
            id: result.id,
            passed: result.passed,
            failed: result.failed,
            unchecked: result.unchecked,
            failures: extractFailures(result),
          });
          totalChecks += result.checks.length;
          totalFailed += result.failed;
          totalUnchecked += result.unchecked;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push({ sourcePath: unit.sourcePath, message: msg });
        }
      }

      const response: VerifyResponse = {
        verified,
        errors,
        summary: {
          total_units: impacted.length,
          total_checks: totalChecks,
          total_failed: totalFailed,
          total_unchecked: totalUnchecked,
          total_errors: errors.length,
        },
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
      };
    },
  };
}

mcpTools.set('verify', createVerifyTool());
