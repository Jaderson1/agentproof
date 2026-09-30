import { describe, expect, it } from 'vitest';
import {
  classifyAccessObservation,
  type AccessSignal,
  type AccessVerdict,
  type HttpObservation,
} from '../src/http/index.ts';

const obs = (
  status: number,
  extra: Partial<HttpObservation> = {},
): HttpObservation => ({
  requestedUrl: 'http://example.test/',
  status,
  ...extra,
});

describe('classifyAccessObservation', () => {
  it.each<[number, AccessVerdict, AccessSignal]>([
    [200, 'accessible', 'ok'],
    [204, 'accessible', 'ok'],
    [401, 'denied', 'auth-required'],
    [403, 'denied', 'access-denied'],
    [429, 'inconclusive', 'rate-limited'],
    [451, 'denied', 'unavailable-legal'],
    [302, 'inconclusive', 'redirect'],
    [404, 'inconclusive', 'not-found'],
    [410, 'inconclusive', 'not-found'],
    [500, 'inconclusive', 'server-error'],
  ])('%i without challenge → %s / %s', (status, verdict, signal) => {
    expect(classifyAccessObservation(obs(status))).toEqual({ verdict, signal });
  });

  it('403 with cf-mitigated challenge → inconclusive / bot-challenge', () => {
    expect(
      classifyAccessObservation(obs(403, { cfMitigated: 'challenge' })),
    ).toEqual({ verdict: 'inconclusive', signal: 'bot-challenge' });
  });

  it('503 with cf-mitigated challenge → inconclusive / bot-challenge', () => {
    expect(
      classifyAccessObservation(obs(503, { cfMitigated: 'challenge' })),
    ).toEqual({ verdict: 'inconclusive', signal: 'bot-challenge' });
  });

  it('cf-ray alone does not imply a challenge', () => {
    expect(classifyAccessObservation(obs(403, { cfRay: 'abc-123' }))).toEqual({
      verdict: 'denied',
      signal: 'access-denied',
    });
  });

  it('falls back to inconclusive / unknown', () => {
    expect(classifyAccessObservation(obs(418))).toEqual({
      verdict: 'inconclusive',
      signal: 'unknown',
    });
  });
});
