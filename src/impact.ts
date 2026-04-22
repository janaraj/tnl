import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseTnlFile } from './parser.js';
import type { Scope } from './parser.js';

export interface ImpactedTnl {
  id: string;
  title: string;
  sourcePath: string;
  scope: Scope;
}

export interface GetImpactedOptions {
  cwd?: string;
}

export function getImpactedTnls(
  queryPaths: string[],
  options: GetImpactedOptions = {},
): ImpactedTnl[] {
  const cwd = options.cwd ?? process.cwd();
  const tnlDir = join(cwd, 'tnl');

  const files = readdirSync(tnlDir)
    .filter((f) => f.endsWith('.tnl'))
    .map((f) => join(tnlDir, f));

  const repoWide: ImpactedTnl[] = [];
  const featureMatches: ImpactedTnl[] = [];

  for (const filePath of files) {
    const parsed = parseTnlFile(filePath);
    const summary: ImpactedTnl = {
      id: parsed.machine.id,
      title: parsed.machine.title,
      sourcePath: filePath,
      scope: parsed.machine.scope,
    };

    if (parsed.machine.scope === 'repo-wide') {
      repoWide.push(summary);
      continue;
    }

    const tnlPaths = parsed.machine.paths ?? [];
    const matches = queryPaths.some((q) =>
      tnlPaths.some((t) => pathsOverlap(q, t)),
    );
    if (matches) featureMatches.push(summary);
  }

  repoWide.sort((a, b) => a.id.localeCompare(b.id));
  featureMatches.sort((a, b) => a.id.localeCompare(b.id));
  return [...repoWide, ...featureMatches];
}

export function pathsOverlap(a: string, b: string): boolean {
  return contains(a, b) || contains(b, a);
}

function contains(parent: string, child: string): boolean {
  const p = parent.replace(/\/$/, '');
  const c = child.replace(/\/$/, '');
  if (p === c) return true;
  return c.startsWith(p + '/');
}
