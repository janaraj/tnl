import { isAbsolute, join, resolve } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';
import { parseTnlFile } from '../parser.js';
import { classifyClause } from '../resolver.js';

export interface RunTestPlanOptions {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

function resolveTarget(cwd: string, arg: string): string {
  if (arg.endsWith('.tnl') || arg.includes('/') || arg.includes('\\')) {
    return isAbsolute(arg) ? arg : resolve(cwd, arg);
  }
  return join(cwd, 'tnl', `${arg}.tnl`);
}

export function runTestPlan(
  args: string[],
  options: RunTestPlanOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    err(
      'tnl test-plan: requires exactly one positional argument (TNL id or path). Usage: tnl test-plan <unit>\n',
    );
    return 2;
  }
  if (positional.length > 1) {
    err(
      `tnl test-plan: too many arguments (expected 1, got ${positional.length}). Usage: tnl test-plan <unit>\n`,
    );
    return 2;
  }

  const target = resolveTarget(cwd, positional[0]!);

  let parsed;
  try {
    parsed = parseTnlFile(target);
  } catch (e) {
    err(`tnl test-plan: ${(e as Error).message}\n`);
    return 2;
  }

  interface Entry {
    clauseId: string;
    binding: { file: string; name: string } | undefined;
    cls: string;
  }

  let entries: Entry[];
  try {
    entries = parsed.behaviors.map((clause, i) => ({
      clauseId: `L-${i + 1}`,
      binding: clause.testBinding,
      cls: classifyClause(clause),
    }));
  } catch (e) {
    err(`tnl test-plan: ${(e as Error).message}\n`);
    return 2;
  }

  const testBacked = entries.filter((e) => e.cls === 'test-backed');
  if (testBacked.length === 0) {
    out(`No test-backed clauses in ${parsed.machine.id}.\n`);
    return 0;
  }

  for (const entry of testBacked) {
    const binding = entry.binding!;
    out(`${entry.clauseId} ${binding.file}::${binding.name}\n`);
  }
  return 0;
}

const testPlanCommand: Command = {
  name: 'test-plan',
  description: 'List tests required by test-backed clauses in a TNL unit',
  handler: (args: CommandArgs) => runTestPlan(args.rest),
};

defaultRegistry.set('test-plan', testPlanCommand);
