import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const pkgPath = join(repoRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

describe('npm-publish-shape', () => {
  it('package.json parses as valid JSON', () => {
    expect(pkg).toBeTypeOf('object');
  });

  it('private is absent or false', () => {
    expect(pkg.private).not.toBe(true);
  });

  it('has name, version, description, type, bin set', () => {
    expect(pkg.name).toBe('typed-nl');
    expect(pkg.version).toMatch(/^0\.1\.0(-[0-9a-z.]+)?$/);
    expect(pkg.description).toMatch(/TNL/);
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({
      'typed-nl': './dist/index.js',
      tnl: './dist/index.js',
      'tnl-mcp-server': './dist/mcp/server.js',
    });
  });

  it('engines.node is >= 20', () => {
    expect(pkg.engines?.node).toMatch(/>=\s*20/);
  });

  it('license is MIT and LICENSE file exists at repo root', () => {
    expect(pkg.license).toBe('MIT');
    expect(existsSync(join(repoRoot, 'LICENSE'))).toBe(true);
    const licenseText = readFileSync(join(repoRoot, 'LICENSE'), 'utf8');
    expect(licenseText).toContain('MIT');
  });

  it('repository.url points at janaraj/tnl', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'https://github.com/janaraj/tnl.git',
    });
  });

  it('homepage and bugs reference the janaraj/tnl repo', () => {
    expect(pkg.homepage).toContain('github.com/janaraj/tnl');
    expect(pkg.bugs?.url).toContain('github.com/janaraj/tnl');
  });

  it('author is set', () => {
    expect(pkg.author).toMatch(/Janarthanan Rajendran/);
  });

  it('keywords include all required search terms', () => {
    const required = [
      'tnl',
      'typed-natural-language',
      'agent',
      'claude-code',
      'mcp',
      'contracts',
    ];
    for (const kw of required) {
      expect(pkg.keywords).toContain(kw);
    }
  });

  it('publishConfig is absent (unscoped package, no override needed)', () => {
    expect(pkg.publishConfig).toBeUndefined();
  });

  it('files allowlist is exactly the three entries', () => {
    expect(pkg.files).toEqual(['dist/', 'LICENSE', 'README.md']);
  });

  it('files allowlist does NOT include source, tests, or internal dirs', () => {
    const excluded = [
      'src/',
      'tests/',
      'tnl/',
      'internal_docs/',
      'node_modules/',
      'behavioral-tests/',
      'evals/',
    ];
    for (const path of excluded) {
      expect(pkg.files).not.toContain(path);
    }
  });

  it('no .npmignore at repo root (files allowlist is single source of truth)', () => {
    expect(existsSync(join(repoRoot, '.npmignore'))).toBe(false);
  });
});
