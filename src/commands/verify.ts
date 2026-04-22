import { existsSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';
import { verifyTnl, type UnitVerifyResult } from '../verifier.js';

export interface RunVerifyOptions {
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

export function runVerify(
  args: string[],
  options: RunVerifyOptions = {},
): number {
  const cwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  const positional = args.filter((a) => !a.startsWith('-'));

  let targets: string[];
  if (positional.length > 0) {
    targets = positional.map((a) => resolveTarget(cwd, a));
  } else {
    const tnlDir = join(cwd, 'tnl');
    if (!existsSync(tnlDir)) {
      err(
        `tnl verify: no tnl/ directory in ${cwd}. Run \`tnl init\` first.\n`,
      );
      return 2;
    }
    targets = readdirSync(tnlDir)
      .filter((f) => f.endsWith('.tnl'))
      .map((f) => join(tnlDir, f))
      .sort();
  }

  const results: UnitVerifyResult[] = [];
  let parseErrors = 0;

  for (const target of targets) {
    try {
      results.push(verifyTnl(target, { cwd }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const label = target.endsWith('.tnl')
        ? basename(target, '.tnl')
        : target;
      err(`${label}: FAIL — ${message}\n`);
      parseErrors++;
    }
  }

  for (const r of results) {
    out(
      `${r.id}: ${r.passed} passed, ${r.failed} failed, ${r.unchecked} unchecked\n`,
    );
    for (const check of r.checks) {
      if (check.status === 'failed') {
        const classLabel = check.class ? ` (${check.class})` : '';
        out(
          `  ${check.name}${classLabel} FAIL: ${check.reason ?? ''}\n`,
        );
      }
    }
  }

  const totalUnits = results.length + parseErrors;
  const totalChecks = results.reduce((sum, r) => sum + r.checks.length, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalUnchecked = results.reduce((sum, r) => sum + r.unchecked, 0);

  out(
    `\nSummary: ${totalUnits} TNLs verified. ${totalChecks} checks, ${totalFailed} failed, ${totalUnchecked} unchecked.\n`,
  );

  return totalFailed > 0 || parseErrors > 0 ? 2 : 0;
}

const verifyCommand: Command = {
  name: 'verify',
  description: 'Verify TNLs against the filesystem and test sources',
  handler: (args: CommandArgs) => runVerify(args.rest),
};

defaultRegistry.set('verify', verifyCommand);
