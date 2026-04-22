import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStagedDiff, stageDiff } from '../../src/staging.js';

describe('staging', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tnl-staging-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('stageDiff writes a staging record at tnl/.staging/<diff_id>.json', async () => {
    const staged = await stageDiff(
      { cwd },
      {
        intent: 'add rate limiting',
        changes: [{ id: 'foo', action: 'create', content: 'content' }],
      },
    );
    expect(staged.diff_id).toMatch(/^[0-9a-f]{16}$/);
    expect(
      existsSync(join(cwd, 'tnl', '.staging', `${staged.diff_id}.json`)),
    ).toBe(true);
  });

  it('stageDiff creates tnl/.staging/ when absent', async () => {
    expect(existsSync(join(cwd, 'tnl', '.staging'))).toBe(false);
    await stageDiff(
      { cwd },
      {
        intent: 'x',
        changes: [{ id: 'foo', action: 'create', content: 'c' }],
      },
    );
    expect(existsSync(join(cwd, 'tnl', '.staging'))).toBe(true);
  });

  it('staged record has the Staged shape', async () => {
    const staged = await stageDiff(
      { cwd },
      {
        intent: 'x',
        changes: [{ id: 'foo', action: 'create', content: 'c' }],
      },
    );
    expect(staged.diff_id).toMatch(/^[0-9a-f]{16}$/);
    expect(staged.intent).toBe('x');
    expect(staged.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(staged.changes).toEqual([
      { id: 'foo', action: 'create', content: 'c' },
    ]);
    const onDisk = JSON.parse(
      readFileSync(
        join(cwd, 'tnl', '.staging', `${staged.diff_id}.json`),
        'utf8',
      ),
    );
    expect(onDisk).toEqual(staged);
  });

  it('readStagedDiff returns the staged record', async () => {
    const staged = await stageDiff(
      { cwd },
      {
        intent: 'x',
        changes: [{ id: 'foo', action: 'update', content: 'c' }],
      },
    );
    const read = await readStagedDiff({ cwd }, staged.diff_id);
    expect(read).toEqual(staged);
  });

  it('readStagedDiff returns null for unknown diff_id', async () => {
    const read = await readStagedDiff({ cwd }, '0000000000000000');
    expect(read).toBeNull();
  });

  it('diff_ids are unique across calls', async () => {
    const a = await stageDiff(
      { cwd },
      {
        intent: 'a',
        changes: [{ id: 'foo', action: 'create', content: 'c' }],
      },
    );
    const b = await stageDiff(
      { cwd },
      {
        intent: 'b',
        changes: [{ id: 'bar', action: 'create', content: 'c' }],
      },
    );
    expect(a.diff_id).not.toBe(b.diff_id);
  });
});
