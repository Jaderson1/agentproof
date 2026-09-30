import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpProbeError, probeHttp } from '../src/http/index.ts';

type RecordedRequest = { path: string; userAgent: string | undefined };

const requests: RecordedRequest[] = [];
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '';
    requests.push({ path, userAgent: req.headers['user-agent'] });

    if (path === '/ok') {
      res.writeHead(200);
      res.end('hello body');
      return;
    }
    if (path === '/forbidden') {
      res.writeHead(403);
      res.end('nope');
      return;
    }
    if (path === '/redirect') {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    if (path === '/login') {
      res.writeHead(200);
      res.end('login page');
      return;
    }
    if (path === '/slow') {
      const timer = setTimeout(() => {
        res.writeHead(200);
        res.end('late');
      }, 1000);
      req.on('close', () => {
        clearTimeout(timer);
      });
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

describe('probeHttp', () => {
  it('observes a 200 with no location', async () => {
    const observation = await probeHttp(`${base}/ok`);
    expect(observation).toEqual({
      requestedUrl: `${base}/ok`,
      status: 200,
    });
  });

  it('observes a 403', async () => {
    const observation = await probeHttp(`${base}/forbidden`);
    expect(observation.status).toBe(403);
  });

  it('records a redirect without following it', async () => {
    requests.length = 0;
    const observation = await probeHttp(`${base}/redirect`);

    expect(observation.status).toBe(302);
    expect(observation.location).toBe('/login');
    expect(requests.map((r) => r.path)).toEqual(['/redirect']);
    expect(requests.some((r) => r.path === '/login')).toBe(false);
  });

  it('sends the default User-Agent when none is given', async () => {
    requests.length = 0;
    await probeHttp(`${base}/ok`);
    expect(requests.at(-1)?.userAgent).toBe('AgentProof');
  });

  it('sends a caller-provided User-Agent verbatim', async () => {
    requests.length = 0;
    await probeHttp(`${base}/ok`, { headers: { 'User-Agent': 'TestAgent' } });
    expect(requests.at(-1)?.userAgent).toBe('TestAgent');
  });

  it('rejects an unsupported protocol before fetching', async () => {
    requests.length = 0;
    await expect(probeHttp('ftp://example.com')).rejects.toBeInstanceOf(
      HttpProbeError,
    );
    expect(requests).toHaveLength(0);
  });

  it('fails on timeout instead of returning a status', async () => {
    await expect(
      probeHttp(`${base}/slow`, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(HttpProbeError);
  });

  it('does not depend on the response body', async () => {
    const observation = await probeHttp(`${base}/ok`);
    // Only status/url are surfaced; the body ("hello body") is never exposed.
    expect(Object.keys(observation).sort()).toEqual(['requestedUrl', 'status']);
  });
});
