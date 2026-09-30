import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli/program.ts';

let server: Server;
let base = '';
let lastHeaders: Record<string, string | string[] | undefined> = {};
let tmp = '';
const identityPath = (): string => join(tmp, '.agentproof', 'identity.json');

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'agentproof-id-'));
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    if ((req.url ?? '') === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow:\n');
      return;
    }
    res.writeHead(200);
    res.end('ok');
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

describe('identity init', () => {
  it('creates a local identity without printing the private key', async () => {
    const { out } = await run([
      'identity',
      'init',
      '--dir',
      join(tmp, '.agentproof'),
      '--signature-agent',
      'https://signer.example',
    ]);
    expect(out).toContain('Key ID:');
    const stored = JSON.parse(readFileSync(identityPath(), 'utf8')) as {
      privateJwk: { d: string };
      publicJwk: { kid: string };
    };
    expect(stored.privateJwk.d.length).toBeGreaterThan(0);
    // The private scalar must never appear in command output.
    expect(out).not.toContain(stored.privateJwk.d);
    expect(out).not.toContain('"d"');
  });
});

describe('identity export-directory', () => {
  it('prints a public JWKS with no private material', async () => {
    const { out } = await run([
      'identity',
      'export-directory',
      '--identity',
      identityPath(),
    ]);
    const directory = JSON.parse(out) as {
      keys: { kid: string; x: string }[];
    };
    expect(directory.keys[0]?.kid.length).toBeGreaterThan(0);
    expect(out).not.toContain('"d"');
  });
});

describe('validate --as agentproof-signed', () => {
  it('signs the request and reports SIGNED / external verification not confirmed', async () => {
    const { out, exitCode } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'agentproof-signed',
      '--identity',
      identityPath(),
    ]);
    expect(out).toContain('Identity\nSIGNED');
    expect(out).toContain('External verification\nNOT CONFIRMED');
    expect(exitCode).toBe(0);
    expect(lastHeaders['signature-input']).toContain('tag="web-bot-auth"');
    expect(lastHeaders['signature-agent']).toBe('"https://signer.example"');
    expect(typeof lastHeaders.signature).toBe('string');
  });

  it('fails clearly when no identity file is given', async () => {
    const { err, exitCode } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'agentproof-signed',
    ]);
    expect(err).toContain('--identity');
    expect(exitCode).toBe(3);
  });

  it('emits JSON with an identity block and no private material', async () => {
    const { out } = await run([
      'validate',
      `${base}/ok`,
      '--as',
      'agentproof-signed',
      '--identity',
      identityPath(),
      '--json',
    ]);
    const parsed = JSON.parse(out) as {
      profile: { id: string; assurance: string };
      identity?: { signature: string; externalVerification: string };
    };
    expect(parsed.profile.assurance).toBe('signed');
    expect(parsed.identity?.signature).toBe('present');
    expect(parsed.identity?.externalVerification).toBe('not-confirmed');
    expect(out).not.toContain('"d"');
  });
});

describe('identity directory-response', () => {
  it('prints signed directory response headers with no private material', async () => {
    const { out } = await run([
      'identity',
      'directory-response',
      '--identity',
      identityPath(),
      '--authority',
      'agentproof.example',
      '--json',
    ]);
    const parsed = JSON.parse(out) as {
      authority: string;
      tag: string;
      headers: {
        'content-type': string;
        'signature-input': string;
        signature: string;
      };
    };
    expect(parsed.authority).toBe('agentproof.example');
    expect(parsed.tag).toBe('http-message-signatures-directory');
    expect(parsed.headers['content-type']).toBe(
      'application/http-message-signatures-directory+json',
    );
    expect(parsed.headers['signature-input']).toContain(
      'tag="http-message-signatures-directory"',
    );
    expect(parsed.headers['signature-input']).toContain('("@authority";req)');
    expect(out).not.toContain('"d"');
  });
});
