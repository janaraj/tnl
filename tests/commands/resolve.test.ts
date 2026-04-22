import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResolve } from '../../src/commands/resolve.js';

const GOOD_TNL = `id: example-one
title: Example one
scope: feature
owners: [@jana]
paths: [src/foo.ts]

intent:
  Intent.

behaviors:
  - The system MUST do X.
`;

const GOOD_TNL_2 = `id: example-two
title: Example two
scope: feature
owners: [@jana]
paths: [src/bar.ts]

intent:
  Intent.

behaviors:
  - The system SHOULD do Y.
`;

const BAD_TNL = `id: bad
title: Bad
scope: feature
owners: [@jana]
paths: [src/bad.ts]

intent:
  Intent.

behaviors:
  - This clause has no keyword.
`;

function capture(): {
  opts: { stdout: (s: string) => void; stderr: (s: string) => void };
  stdout: () => string;
  stderr: () => string;
} {
  let stdout = '';
  let stderr = '';
  return {
    opts: {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('tnl resolve', () => {
  let cwd: string;
  const now = new Date('2026-01-15T12:00:00Z');

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-resolve-cmd-test-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('resolves a single file by path', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    const cap = capture();
    const code = runResolve(['tnl/example-one.tnl'], { cwd, now, ...cap.opts });
    expect(code).toBe(0);
    const sidecarPath = join(cwd, 'tnl', '.resolved', 'example-one.meta.json');
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    expect(sidecar.clauses['L-1'].class).toBe('structural');
    expect(sidecar.resolved_at).toBe('2026-01-15T12:00:00.000Z');
  });

  it('resolves all .tnl files in ./tnl/ when no path argument is given', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    writeFileSync(join(cwd, 'tnl', 'example-two.tnl'), GOOD_TNL_2, 'utf8');
    const cap = capture();
    const code = runResolve([], { cwd, now, ...cap.opts });
    expect(code).toBe(0);
    expect(
      existsSync(join(cwd, 'tnl', '.resolved', 'example-one.meta.json')),
    ).toBe(true);
    expect(
      existsSync(join(cwd, 'tnl', '.resolved', 'example-two.meta.json')),
    ).toBe(true);
  });

  it('creates tnl/.resolved/ when absent', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    expect(existsSync(join(cwd, 'tnl', '.resolved'))).toBe(false);
    const cap = capture();
    runResolve([], { cwd, now, ...cap.opts });
    expect(existsSync(join(cwd, 'tnl', '.resolved'))).toBe(true);
  });

  it('exits 2 when no tnl/ directory exists and no path argument given', () => {
    const cap = capture();
    const code = runResolve([], { cwd, now, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('no tnl/ directory');
    expect(cap.stderr()).toContain('tnl init');
  });

  it('exits 0 with a message when tnl/ is empty', () => {
    mkdirSync(join(cwd, 'tnl'));
    const cap = capture();
    const code = runResolve([], { cwd, now, ...cap.opts });
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('No .tnl files');
  });

  it('exits 2 when single-file target is missing', () => {
    const cap = capture();
    const code = runResolve(['tnl/missing.tnl'], { cwd, now, ...cap.opts });
    expect(code).toBe(2);
    expect(cap.stderr()).toContain('failed');
  });

  it('continues batch on individual failure and exits 2', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    writeFileSync(join(cwd, 'tnl', 'bad.tnl'), BAD_TNL, 'utf8');
    const cap = capture();
    const code = runResolve([], { cwd, now, ...cap.opts });
    expect(code).toBe(2);
    expect(
      existsSync(join(cwd, 'tnl', '.resolved', 'example-one.meta.json')),
    ).toBe(true);
    expect(existsSync(join(cwd, 'tnl', '.resolved', 'bad.meta.json'))).toBe(
      false,
    );
    expect(cap.stderr()).toContain("failed on");
    expect(cap.stderr()).toContain('bad.tnl');
  });

  it('writes pretty-printed JSON with trailing newline', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    runResolve([], { cwd, now, ...capture().opts });
    const content = readFileSync(
      join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
      'utf8',
    );
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('\n  "unit_hash":');
  });

  it('preserves resolved_at byte-for-byte on a second run with unchanged content', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    const firstNow = new Date('2026-01-15T12:00:00Z');
    runResolve([], { cwd, now: firstNow, ...capture().opts });
    const firstContent = readFileSync(
      join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
      'utf8',
    );

    // Second run with a different "now" — should still preserve timestamp
    const secondNow = new Date('2030-12-31T23:59:59Z');
    runResolve([], { cwd, now: secondNow, ...capture().opts });
    const secondContent = readFileSync(
      join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
      'utf8',
    );
    expect(secondContent).toBe(firstContent);
  });

  it('generates a fresh resolved_at when content changes', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    const firstNow = new Date('2026-01-15T12:00:00Z');
    runResolve([], { cwd, now: firstNow, ...capture().opts });
    const before = JSON.parse(
      readFileSync(
        join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
        'utf8',
      ),
    );

    // Modify the TNL content so unit_hash changes
    const mutated = GOOD_TNL.replace(
      'The system MUST do X.',
      'The system MUST do X differently.',
    );
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), mutated, 'utf8');

    const secondNow = new Date('2030-12-31T23:59:59Z');
    runResolve([], { cwd, now: secondNow, ...capture().opts });
    const after = JSON.parse(
      readFileSync(
        join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
        'utf8',
      ),
    );
    expect(after.resolved_at).not.toBe(before.resolved_at);
    expect(after.resolved_at).toBe(secondNow.toISOString());
  });

  it('overwrites a corrupted existing sidecar rather than preserving it', () => {
    mkdirSync(join(cwd, 'tnl'));
    writeFileSync(join(cwd, 'tnl', 'example-one.tnl'), GOOD_TNL, 'utf8');
    mkdirSync(join(cwd, 'tnl', '.resolved'));
    writeFileSync(
      join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
      'not valid json',
      'utf8',
    );
    const freshNow = new Date('2026-03-03T03:03:03Z');
    runResolve([], { cwd, now: freshNow, ...capture().opts });
    const after = JSON.parse(
      readFileSync(
        join(cwd, 'tnl', '.resolved', 'example-one.meta.json'),
        'utf8',
      ),
    );
    expect(after.resolved_at).toBe(freshNow.toISOString());
    expect(after.unit_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
