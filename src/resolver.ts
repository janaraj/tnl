import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseTnl, type Clause, type TestBinding, type TnlFile } from './parser.js';

export type ClauseClass = 'structural' | 'test-backed' | 'semantic' | 'advisory';

export interface SidecarClause {
  hash: string;
  class: ClauseClass;
  test?: TestBinding;
}

export interface Sidecar {
  unit_hash: string;
  resolved_at: string;
  clauses: Record<string, SidecarClause>;
}

export interface ResolveOptions {
  now?: Date;
}

export class ResolveError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.line = line;
    this.name = 'ResolveError';
  }
}

export function classifyClause(clause: Clause): ClauseClass {
  if (clause.testBinding !== undefined) return 'test-backed';
  if (clause.semantic) return 'semantic';
  const kws = clause.keywords;
  if (kws.includes('MUST') || kws.includes('MUST NOT')) return 'structural';
  if (
    kws.includes('SHOULD') ||
    kws.includes('SHOULD NOT') ||
    kws.includes('MAY')
  ) {
    return 'advisory';
  }
  throw new ResolveError(
    clause.line,
    'clause has no RFC 2119 keyword and no [semantic] or [test: ...] prefix — cannot classify',
  );
}

export function hashClause(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return sha256Hex(normalized);
}

export function hashUnit(source: string): string {
  const normalized = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
  return sha256Hex(normalized);
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function resolveTnlSource(
  source: string,
  sourcePath?: string,
  options: ResolveOptions = {},
): Sidecar {
  const parsed = parseTnl(source, sourcePath);
  return buildSidecar(parsed, source, options);
}

export function resolveTnlFile(
  filePath: string,
  options: ResolveOptions = {},
): Sidecar {
  const source = readFileSync(filePath, 'utf8');
  return resolveTnlSource(source, filePath, options);
}

function buildSidecar(
  parsed: TnlFile,
  source: string,
  options: ResolveOptions,
): Sidecar {
  const clauses: Record<string, SidecarClause> = {};
  parsed.behaviors.forEach((clause, i) => {
    const id = `L-${i + 1}`;
    const cls = classifyClause(clause);
    const entry: SidecarClause = {
      hash: hashClause(clause.text),
      class: cls,
    };
    if (cls === 'test-backed' && clause.testBinding !== undefined) {
      entry.test = clause.testBinding;
    }
    clauses[id] = entry;
  });
  const now = options.now ?? new Date();
  return {
    unit_hash: hashUnit(source),
    resolved_at: now.toISOString(),
    clauses,
  };
}
