import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface CommandArgs {
  rest: string[];
  agent?: string;
}

export interface Command {
  name: string;
  description: string;
  handler: (args: CommandArgs) => Promise<number> | number;
}

export type Registry = Map<string, Command>;

export const defaultRegistry: Registry = new Map();

interface ParsedArgv {
  subcommand?: string;
  rest: string[];
  agent?: string;
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgv(argv: string[]): ParsedArgv {
  const result: ParsedArgv = {
    rest: [],
    showHelp: false,
    showVersion: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (result.subcommand === undefined) {
      if (arg === '--help' || arg === '-h') {
        result.showHelp = true;
        continue;
      }
      if (arg === '--version' || arg === '-v') {
        result.showVersion = true;
        continue;
      }
      if (arg === '--agent') {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('-')) {
          throw new Error(`flag '--agent' requires a value`);
        }
        result.agent = value;
        i++;
        continue;
      }
      if (arg.startsWith('-')) {
        throw new Error(`unknown flag '${arg}'`);
      }
      result.subcommand = arg;
    } else {
      if (arg === '--agent') {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('-')) {
          throw new Error(`flag '--agent' requires a value`);
        }
        result.agent = value;
        i++;
        continue;
      }
      result.rest.push(arg);
    }
  }

  return result;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up until we find a package.json (works from src/ in dev and dist/ in prod).
  let dir = here;
  for (let depth = 0; depth < 5; depth++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, 'package.json'), 'utf8'),
      ) as { version?: string };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

function renderHelp(registry: Registry): string {
  const lines: string[] = [];
  lines.push('Usage: tnl [--help] [--version] [--agent <name>] <command> [args...]');
  lines.push('');
  lines.push('Global flags:');
  lines.push('  --help, -h         Show this help');
  lines.push('  --version, -v      Show version');
  lines.push('  --agent <name>     Target agent (consumed by init; ignored elsewhere)');
  lines.push('');
  lines.push('Commands:');
  if (registry.size === 0) {
    lines.push('  (none registered yet)');
  } else {
    const entries = Array.from(registry.values());
    const maxName = Math.max(...entries.map((c) => c.name.length));
    for (const cmd of entries) {
      lines.push(`  ${cmd.name.padEnd(maxName)}  ${cmd.description}`);
    }
  }
  return lines.join('\n') + '\n';
}

export interface RunOptions {
  registry?: Registry;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export async function runCli(
  argv: string[],
  options: RunOptions = {},
): Promise<number> {
  const registry = options.registry ?? defaultRegistry;
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  let parsed: ParsedArgv;
  try {
    parsed = parseArgv(argv);
  } catch (e) {
    err(`tnl: ${(e as Error).message}\n`);
    return 2;
  }

  if (parsed.showHelp) {
    out(renderHelp(registry));
    return 0;
  }
  if (parsed.showVersion) {
    out(`${readVersion()}\n`);
    return 0;
  }
  if (parsed.subcommand === undefined) {
    out(renderHelp(registry));
    return 0;
  }

  const cmd = registry.get(parsed.subcommand);
  if (!cmd) {
    err(
      `tnl: unknown command '${parsed.subcommand}'. Run 'tnl --help' to see available commands.\n`,
    );
    return 2;
  }

  return await cmd.handler({ rest: parsed.rest, agent: parsed.agent });
}
