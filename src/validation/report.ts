import {
  decideAuthorization,
  type AuthorizationResult,
} from '../authorization/index.ts';
import {
  classifyAccessObservation,
  type AccessSignal,
  type AccessVerdict,
  type HttpObservation,
} from '../http/index.ts';
import type {
  AgentProfile,
  IdentityAssurance,
  RequestIdentityFidelity,
} from '../identity/index.ts';
import type { PolicyEvaluation, PolicyResult } from '../robots/index.ts';

// Present only for a signed request. `signature: 'present'` states that the
// request carried an AgentProof signature; `externalVerification` stays
// 'not-confirmed' here — `validate` never claims external recognition, which
// only the dedicated verifier test can establish.
export type ReportIdentity = {
  signature: 'present' | 'absent';
  externalVerification: 'not-confirmed';
};

export type ValidationReport = {
  url: string;
  profile: {
    id: string;
    label: string;
    assurance: IdentityAssurance;
    requestFidelity: RequestIdentityFidelity;
  };
  access: {
    verdict: AccessVerdict;
    signal: AccessSignal;
    status: number;
  };
  policy: PolicyResult;
  // The final, AI-facing decision axis, distinct from identity/access/policy.
  authorization: AuthorizationResult;
  identity?: ReportIdentity;
  limitations: readonly string[];
};

const CLAIMED_LIMITATION =
  'This request only claimed the agent identity through request metadata; it was not cryptographically verified.';
const TOKEN_ONLY_LIMITATION =
  'The request used only the documented/known agent token rather than a verified vendor request fingerprint.';
const SUCCESS_STATUS_LIMITATION =
  'The server returned a successful HTTP status. This does not prove that the expected content was present.';

const SIGNED_LIMITATION =
  'The request was signed with the AgentProof key. This proves possession of the key, not external recognition; the signature was not confirmed by any verifier here.';

export function buildValidationReport(
  url: string,
  profile: AgentProfile,
  observation: HttpObservation,
  policy: PolicyEvaluation,
  identity?: ReportIdentity,
): ValidationReport {
  const access = classifyAccessObservation(observation);
  const authorization = decideAuthorization(
    observation,
    access,
    policy.result,
    url,
  );

  const limitations: string[] = [];
  if (profile.assurance === 'claimed') {
    limitations.push(CLAIMED_LIMITATION);
  }
  if (identity !== undefined && identity.signature === 'present') {
    limitations.push(SIGNED_LIMITATION);
  }
  if (profile.requestFidelity === 'token-only') {
    limitations.push(TOKEN_ONLY_LIMITATION);
  }
  limitations.push(policy.limitation);
  if (access.verdict === 'accessible') {
    limitations.push(SUCCESS_STATUS_LIMITATION);
  }

  return {
    url,
    profile: {
      id: profile.id,
      label: profile.label,
      assurance: profile.assurance,
      requestFidelity: profile.requestFidelity,
    },
    access: {
      verdict: access.verdict,
      signal: access.signal,
      status: observation.status,
    },
    policy: policy.result,
    authorization,
    ...(identity !== undefined ? { identity } : {}),
    limitations,
  };
}

export function validationExitCode(report: ValidationReport): number {
  switch (report.access.verdict) {
    case 'accessible':
    case 'denied':
      return 0;
    case 'inconclusive':
      return 2;
  }
}
