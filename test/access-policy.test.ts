import { describe, expect, it } from 'vitest';
import type { CheckStatus } from '../src/audit/index.ts';
import { evaluateAccessObservation } from '../src/checks/index.ts';
import type { HttpObservation } from '../src/http/index.ts';
import type { PolicyDecision } from '../src/policy/index.ts';

const obs = (status: number): HttpObservation => ({
  requestedUrl: 'http://example.test/',
  status,
});

const allow: PolicyDecision = { kind: 'decision', action: 'allow', rules: [] };
const deny: PolicyDecision = { kind: 'decision', action: 'deny', rules: [] };

describe('evaluateAccessObservation — allow', () => {
  it.each<[number, CheckStatus]>([
    [200, 'pass'],
    [204, 'pass'],
    [401, 'fail'],
    [403, 'fail'],
    [302, 'inconclusive'],
    [404, 'inconclusive'],
    [429, 'inconclusive'],
    [500, 'inconclusive'],
  ])('allow + %i → %s', (status, expected) => {
    expect(evaluateAccessObservation(allow, obs(status)).status).toBe(expected);
  });
});

describe('evaluateAccessObservation — deny', () => {
  it.each<[number, CheckStatus]>([
    [200, 'fail'],
    [206, 'fail'],
    [401, 'pass'],
    [403, 'pass'],
    [302, 'inconclusive'],
    [404, 'inconclusive'],
    [429, 'inconclusive'],
    [503, 'inconclusive'],
  ])('deny + %i → %s', (status, expected) => {
    expect(evaluateAccessObservation(deny, obs(status)).status).toBe(expected);
  });
});

describe('evaluateAccessObservation — non-explicit decisions', () => {
  it('is inconclusive for no-match', () => {
    const result = evaluateAccessObservation({ kind: 'no-match' }, obs(200));
    expect(result.status).toBe('inconclusive');
    expect(result.observed).toBe('no matching policy rule');
  });

  it('is inconclusive for conflict', () => {
    const result = evaluateAccessObservation(
      { kind: 'conflict', rules: [] },
      obs(403),
    );
    expect(result.status).toBe('inconclusive');
    expect(result.expected).toBe('unambiguous policy decision');
    expect(result.observed).toBe('conflicting policy rules');
  });
});

describe('evaluateAccessObservation — result content', () => {
  it('carries a stable id and title', () => {
    const result = evaluateAccessObservation(allow, obs(200));
    expect(result.id).toBe('access-policy');
    expect(result.title).toBe('Access policy enforcement');
  });

  it('describes a passing allow (200)', () => {
    const result = evaluateAccessObservation(allow, obs(200));
    expect(result.status).toBe('pass');
    expect(result.expected).toBe('allow');
    expect(result.observed).toBe('HTTP 200');
    expect(result.message).toContain('consistent with the declared allow');
  });

  it('describes a failing deny (200)', () => {
    const result = evaluateAccessObservation(deny, obs(200));
    expect(result.status).toBe('fail');
    expect(result.expected).toBe('deny');
    expect(result.observed).toBe('HTTP 200');
    expect(result.message).toContain('denies access');
  });

  it('describes a passing deny (403) without asserting causation', () => {
    const result = evaluateAccessObservation(deny, obs(403));
    expect(result.status).toBe('pass');
    expect(result.observed).toBe('HTTP 403');
    expect(result.message).toContain('does not prove');
  });

  it('describes an inconclusive allow (302)', () => {
    const result = evaluateAccessObservation(allow, obs(302));
    expect(result.status).toBe('inconclusive');
    expect(result.observed).toBe('HTTP 302');
    expect(result.message).toContain('not provide enough evidence');
  });
});
