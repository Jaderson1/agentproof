import type { HttpObservation } from './probe.ts';

export type AccessVerdict = 'accessible' | 'denied' | 'inconclusive';

export type AccessSignal =
  | 'ok'
  | 'auth-required'
  | 'access-denied'
  | 'bot-challenge'
  | 'rate-limited'
  | 'unavailable-legal'
  | 'redirect'
  | 'not-found'
  | 'server-error'
  | 'unknown';

export type AccessClassification = {
  verdict: AccessVerdict;
  signal: AccessSignal;
};

function hasChallengeEvidence(observation: HttpObservation): boolean {
  return observation.cfMitigated === 'challenge';
}

export function classifyAccessObservation(
  observation: HttpObservation,
): AccessClassification {
  const status = observation.status;
  const challenge = hasChallengeEvidence(observation);

  if (status >= 200 && status < 300) {
    return { verdict: 'accessible', signal: 'ok' };
  }
  if (status === 401) {
    return { verdict: 'denied', signal: 'auth-required' };
  }
  if (status === 403) {
    return challenge
      ? { verdict: 'inconclusive', signal: 'bot-challenge' }
      : { verdict: 'denied', signal: 'access-denied' };
  }
  if (status === 429) {
    return { verdict: 'inconclusive', signal: 'rate-limited' };
  }
  if (status === 451) {
    return { verdict: 'denied', signal: 'unavailable-legal' };
  }
  if (status === 404 || status === 410) {
    return { verdict: 'inconclusive', signal: 'not-found' };
  }
  if (status >= 500 && status < 600) {
    return challenge
      ? { verdict: 'inconclusive', signal: 'bot-challenge' }
      : { verdict: 'inconclusive', signal: 'server-error' };
  }
  if (status >= 300 && status < 400) {
    return { verdict: 'inconclusive', signal: 'redirect' };
  }
  return { verdict: 'inconclusive', signal: 'unknown' };
}
