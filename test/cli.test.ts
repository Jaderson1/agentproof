import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli/program.ts';

type RunResult = { out: string; err: string; exitCode: number | undefined };

async function run(args: string[]): Promise<RunResult> {
  let out = '';
  let err = '';
  let exitCode: number | undefined;
  const program = createProgram({
    version: '1.2.3',
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    setExitCode: (code) => {
      exitCode = code;
    },
  });
  program.exitOverride();

  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError) || error.exitCode !== 0) {
      throw error;
    }
  }

  return { out, err, exitCode };
}

describe('createProgram', () => {
  it('prints the version', async () => {
    const { out } = await run(['--version']);
    expect(out.trim()).toBe('1.2.3');
  });

  it('prints help with the audit command', async () => {
    const { out } = await run(['--help']);
    expect(out).toContain('Usage: agentproof');
    expect(out).toContain('audit');
  });

  it('prints the audit placeholder and reports inconclusive (2)', async () => {
    const { out, err, exitCode } = await run(['audit']);
    expect(out).toBe('AgentProof audit is not implemented yet.\n');
    expect(err).toBe('');
    expect(exitCode).toBe(2);
  });
});

describe('CLI entry point', () => {
  const entry = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));

  it('starts and prints the package version', () => {
    const result = spawnSync(process.execPath, [entry, '--version'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exits with code 2 for the audit placeholder', () => {
    const result = spawnSync(process.execPath, [entry, 'audit'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('AgentProof audit is not implemented yet.\n');
  });
});
