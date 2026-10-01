import { describe, expect, it } from 'vitest';
import {
  decideAuthorization,
  type AuthorizationResult,
} from '../src/authorization/index.ts';
import {
  classifyAccessObservation,
  type HttpObservation,
} from '../src/http/index.ts';
import type { PolicyResult } from '../src/robots/index.ts';

const TARGET = 'https://example.com/resource';

const obs = (
  status: number,
  extra: Partial<HttpObservation> = {},
): HttpObservation => ({ requestedUrl: TARGET, status, ...extra });

const policy = (status: PolicyResult['status']): PolicyResult => ({
  status,
  source: 'robots.txt',
});

function decide(
  observation: HttpObservation,
  policyResult: PolicyResult = policy('unknown'),
): AuthorizationResult {
  return decideAuthorization(
    observation,
    classifyAccessObservation(observation),
    policyResult,
    TARGET,
  );
}

describe('decideAuthorization', () => {
  it('200 → CAN_PROCEED', () => {
    expect(decide(obs(200))).toEqual({
      decision: 'CAN_PROCEED',
      reason: 'ok',
      basis: 'http',
    });
  });

  it('200 masking a bot challenge → NEEDS_USER (challenge outranks 2xx)', () => {
    expect(decide(obs(200, { cfMitigated: 'challenge' }))).toEqual({
      decision: 'NEEDS_USER',
      reason: 'interactive-challenge',
      basis: 'http',
    });
  });

  it('401 → NEEDS_USER (authentication-required)', () => {
    expect(decide(obs(401))).toEqual({
      decision: 'NEEDS_USER',
      reason: 'authentication-required',
      basis: 'http',
    });
  });

  it('302 to a login page → NEEDS_USER', () => {
    expect(decide(obs(302, { location: '/login?next=/resource' }))).toEqual({
      decision: 'NEEDS_USER',
      reason: 'login-redirect',
      basis: 'http',
    });
  });

  it('302 to an MFA page → NEEDS_USER', () => {
    expect(
      decide(obs(302, { location: 'https://id.example.com/mfa' })),
    ).toEqual({
      decision: 'NEEDS_USER',
      reason: 'mfa-required',
      basis: 'http',
    });
  });

  it('403 with an interactive bot challenge → NEEDS_USER, never evasion', () => {
    expect(decide(obs(403, { cfMitigated: 'challenge' }))).toEqual({
      decision: 'NEEDS_USER',
      reason: 'interactive-challenge',
      basis: 'http',
    });
  });

  it('a bare 403 access denial → NOT_AUTHORIZED (basis http)', () => {
    expect(decide(obs(403))).toEqual({
      decision: 'NOT_AUTHORIZED',
      reason: 'access-denied',
      basis: 'http',
    });
  });

  it('robots.txt disallow + 200 → NOT_AUTHORIZED with basis robots', () => {
    expect(decide(obs(200), policy('disallowed'))).toEqual({
      decision: 'NOT_AUTHORIZED',
      reason: 'policy-disallow',
      basis: 'robots',
    });
  });

  it('451 → NOT_AUTHORIZED (unavailable for legal reasons)', () => {
    expect(decide(obs(451)).decision).toBe('NOT_AUTHORIZED');
  });

  it('429 → INFRA_PROBLEM', () => {
    expect(decide(obs(429))).toEqual({
      decision: 'INFRA_PROBLEM',
      reason: 'rate-limited',
      basis: 'http',
    });
  });

  it('500 → INFRA_PROBLEM', () => {
    expect(decide(obs(500)).decision).toBe('INFRA_PROBLEM');
  });

  it('530 (Cloudflare origin error) → INFRA_PROBLEM', () => {
    expect(decide(obs(530)).decision).toBe('INFRA_PROBLEM');
  });

  it('an unexpected cross-origin redirect → AMBIGUOUS', () => {
    expect(
      decide(obs(302, { location: 'https://other.example/landing' })),
    ).toEqual({
      decision: 'AMBIGUOUS',
      reason: 'cross-origin-redirect',
      basis: 'http',
    });
  });

  it('a 403 with an edge marker but no determinable cause → AMBIGUOUS', () => {
    expect(decide(obs(403, { cfRay: 'abc-123' }))).toEqual({
      decision: 'AMBIGUOUS',
      reason: 'indeterminate-forbidden',
      basis: 'http',
    });
  });

  it('a same-origin 3xx is observed but not followed → AMBIGUOUS', () => {
    expect(decide(obs(302, { location: '/resource/v2' }))).toEqual({
      decision: 'AMBIGUOUS',
      reason: 'unresolved-redirect',
      basis: 'http',
    });
  });
});
