import { describe, expect, it } from 'vitest';
import { runCli, type Command, type Registry } from '../../src/cli.js';

function capture(): {
  opts: { registry: Registry; stdout: (s: string) => void; stderr: (s: string) => void };
  stdout: () => string;
  stderr: () => string;
} {
  let stdout = '';
  let stderr = '';
  return {
    opts: {
      registry: new Map<string, Command>(),
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

describe('tnl CLI skeleton', () => {
  it('prints help with --help and exits 0', async () => {
    const cap = capture();
    const code = await runCli(['--help'], cap.opts);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('Usage: tnl');
    expect(cap.stdout()).toContain('--help');
    expect(cap.stdout()).toContain('--version');
    expect(cap.stdout()).toContain('--agent');
  });

  it('prints help with -h and exits 0', async () => {
    const cap = capture();
    const code = await runCli(['-h'], cap.opts);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('Usage: tnl');
  });

  it('prints help with no arguments and exits 0', async () => {
    const cap = capture();
    const code = await runCli([], cap.opts);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('Usage: tnl');
  });

  it('prints version with --version and exits 0', async () => {
    const cap = capture();
    const code = await runCli(['--version'], cap.opts);
    expect(code).toBe(0);
    expect(cap.stdout()).toMatch(/^\d+\.\d+\.\d+(-[0-9a-z.]+)?\n$/);
  });

  it('prints version with -v and exits 0', async () => {
    const cap = capture();
    const code = await runCli(['-v'], cap.opts);
    expect(code).toBe(0);
    expect(cap.stdout()).toMatch(/^\d+\.\d+\.\d+(-[0-9a-z.]+)?\n$/);
  });

  it('exits 2 with message on unknown subcommand', async () => {
    const cap = capture();
    const code = await runCli(['nonesuch'], cap.opts);
    expect(code).toBe(2);
    expect(cap.stderr()).toContain("unknown command 'nonesuch'");
    expect(cap.stderr()).toContain('tnl --help');
  });

  it('exits 2 on unknown global flag', async () => {
    const cap = capture();
    const code = await runCli(['--foo'], cap.opts);
    expect(code).toBe(2);
    expect(cap.stderr()).toContain("unknown flag '--foo'");
  });

  it('exits 2 on --agent without a value', async () => {
    const cap = capture();
    const code = await runCli(['--agent'], cap.opts);
    expect(code).toBe(2);
    expect(cap.stderr()).toContain("'--agent' requires a value");
  });

  it('shows registered commands in help with their description', async () => {
    const cap = capture();
    cap.opts.registry.set('init', {
      name: 'init',
      description: 'Initialize TNL in this repo',
      handler: () => 0,
    });
    const code = await runCli(['--help'], cap.opts);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain('init');
    expect(cap.stdout()).toContain('Initialize TNL in this repo');
  });

  it('dispatches to a registered subcommand', async () => {
    const cap = capture();
    let called = false;
    cap.opts.registry.set('init', {
      name: 'init',
      description: 'init',
      handler: () => {
        called = true;
        return 0;
      },
    });
    const code = await runCli(['init'], cap.opts);
    expect(called).toBe(true);
    expect(code).toBe(0);
  });

  it('forwards --agent to the handler when placed before the subcommand', async () => {
    const cap = capture();
    let received: string | undefined;
    cap.opts.registry.set('init', {
      name: 'init',
      description: '',
      handler: (args) => {
        received = args.agent;
        return 0;
      },
    });
    await runCli(['--agent', 'claude', 'init'], cap.opts);
    expect(received).toBe('claude');
  });

  it('forwards --agent to the handler when placed after the subcommand', async () => {
    const cap = capture();
    let received: string | undefined;
    cap.opts.registry.set('init', {
      name: 'init',
      description: '',
      handler: (args) => {
        received = args.agent;
        return 0;
      },
    });
    await runCli(['init', '--agent', 'codex'], cap.opts);
    expect(received).toBe('codex');
  });

  it('forwards rest args to the handler unchanged', async () => {
    const cap = capture();
    let received: string[] = [];
    cap.opts.registry.set('init', {
      name: 'init',
      description: '',
      handler: (args) => {
        received = args.rest;
        return 0;
      },
    });
    await runCli(['init', '--foo', 'bar', 'baz'], cap.opts);
    expect(received).toEqual(['--foo', 'bar', 'baz']);
  });

  it('propagates handler exit code', async () => {
    const cap = capture();
    cap.opts.registry.set('fail', {
      name: 'fail',
      description: '',
      handler: () => 7,
    });
    const code = await runCli(['fail'], cap.opts);
    expect(code).toBe(7);
  });
});
