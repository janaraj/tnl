import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative as pathRelative, resolve } from 'node:path';
import { defaultRegistry, type Command, type CommandArgs } from '../cli.js';
import { parseTnl, type Clause, type TnlFile } from '../parser.js';
import { hashClause } from '../resolver.js';

export interface RunDiffOptions {
  cwd?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

function gitTopLevel(cwd: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out.trim();
  } catch {
    return null;
  }
}

function gitShowHead(cwd: string, repoRelPath: string): string | null {
  try {
    return execFileSync(
      'git',
      ['-C', cwd, 'show', `HEAD:${repoRelPath}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return null;
  }
}

function normalizeProse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface ClauseDiff {
  added: Array<{ position: number; text: string }>;
  removed: Array<{ position: number; text: string }>;
  modified: Array<{ position: number; before: string; after: string }>;
}

function diffClauses(head: Clause[], work: Clause[]): ClauseDiff {
  const added: ClauseDiff['added'] = [];
  const removed: ClauseDiff['removed'] = [];
  const modified: ClauseDiff['modified'] = [];
  const maxLen = Math.max(head.length, work.length);
  for (let i = 0; i < maxLen; i++) {
    const h = head[i];
    const w = work[i];
    if (h && !w) {
      removed.push({ position: i + 1, text: h.text });
    } else if (w && !h) {
      added.push({ position: i + 1, text: w.text });
    } else if (h && w) {
      if (hashClause(h.text) !== hashClause(w.text)) {
        modified.push({ position: i + 1, before: h.text, after: w.text });
      }
    }
  }
  return { added, removed, modified };
}

function zoneLine(label: string, changed: boolean): string {
  return `  ${label}: ${changed ? 'changed' : 'unchanged'}`;
}

function zonesChanged(
  head: TnlFile | null,
  work: TnlFile,
): { machine: boolean; intent: boolean; nonGoals: boolean; rationale: boolean } {
  if (head === null) {
    return { machine: true, intent: true, nonGoals: true, rationale: true };
  }
  return {
    machine: JSON.stringify(head.machine) !== JSON.stringify(work.machine),
    intent: normalizeProse(head.intent) !== normalizeProse(work.intent),
    nonGoals: JSON.stringify(head.nonGoals) !== JSON.stringify(work.nonGoals),
    rationale: normalizeProse(head.rationale) !== normalizeProse(work.rationale),
  };
}

export function runDiff(
  args: string[],
  options: RunDiffOptions = {},
): number {
  const rawCwd = options.cwd ?? process.cwd();
  const out = options.stdout ?? ((s: string) => void process.stdout.write(s));
  const err = options.stderr ?? ((s: string) => void process.stderr.write(s));

  const positional = args.filter((a) => !a.startsWith('-'));
  if (positional.length === 0) {
    err(
      'tnl diff: requires exactly one path argument. Usage: tnl diff <file>\n',
    );
    return 2;
  }
  if (positional.length > 1) {
    err(
      `tnl diff: too many arguments (expected 1, got ${positional.length}). Usage: tnl diff <file>\n`,
    );
    return 2;
  }

  const userPath = positional[0]!;
  let cwd = rawCwd;
  try {
    cwd = realpathSync(rawCwd);
  } catch {
    // fall back to the raw cwd
  }
  let absPath = isAbsolute(userPath) ? userPath : resolve(cwd, userPath);

  if (!existsSync(absPath)) {
    err(`tnl diff: file not found: ${userPath}\n`);
    return 2;
  }

  try {
    absPath = realpathSync(absPath);
  } catch {
    // fall back to non-canonical
  }

  const topLevel = gitTopLevel(cwd);
  if (topLevel === null) {
    err(
      'tnl diff: not inside a git repository (git rev-parse --show-toplevel failed)\n',
    );
    return 2;
  }

  const repoRelPath = pathRelative(topLevel, absPath);

  let workContent: string;
  try {
    workContent = readFileSync(absPath, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`tnl diff: failed to read working-tree file: ${msg}\n`);
    return 2;
  }

  const headContent = gitShowHead(cwd, repoRelPath);

  let workTnl: TnlFile;
  try {
    workTnl = parseTnl(workContent, absPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`tnl diff: working-tree file failed to parse: ${msg}\n`);
    return 2;
  }

  let headTnl: TnlFile | null = null;
  if (headContent !== null) {
    try {
      headTnl = parseTnl(headContent, absPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(`tnl diff: HEAD version failed to parse: ${msg}\n`);
      return 2;
    }
  }

  const headBehaviors = headTnl?.behaviors ?? [];
  const diff = diffClauses(headBehaviors, workTnl.behaviors);
  const zones = zonesChanged(headTnl, workTnl);

  out(
    `${userPath}: +${diff.added.length} added, ~${diff.modified.length} modified, -${diff.removed.length} removed\n`,
  );

  out(zoneLine('machine zone', zones.machine) + '\n');
  out(zoneLine('intent', zones.intent) + '\n');
  out(zoneLine('non-goals', zones.nonGoals) + '\n');
  out(zoneLine('rationale', zones.rationale) + '\n');

  if (
    diff.added.length === 0 &&
    diff.modified.length === 0 &&
    diff.removed.length === 0
  ) {
    out('  behaviors: unchanged at the behavior level\n');
    return 0;
  }

  if (diff.added.length > 0) {
    out('\nADDED:\n');
    for (const a of diff.added) {
      out(`  L-${a.position}: ${a.text}\n`);
    }
  }
  if (diff.removed.length > 0) {
    out('\nREMOVED:\n');
    for (const r of diff.removed) {
      out(`  L-${r.position}: ${r.text}\n`);
    }
  }
  if (diff.modified.length > 0) {
    out('\nMODIFIED:\n');
    for (const m of diff.modified) {
      out(`  L-${m.position}:\n`);
      out(`    before: ${m.before}\n`);
      out(`    after:  ${m.after}\n`);
    }
  }

  return 0;
}

const diffCommand: Command = {
  name: 'diff',
  description: 'Show clause-level diff between a TNL file and its HEAD version',
  handler: (args: CommandArgs) => runDiff(args.rest),
};

defaultRegistry.set('diff', diffCommand);
