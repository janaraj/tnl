import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseTnlFile, type TestBinding } from './parser.js';
import { classifyClause, type ClauseClass } from './resolver.js';

export interface VerifyOptions {
  cwd?: string;
}

export interface VerifyAllOptions extends VerifyOptions {
  ids?: string[];
}

export type CheckStatus = 'passed' | 'failed' | 'unchecked';

export interface CheckResult {
  kind: 'unit' | 'clause';
  name: string;
  class?: ClauseClass;
  status: CheckStatus;
  reason?: string;
}

export interface UnitVerifyResult {
  id: string;
  sourcePath: string;
  checks: CheckResult[];
  passed: number;
  failed: number;
  unchecked: number;
}

function resolveInCwd(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function runPathsExist(paths: string[], cwd: string): CheckResult {
  for (const p of paths) {
    if (!existsSync(resolveInCwd(cwd, p))) {
      return {
        kind: 'unit',
        name: 'paths-exist',
        status: 'failed',
        reason: `declared path '${p}' not found on disk`,
      };
    }
  }
  return { kind: 'unit', name: 'paths-exist', status: 'passed' };
}

function runDependenciesResolve(deps: string[], cwd: string): CheckResult {
  for (const id of deps) {
    if (!existsSync(join(cwd, 'tnl', `${id}.tnl`))) {
      return {
        kind: 'unit',
        name: 'dependencies-resolve',
        status: 'failed',
        reason: `declared dependency '${id}' has no tnl/${id}.tnl`,
      };
    }
  }
  return { kind: 'unit', name: 'dependencies-resolve', status: 'passed' };
}

function runTestBinding(
  clauseId: string,
  cls: ClauseClass,
  binding: TestBinding,
  cwd: string,
): CheckResult {
  const absFile = resolveInCwd(cwd, binding.file);
  if (!existsSync(absFile)) {
    return {
      kind: 'clause',
      name: clauseId,
      class: cls,
      status: 'failed',
      reason: `test file ${binding.file} does not exist`,
    };
  }
  let content: string;
  try {
    content = readFileSync(absFile, 'utf8');
  } catch (e) {
    return {
      kind: 'clause',
      name: clauseId,
      class: cls,
      status: 'failed',
      reason: e instanceof Error ? e.message : String(e),
    };
  }
  if (content.includes(binding.name)) {
    return { kind: 'clause', name: clauseId, class: cls, status: 'passed' };
  }
  return {
    kind: 'clause',
    name: clauseId,
    class: cls,
    status: 'failed',
    reason: `declared test '${binding.name}' not found in ${binding.file}`,
  };
}

export function verifyTnl(
  filePath: string,
  options: VerifyOptions = {},
): UnitVerifyResult {
  const cwd = options.cwd ?? process.cwd();
  const absPath = resolveInCwd(cwd, filePath);
  const parsed = parseTnlFile(absPath);

  const checks: CheckResult[] = [];

  if (parsed.machine.scope === 'feature' && parsed.machine.paths) {
    checks.push(runPathsExist(parsed.machine.paths, cwd));
  }

  if (
    parsed.machine.dependencies !== undefined &&
    parsed.machine.dependencies.length > 0
  ) {
    checks.push(runDependenciesResolve(parsed.machine.dependencies, cwd));
  }

  parsed.behaviors.forEach((clause, i) => {
    const clauseId = `L-${i + 1}`;
    const cls = classifyClause(clause);
    if (cls === 'test-backed' && clause.testBinding !== undefined) {
      checks.push(runTestBinding(clauseId, cls, clause.testBinding, cwd));
    } else {
      checks.push({
        kind: 'clause',
        name: clauseId,
        class: cls,
        status: 'unchecked',
        reason: `no deterministic check applies to class '${cls}' in this version`,
      });
    }
  });

  const passed = checks.filter((c) => c.status === 'passed').length;
  const failed = checks.filter((c) => c.status === 'failed').length;
  const unchecked = checks.filter((c) => c.status === 'unchecked').length;

  return {
    id: parsed.machine.id,
    sourcePath: absPath,
    checks,
    passed,
    failed,
    unchecked,
  };
}

export function verifyAll(options: VerifyAllOptions = {}): UnitVerifyResult[] {
  const cwd = options.cwd ?? process.cwd();
  let targets: string[];
  if (options.ids && options.ids.length > 0) {
    targets = options.ids.map((id) => join(cwd, 'tnl', `${id}.tnl`));
  } else {
    const tnlDir = join(cwd, 'tnl');
    if (!existsSync(tnlDir)) return [];
    targets = readdirSync(tnlDir)
      .filter((f) => f.endsWith('.tnl'))
      .map((f) => join(tnlDir, f))
      .sort();
  }
  return targets.map((path) => verifyTnl(path, { cwd }));
}
