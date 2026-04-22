import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';
import { resolveTnlFile } from '../resolver.js';

export interface RunResolveOptions {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  now?: Date;
}

export function runResolve(
  args: string[],
  options: RunResolveOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  const positional = args.filter((a) => !a.startsWith('-'));
  const pathArg = positional[0];

  let targets: string[];
  if (pathArg !== undefined) {
    targets = [isAbsolute(pathArg) ? pathArg : join(cwd, pathArg)];
  } else {
    const tnlDir = join(cwd, 'tnl');
    if (!existsSync(tnlDir)) {
      err(
        `tnl resolve: no tnl/ directory in ${cwd}. Run \`tnl init\` first.\n`,
      );
      return 2;
    }
    targets = readdirSync(tnlDir)
      .filter((f) => f.endsWith('.tnl'))
      .map((f) => join(tnlDir, f))
      .sort();
    if (targets.length === 0) {
      out('No .tnl files under tnl/ to resolve.\n');
      return 0;
    }
  }

  const succeeded: Array<{ target: string; sidecarPath: string }> = [];
  const failed: Array<{ target: string; error: string }> = [];

  for (const target of targets) {
    try {
      const sidecar = resolveTnlFile(target, { now: options.now });
      const resolvedDir = join(dirname(target), '.resolved');
      mkdirSync(resolvedDir, { recursive: true });
      const stem = basename(target, '.tnl');
      const sidecarPath = join(resolvedDir, `${stem}.meta.json`);

      if (existsSync(sidecarPath)) {
        try {
          const existing = JSON.parse(readFileSync(sidecarPath, 'utf8')) as {
            unit_hash?: unknown;
            resolved_at?: unknown;
          };
          if (
            typeof existing.unit_hash === 'string' &&
            existing.unit_hash === sidecar.unit_hash &&
            typeof existing.resolved_at === 'string'
          ) {
            sidecar.resolved_at = existing.resolved_at;
          }
        } catch {
          // existing sidecar is unreadable or un-parseable; overwrite
        }
      }

      writeFileSync(
        sidecarPath,
        JSON.stringify(sidecar, null, 2) + '\n',
        'utf8',
      );
      succeeded.push({ target, sidecarPath });
    } catch (e) {
      failed.push({ target, error: (e as Error).message });
    }
  }

  if (succeeded.length > 0) {
    out('Resolved:\n');
    for (const s of succeeded) {
      out(`  ${s.target} -> ${s.sidecarPath}\n`);
    }
  }
  for (const f of failed) {
    err(`tnl resolve: failed on '${f.target}': ${f.error}\n`);
  }

  return failed.length > 0 ? 2 : 0;
}

const resolveCommand: Command = {
  name: 'resolve',
  description: 'Generate sidecar metadata for TNL files',
  handler: (args: CommandArgs) => runResolve(args.rest),
};

defaultRegistry.set('resolve', resolveCommand);
