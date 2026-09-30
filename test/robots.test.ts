import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateRobotsPolicy,
  fetchRobots,
  parseRobots,
  type PolicyStatus,
} from '../src/robots/index.ts';

let robotsBody: string | null = '';
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    res.on('error', () => {
      // The client may cancel an oversized read mid-stream; ignore.
    });
    if ((req.url ?? '') === '/robots.txt') {
      if (robotsBody === null) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(robotsBody);
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

async function statusFor(
  body: string | null,
  ua: string,
  path: string,
): Promise<PolicyStatus> {
  robotsBody = body;
  const target = `${base}${path}`;
  const observation = await fetchRobots(target);
  return evaluateRobotsPolicy(observation, ua, target).result.status;
}

describe('parseRobots', () => {
  it('groups rules by user-agent and ignores comments and blank lines', () => {
    const ruleset = parseRobots(
      [
        '# a comment',
        'User-agent: OAI-SearchBot',
        'Disallow: /private/  # trailing comment',
        'Allow: /public/',
        '',
        'User-agent: *',
        'Disallow: /admin/',
      ].join('\n'),
    );
    expect(ruleset.groups).toHaveLength(2);
    expect(ruleset.groups[0]?.agents).toEqual(['OAI-SearchBot']);
    expect(ruleset.groups[0]?.rules).toEqual([
      { directive: 'disallow', path: '/private/' },
      { directive: 'allow', path: '/public/' },
    ]);
    expect(ruleset.groups[1]?.agents).toEqual(['*']);
  });
});

describe('evaluateRobotsPolicy', () => {
  it('applies the specific agent group for allow and disallow', async () => {
    const body =
      'User-agent: OAI-SearchBot\nDisallow: /private/\nAllow: /public/\n';
    expect(await statusFor(body, 'OAI-SearchBot', '/public/x')).toBe('allowed');
    expect(await statusFor(body, 'OAI-SearchBot', '/private/x')).toBe(
      'disallowed',
    );
  });

  it('falls back to the wildcard group when no specific group exists', async () => {
    const body = 'User-agent: *\nDisallow: /admin/\n';
    robotsBody = body;
    const target = `${base}/admin/panel`;
    const evaluation = evaluateRobotsPolicy(
      await fetchRobots(target),
      'AgentProof',
      target,
    );
    expect(evaluation.result.status).toBe('disallowed');
    expect(evaluation.result.matchedRule).toEqual({
      agent: '*',
      directive: 'disallow',
      path: '/admin/',
    });
  });

  it('prefers the specific group over the wildcard group', async () => {
    const body =
      'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /docs/\n';
    expect(await statusFor(body, 'OAI-SearchBot', '/docs/page')).toBe(
      'allowed',
    );
    // The wildcard `Disallow: /` must not leak onto the specific agent: an
    // unmatched path in the specific group defaults to allowed, not disallowed.
    expect(await statusFor(body, 'OAI-SearchBot', '/other')).toBe('allowed');
  });

  it('defaults to allowed when an applicable group matches no rule', async () => {
    const body = 'User-agent: *\nDisallow: /admin/\n';
    expect(await statusFor(body, 'AgentProof', '/public/x')).toBe('allowed');
  });

  it('treats an empty Disallow as no restriction (allowed)', async () => {
    const body = 'User-agent: ExampleBot\nDisallow:\n';
    expect(await statusFor(body, 'ExampleBot', '/anything/here')).toBe(
      'allowed',
    );
  });

  it('combines rules from repeated groups of the same user-agent', async () => {
    const body =
      'User-agent: ExampleBot\nDisallow: /a/\n\nUser-agent: ExampleBot\nDisallow: /b/\n';
    expect(await statusFor(body, 'ExampleBot', '/a/x')).toBe('disallowed');
    expect(await statusFor(body, 'ExampleBot', '/b/x')).toBe('disallowed');
    expect(await statusFor(body, 'ExampleBot', '/c/x')).toBe('allowed');
  });

  it('lets the longest matching path win', async () => {
    const body = 'User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\n';
    expect(await statusFor(body, 'AgentProof', '/docs/public/a')).toBe(
      'allowed',
    );
    expect(await statusFor(body, 'AgentProof', '/docs/secret')).toBe(
      'disallowed',
    );
  });

  it('breaks a same-length tie in favour of allow', async () => {
    const body = 'User-agent: *\nDisallow: /a\nAllow: /a\n';
    expect(await statusFor(body, 'AgentProof', '/a/x')).toBe('allowed');
  });

  it('matches the user-agent case-insensitively', async () => {
    const body = 'User-agent: oaI-SeArChBoT\nDisallow: /x/\n';
    expect(await statusFor(body, 'OAI-SearchBot', '/x/y')).toBe('disallowed');
  });

  it('is unknown (not literal) for an unsupported * or $ path pattern', async () => {
    const body = 'User-agent: *\nDisallow: /*.pdf$\n';
    robotsBody = body;
    const target = `${base}/report`;
    const evaluation = evaluateRobotsPolicy(
      await fetchRobots(target),
      'AgentProof',
      target,
    );
    expect(evaluation.result.status).toBe('unknown');
    expect(evaluation.limitation).toContain('unsupported');
  });

  it('is unknown when no group applies to the agent', async () => {
    const body = 'User-agent: SomeOtherBot\nDisallow: /\n';
    expect(await statusFor(body, 'AgentProof', '/x')).toBe('unknown');
  });

  it('is unknown when robots.txt is absent (404)', async () => {
    robotsBody = null;
    const target = `${base}/x`;
    const evaluation = evaluateRobotsPolicy(
      await fetchRobots(target),
      'AgentProof',
      target,
    );
    expect(evaluation.result.status).toBe('unknown');
    expect(evaluation.limitation).toContain('not found');
  });

  it('is unknown when robots.txt exceeds the size limit, without crashing', async () => {
    const huge = `User-agent: *\nDisallow: /\n${'x'.repeat(600 * 1024)}\n`;
    robotsBody = huge;
    const target = `${base}/x`;
    const evaluation = evaluateRobotsPolicy(
      await fetchRobots(target),
      'AgentProof',
      target,
    );
    expect(evaluation.result.status).toBe('unknown');
    expect(evaluation.limitation).toContain('size limit');
  });
});
