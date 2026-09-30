import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli/program.ts';

const requests: { path: string; userAgent: string | undefined }[] = [];
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '';
    requests.push({ path, userAgent: req.headers['user-agent'] });
    if (path === '/ok') {
      res.writeHead(200);
      res.end('body');
      return;
    }
    if (path === '/forbidden') {
      res.writeHead(403);
      res.end();
      return;
    }
    if (path === '/redirect') {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    }),
);

type Run = { out: string; err: string; exitCode: number | undefined };

async function run(args: string[]): Promise<Run> {
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

describe('validate command', () => {
  it('defaults to the unclaimed profile and exits 0 on an accessible URL', async () => {
    requests.length = 0;
    const { out, exitCode } = await run(['validate', `${base}/ok`]);
    expect(out).toContain('Identity\nUNCLAIMED');
    expect(out).toContain('Request identity\nAGENTPROOF');
    expect(out).toContain('ACCESSIBLE');
    expect(exitCode).toBe(0);
    expect(requests.at(-1)?.userAgent).toBe('AgentProof');
  });

  it('sends the claimed token User-Agent for a vendor profile', async () => {
    requests.length = 0;
    const { out } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'oai-searchbot',
    ]);
    expect(out).toContain('Identity\nCLAIMED');
    expect(out).toContain('Request identity\nTOKEN-ONLY');
    expect(requests.at(-1)?.userAgent).toBe('OAI-SearchBot');
  });

  it('exits 0 for a denied result', async () => {
    const { out, exitCode } = await run(['validate', `${base}/forbidden`]);
    expect(out).toContain('DENIED');
    expect(exitCode).toBe(0);
  });

  it('exits 2 for an inconclusive result', async () => {
    const { exitCode } = await run(['validate', `${base}/redirect`]);
    expect(exitCode).toBe(2);
  });

  it('exits 3 for an unknown profile', async () => {
    const { err, exitCode } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'nope',
    ]);
    expect(err).toContain('Unknown profile');
    expect(exitCode).toBe(3);
  });

  it('exits 3 on a tool/network error', async () => {
    const { exitCode } = await run(['validate', 'ftp://example.com']);
    expect(exitCode).toBe(3);
  });
});
