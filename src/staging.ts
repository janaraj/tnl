import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Change {
  id: string;
  action: 'create' | 'update';
  content: string;
}

export interface Proposal {
  intent: string;
  changes: Change[];
}

export interface Staged {
  diff_id: string;
  intent: string;
  created_at: string;
  changes: Change[];
}

export interface StagingOptions {
  cwd: string;
}

function stagingDir(cwd: string): string {
  return join(cwd, 'tnl', '.staging');
}

function stagingPath(cwd: string, diffId: string): string {
  return join(stagingDir(cwd), `${diffId}.json`);
}

export async function stageDiff(
  options: StagingOptions,
  proposal: Proposal,
): Promise<Staged> {
  const diffId = randomBytes(8).toString('hex');
  const staged: Staged = {
    diff_id: diffId,
    intent: proposal.intent,
    created_at: new Date().toISOString(),
    changes: proposal.changes,
  };
  mkdirSync(stagingDir(options.cwd), { recursive: true });
  writeFileSync(
    stagingPath(options.cwd, diffId),
    JSON.stringify(staged, null, 2) + '\n',
    'utf8',
  );
  return staged;
}

export async function readStagedDiff(
  options: StagingOptions,
  diffId: string,
): Promise<Staged | null> {
  const filePath = stagingPath(options.cwd, diffId);
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as Staged;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return null;
    throw e;
  }
}
