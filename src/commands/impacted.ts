import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';
import { getImpactedTnls } from '../impact.js';

export interface RunImpactedOptions {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export function runImpacted(
  args: string[],
  options: RunImpactedOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  const queryPaths = args.filter((a) => !a.startsWith('-'));
  if (queryPaths.length === 0) {
    err(
      'tnl impacted: requires one or more paths. Usage: tnl impacted <path>...\n',
    );
    return 2;
  }

  const tnlDir = join(cwd, 'tnl');
  if (!existsSync(tnlDir)) {
    err(
      `tnl impacted: no tnl/ directory in ${cwd}. Run \`tnl init\` first.\n`,
    );
    return 2;
  }

  let impacted;
  try {
    impacted = getImpactedTnls(queryPaths, { cwd });
  } catch (e) {
    err(`tnl impacted: ${(e as Error).message}\n`);
    return 2;
  }

  for (const unit of impacted) {
    out(`${unit.id}\n`);
  }
  return 0;
}

const impactedCommand: Command = {
  name: 'impacted',
  description: 'List TNL units whose paths overlap with given code paths',
  handler: (args: CommandArgs) => runImpacted(args.rest),
};

defaultRegistry.set('impacted', impactedCommand);
