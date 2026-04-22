import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';
import { getImpactedTnls } from '../impact.js';

export interface RunHookOptions {
  cwd?: string;
  stdin?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

const SUPPORTED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', (err) => reject(err));
  });
}

function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // File may not exist yet (e.g., Write creating a new file). Try the parent.
    try {
      const parent = realpathSync(dirname(path));
      return parent + path.slice(dirname(path).length);
    } catch {
      return path;
    }
  }
}

async function runPreToolUse(options: RunHookOptions): Promise<number> {
  const rawCwd = options.cwd ?? process.cwd();
  const cwd = canonicalize(rawCwd);
  const out =
    options.stdout ?? ((s: string) => void process.stdout.write(s));

  let rawInput: string;
  if (options.stdin !== undefined) {
    rawInput = options.stdin;
  } else {
    try {
      rawInput = await readAllStdin();
    } catch {
      return 0;
    }
  }

  if (rawInput.trim() === '') return 0;

  let hookInput: unknown;
  try {
    hookInput = JSON.parse(rawInput);
  } catch {
    return 0;
  }
  if (typeof hookInput !== 'object' || hookInput === null) return 0;
  const input = hookInput as Record<string, unknown>;

  const toolName = input.tool_name;
  if (typeof toolName !== 'string' || !SUPPORTED_TOOLS.has(toolName)) {
    return 0;
  }

  const toolInput = input.tool_input;
  if (typeof toolInput !== 'object' || toolInput === null) return 0;
  const rawFilePath = (toolInput as Record<string, unknown>).file_path;
  if (typeof rawFilePath !== 'string' || rawFilePath.length === 0) return 0;

  const filePath = canonicalize(rawFilePath);
  let relPath = filePath;
  if (filePath.startsWith(cwd)) {
    relPath = filePath.slice(cwd.length).replace(/^[/\\]/, '');
  }

  let impacted;
  try {
    impacted = getImpactedTnls([relPath], { cwd });
  } catch {
    return 0;
  }

  const features = impacted.filter((u) => u.scope === 'feature');
  if (features.length === 0) return 0;

  const lines: string[] = [];
  lines.push('TNL contracts apply to this edit. Review before proceeding:');
  lines.push('');

  let anyRead = false;
  for (const unit of features) {
    try {
      const content = readFileSync(unit.sourcePath, 'utf8');
      lines.push(`--- ${unit.id} (feature) — ${unit.sourcePath} ---`);
      lines.push(content);
      lines.push('');
      anyRead = true;
    } catch {
      // skip this unit
    }
  }

  if (!anyRead) return 0;

  out(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: lines.join('\n'),
      },
    }),
  );
  return 0;
}

export async function runHook(
  args: string[],
  options: RunHookOptions = {},
): Promise<number> {
  const sub = args.find((a) => !a.startsWith('-'));
  if (sub === 'pre-tool-use') {
    return runPreToolUse(options);
  }
  return 0;
}

const hookCommand: Command = {
  name: 'hook',
  description: 'Claude Code hook handlers (pre-tool-use)',
  handler: async (args: CommandArgs) => runHook(args.rest),
};

defaultRegistry.set('hook', hookCommand);
