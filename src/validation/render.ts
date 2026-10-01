import type { AuthorizationReason } from '../authorization/index.ts';
import type { RequestIdentityFidelity } from '../identity/index.ts';
import type { ValidationReport } from './report.ts';

const AUTHORIZATION_REASONS: Readonly<Record<AuthorizationReason, string>> = {
  ok: 'Request succeeded',
  'authentication-required': 'Authentication required',
  'login-redirect': 'Redirect to a login page',
  'mfa-required': 'Multi-factor authentication required',
  'interactive-challenge': 'Interactive bot challenge',
  'access-denied': 'The resource denied the agent',
  'policy-disallow':
    'Declared site policy (robots.txt) disallows this agent — a declared-policy denial, not an HTTP authentication/authorization refusal',
  'unavailable-legal': 'Unavailable for legal reasons',
  'rate-limited': 'Rate limited',
  'server-error': 'Server or origin error',
  'not-found': 'Resource not found',
  'unresolved-redirect':
    'Redirect observed but not followed (the flow may continue; the final resource was not accessed)',
  'cross-origin-redirect': 'Unexpected cross-origin redirect',
  'indeterminate-redirect': 'Redirect with no resolvable location',
  'indeterminate-forbidden': 'Forbidden for an undetermined reason',
  unknown: 'Unrecognized response',
};

const REQUEST_IDENTITY_LABELS: Readonly<
  Record<RequestIdentityFidelity, string>
> = {
  tool: 'AGENTPROOF',
  'vendor-documented': 'VENDOR-DOCUMENTED USER-AGENT',
  'token-only': 'TOKEN-ONLY',
};

const REASON_PHRASES: Readonly<Record<number, string>> = {
  200: 'OK',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  410: 'Gone',
  429: 'Too Many Requests',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function shout(value: string): string {
  return value.replace(/-/g, ' ').toUpperCase();
}

function httpLine(status: number): string {
  const phrase = REASON_PHRASES[status];
  return phrase === undefined ? String(status) : `${String(status)} ${phrase}`;
}

export function renderValidationReport(report: ValidationReport): string {
  const lines: string[] = [
    'AgentProof Validation',
    '',
    'Target',
    report.url,
    '',
    'Profile',
    report.profile.label,
    '',
    'Identity',
    shout(report.profile.assurance),
    '',
    'Request identity',
    REQUEST_IDENTITY_LABELS[report.profile.requestFidelity],
    '',
    ...(report.identity !== undefined
      ? [
          'External verification',
          shout(report.identity.externalVerification),
          '',
        ]
      : []),
    'HTTP',
    httpLine(report.access.status),
    '',
    'Access',
    shout(report.access.verdict),
    '',
    'Signal',
    shout(report.access.signal),
    '',
    'Policy',
    shout(report.policy.status),
    '',
    'Policy source',
    report.policy.source,
    '',
  ];

  const matched = report.policy.matchedRule;
  if (matched !== undefined) {
    lines.push(
      'Matched rule',
      `User-agent: ${matched.agent}`,
      `${matched.directive === 'allow' ? 'Allow' : 'Disallow'}: ${matched.path}`,
      '',
    );
  }

  lines.push(
    'Authorization',
    report.authorization.decision,
    '',
    'Reason',
    AUTHORIZATION_REASONS[report.authorization.reason],
    '',
  );

  lines.push(
    'Limitations',
    ...report.limitations.map((limitation) => `- ${limitation}`),
  );
  return lines.join('\n');
}
