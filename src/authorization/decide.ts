import {
  hasChallengeEvidence,
  type AccessClassification,
  type HttpObservation,
} from '../http/index.ts';
import type { PolicyResult } from '../robots/index.ts';

// The final, AI-facing decision axis. It SYNTHESIZES the existing identity /
// access / policy signals into one verdict using only signals AgentProof
// already collects; it does not re-probe, scrape HTML, or bypass anything.
// An interactive challenge (CAPTCHA/bot challenge) is always NEEDS_USER —
// never an attempt to evade.
export type AuthorizationDecision =
  | 'CAN_PROCEED'
  | 'NEEDS_USER'
  | 'NOT_AUTHORIZED'
  | 'INFRA_PROBLEM'
  | 'AMBIGUOUS';

export type AuthorizationReason =
  | 'ok'
  | 'authentication-required'
  | 'login-redirect'
  | 'mfa-required'
  | 'interactive-challenge'
  | 'access-denied'
  | 'policy-disallow'
  | 'unavailable-legal'
  | 'rate-limited'
  | 'server-error'
  | 'not-found'
  | 'unresolved-redirect'
  | 'cross-origin-redirect'
  | 'indeterminate-redirect'
  | 'indeterminate-forbidden'
  | 'unknown';

// Where the decision came from. 'robots' = the site's DECLARED policy
// (RFC 9309), which is NOT an HTTP access-authorization mechanism; a
// NOT_AUTHORIZED with basis 'robots' means "not authorized by declared policy",
// not "the server refused authentication/authorization". 'http' = derived from
// the observed HTTP response.
export type AuthorizationBasis = 'http' | 'robots';

export type AuthorizationResult = {
  decision: AuthorizationDecision;
  reason: AuthorizationReason;
  basis: AuthorizationBasis;
};

const LOGIN_RE =
  /(?:^|\/)(?:login|signin|sign-in|sso|oauth|authorize|account|session)(?:[/?#]|$)/i;
const MFA_RE = /(?:^|\/)(?:mfa|2fa|otp|one-time|verify|challenge)(?:[/?#]|$)/i;
const EDGE_SERVER_RE = /(cloudflare|akamai|sucuri|imperva|fastly|incapsula)/i;

function result(
  decision: AuthorizationDecision,
  reason: AuthorizationReason,
  basis: AuthorizationBasis = 'http',
): AuthorizationResult {
  return { decision, reason, basis };
}

function resolvedLocation(
  observation: HttpObservation,
  targetUrl: string,
): string | null {
  if (observation.location === undefined) {
    return null;
  }
  try {
    return new URL(observation.location, targetUrl).href.toLowerCase();
  } catch {
    return observation.location.toLowerCase();
  }
}

function isSameOrigin(
  observation: HttpObservation,
  targetUrl: string,
): boolean {
  if (observation.location === undefined) {
    return false;
  }
  try {
    return (
      new URL(observation.location, targetUrl).origin ===
      new URL(targetUrl).origin
    );
  } catch {
    return false;
  }
}

// An edge/WAF marker on a plain 403 means we cannot safely attribute the denial
// to the site's authorization policy for this agent — so it is AMBIGUOUS, not a
// confident NOT_AUTHORIZED.
function hasEdgeMarker(observation: HttpObservation): boolean {
  if (observation.cfRay !== undefined) {
    return true;
  }
  return (
    observation.server !== undefined && EDGE_SERVER_RE.test(observation.server)
  );
}

// `validate` observes a 3xx but does NOT follow it (redirect: 'manual'), so a
// same-origin redirect is reported as AMBIGUOUS/unresolved-redirect — the flow
// may continue, but the final resource was not accessed. Login/MFA redirects
// are the exception: they clearly need the user.
function decideRedirect(
  observation: HttpObservation,
  targetUrl: string,
): AuthorizationResult {
  const location = resolvedLocation(observation, targetUrl);
  if (location === null) {
    return result('AMBIGUOUS', 'indeterminate-redirect');
  }
  if (MFA_RE.test(location)) {
    return result('NEEDS_USER', 'mfa-required');
  }
  if (LOGIN_RE.test(location)) {
    return result('NEEDS_USER', 'login-redirect');
  }
  if (isSameOrigin(observation, targetUrl)) {
    return result('AMBIGUOUS', 'unresolved-redirect');
  }
  return result('AMBIGUOUS', 'cross-origin-redirect');
}

// Precedence (highest first):
//   1. challenge / authentication  → NEEDS_USER   (even over a 2xx)
//   2. transient server / rate      → INFRA_PROBLEM
//   3. explicit declared-policy denial (robots) → NOT_AUTHORIZED
//   4. unresolved / ambiguous redirect → AMBIGUOUS
//   5. successful response, no conflicting signal → CAN_PROCEED
export function decideAuthorization(
  observation: HttpObservation,
  access: AccessClassification,
  policy: PolicyResult,
  targetUrl: string,
): AuthorizationResult {
  const signal = access.signal;
  const redirect =
    signal === 'redirect' ? decideRedirect(observation, targetUrl) : null;

  // 1) Needs the human. A challenge outranks everything, including a 200.
  if (hasChallengeEvidence(observation)) {
    return result('NEEDS_USER', 'interactive-challenge');
  }
  if (signal === 'auth-required') {
    return result('NEEDS_USER', 'authentication-required');
  }
  if (redirect !== null && redirect.decision === 'NEEDS_USER') {
    return redirect;
  }

  // 2) Transient infrastructure problems.
  if (signal === 'rate-limited') {
    return result('INFRA_PROBLEM', 'rate-limited');
  }
  if (signal === 'server-error') {
    return result('INFRA_PROBLEM', 'server-error');
  }

  // 3) Declared-policy denial (independent axis; not HTTP authz — see basis).
  if (policy.status === 'disallowed') {
    return result('NOT_AUTHORIZED', 'policy-disallow', 'robots');
  }

  // 4) Redirect we observed but did not follow.
  if (redirect !== null) {
    return redirect;
  }

  // 5) Determinate HTTP outcomes.
  if (signal === 'ok') {
    return result('CAN_PROCEED', 'ok');
  }
  if (signal === 'access-denied') {
    return hasEdgeMarker(observation)
      ? result('AMBIGUOUS', 'indeterminate-forbidden')
      : result('NOT_AUTHORIZED', 'access-denied');
  }
  if (signal === 'unavailable-legal') {
    return result('NOT_AUTHORIZED', 'unavailable-legal');
  }
  if (signal === 'not-found') {
    return result('AMBIGUOUS', 'not-found');
  }
  return result('AMBIGUOUS', 'unknown');
}
