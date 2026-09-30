import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli/program.ts';

const requests: { path: string; userAgent: string | undefined }[] = [];
let server: Server;
let base = '';

const ROBOTS = [
  'User-agent: OAI-SearchBot',
  'Allow: /',
  '',
  'User-agent: *',
  'Disallow: /private/',
  '',
].join('\n');

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '';
    requests.push({ path, userAgent: req.headers['user-agent'] });
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(ROBOTS);
      return;
    }
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
    // The target is the last request; robots.txt is fetched first.
    expect(requests.at(-1)?.userAgent).toBe('AgentProof');
    expect(requests.some((r) => r.path === '/robots.txt')).toBe(true);
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

  it('reports the robots policy and matched rule in the text output', async () => {
    const { out } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'oai-searchbot',
    ]);
    expect(out).toContain('Policy\nALLOWED');
    expect(out).toContain('Policy source\nrobots.txt');
    expect(out).toContain('User-agent: OAI-SearchBot');
  });

  it('emits only valid JSON with --json', async () => {
    const { out, err, exitCode } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'oai-searchbot',
      '--json',
    ]);
    expect(err).toBe('');
    const parsed = JSON.parse(out) as {
      url: string;
      profile: { id: string; assurance: string; requestFidelity: string };
      access: { verdict: string; signal: string; status: number };
      policy: { status: string; source: string; matchedRule?: unknown };
    };
    expect(parsed.profile.id).toBe('oai-searchbot');
    expect(parsed.profile.assurance).toBe('claimed');
    expect(parsed.profile.requestFidelity).toBe('token-only');
    expect(parsed.access.verdict).toBe('accessible');
    expect(parsed.access.signal).toBe('ok');
    expect(parsed.access.status).toBe(200);
    expect(parsed.policy.status).toBe('allowed');
    expect(parsed.policy.source).toBe('robots.txt');
    expect(parsed.policy.matchedRule).toEqual({
      agent: 'OAI-SearchBot',
      directive: 'allow',
      path: '/',
    });
    expect(out).not.toContain('AgentProof Validation');
    expect(exitCode).toBe(0);
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

  it('emits a JSON error object for an unknown profile with --json', async () => {
    const { out, err, exitCode } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'nope',
      '--json',
    ]);
    expect(err).toBe('');
    expect(JSON.parse(out)).toEqual({ error: 'Unknown profile: nope' });
    expect(exitCode).toBe(3);
  });

  it('exits 3 on a tool/network error', async () => {
    const { exitCode } = await run(['validate', 'ftp://example.com']);
    expect(exitCode).toBe(3);
  });
});
