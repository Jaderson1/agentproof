import { describe, expect, it } from 'vitest';
import type { HttpObservation } from '../src/http/index.ts';
import { getAgentProfile, type AgentProfile } from '../src/identity/index.ts';
import {
  evaluateRobotsPolicy,
  type PolicyEvaluation,
} from '../src/robots/index.ts';
import {
  buildValidationReport,
  renderValidationReport,
  validationExitCode,
} from '../src/validation/index.ts';

const obs = (
  status: number,
  extra: Partial<HttpObservation> = {},
): HttpObservation => ({
  requestedUrl: 'http://example.test/a',
  status,
  ...extra,
});

const profile = (id: string): AgentProfile => {
  const found = getAgentProfile(id);
  if (found === undefined) {
    throw new Error(`missing test profile: ${id}`);
  }
  return found;
};

const noRobots = (
  ua = 'AgentProof',
  target = 'http://example.test/a',
): PolicyEvaluation =>
  evaluateRobotsPolicy(
    {
      kind: 'unavailable',
      url: 'http://example.test/robots.txt',
      status: 404,
      reason: 'not-found',
    },
    ua,
    target,
  );

const robotsAllow = (): PolicyEvaluation =>
  evaluateRobotsPolicy(
    {
      kind: 'available',
      url: 'http://example.test/robots.txt',
      status: 200,
      body: 'User-agent: OAI-SearchBot\nAllow: /docs/\n',
    },
    'OAI-SearchBot',
    'http://example.test/docs/page',
  );

const TOKEN_ONLY_LIMITATION =
  'The request used only the documented/known agent token rather than a verified vendor request fingerprint.';
const CLAIMED_LIMITATION =
  'This request only claimed the agent identity through request metadata; it was not cryptographically verified.';

describe('buildValidationReport', () => {
  it('reports a claimed, token-only denial with the right limitations', () => {
    const report = buildValidationReport(
      'http://example.test/a',
      profile('oai-searchbot'),
      obs(403),
      noRobots('OAI-SearchBot'),
    );
    expect(report.access).toEqual({
      verdict: 'denied',
      signal: 'access-denied',
      status: 403,
    });
    expect(report.profile.assurance).toBe('claimed');
    expect(report.profile.requestFidelity).toBe('token-only');
    expect(report.policy.status).toBe('unknown');
    expect(report.policy.source).toBe('robots.txt');
    expect(report.limitations).toContain(CLAIMED_LIMITATION);
    expect(report.limitations).toContain(TOKEN_ONLY_LIMITATION);
    expect(report.limitations).toContain(
      'robots.txt was not found; declared policy is unknown.',
    );
  });

  it('omits the claimed and token-only caveats for the unclaimed profile', () => {
    const report = buildValidationReport(
      'http://example.test/a',
      profile('unclaimed'),
      obs(200),
      noRobots(),
    );
    expect(report.access.verdict).toBe('accessible');
    expect(report.profile.assurance).toBe('unclaimed');
    expect(report.profile.requestFidelity).toBe('tool');
    expect(report.limitations).toContain(
      'The server returned a successful HTTP status. This does not prove that the expected content was present.',
    );
    expect(report.limitations).not.toContain(CLAIMED_LIMITATION);
    expect(report.limitations).not.toContain(TOKEN_ONLY_LIMITATION);
  });

  it('carries a resolved robots policy as an independent axis from access', () => {
    const report = buildValidationReport(
      'http://example.test/docs/page',
      profile('oai-searchbot'),
      obs(403),
      robotsAllow(),
    );
    // Policy allowed while access is denied — the two axes must not collapse.
    expect(report.policy.status).toBe('allowed');
    expect(report.policy.matchedRule).toEqual({
      agent: 'OAI-SearchBot',
      directive: 'allow',
      path: '/docs/',
    });
    expect(report.access.verdict).toBe('denied');
  });
});

describe('validationExitCode', () => {
  it('maps accessible and denied to 0, inconclusive to 2', () => {
    const at = (status: number): number =>
      validationExitCode(
        buildValidationReport(
          'http://x/',
          profile('unclaimed'),
          obs(status),
          noRobots('AgentProof', 'http://x/'),
        ),
      );
    expect(at(200)).toBe(0);
    expect(at(403)).toBe(0);
    expect(at(429)).toBe(2);
  });
});

describe('renderValidationReport', () => {
  it('renders a claimed vendor profile with token-only request identity', () => {
    const text = renderValidationReport(
      buildValidationReport(
        'http://example.test/a',
        profile('oai-searchbot'),
        obs(403),
        noRobots('OAI-SearchBot'),
      ),
    );
    expect(text).toContain('AgentProof Validation');
    expect(text).toContain('OAI-SearchBot');
    expect(text).toContain('403 Forbidden');
    expect(text).toContain('DENIED');
    expect(text).toContain('ACCESS DENIED');
    expect(text).toContain('Identity\nCLAIMED');
    expect(text).toContain('Request identity\nTOKEN-ONLY');
    expect(text).toContain('Policy\nUNKNOWN');
    expect(text).toContain('Policy source\nrobots.txt');
  });

  it('renders the matched robots rule when the policy is determined', () => {
    const text = renderValidationReport(
      buildValidationReport(
        'http://example.test/docs/page',
        profile('oai-searchbot'),
        obs(200),
        robotsAllow(),
      ),
    );
    expect(text).toContain('Policy\nALLOWED');
    expect(text).toContain('Matched rule');
    expect(text).toContain('User-agent: OAI-SearchBot');
    expect(text).toContain('Allow: /docs/');
  });

  it('renders the unclaimed profile with AGENTPROOF request identity', () => {
    const text = renderValidationReport(
      buildValidationReport(
        'http://example.test/a',
        profile('unclaimed'),
        obs(200),
        noRobots(),
      ),
    );
    expect(text).toContain('Identity\nUNCLAIMED');
    expect(text).toContain('Request identity\nAGENTPROOF');
  });
});
