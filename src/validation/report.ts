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
  limitations: readonly string[];
};

const CLAIMED_LIMITATION =
  'This request only claimed the agent identity through request metadata; it was not cryptographically verified.';
const TOKEN_ONLY_LIMITATION =
  'The request used only the documented/known agent token rather than a verified vendor request fingerprint.';
const SUCCESS_STATUS_LIMITATION =
  'The server returned a successful HTTP status. This does not prove that the expected content was present.';

export function buildValidationReport(
  url: string,
  profile: AgentProfile,
  observation: HttpObservation,
  policy: PolicyEvaluation,
): ValidationReport {
  const access = classifyAccessObservation(observation);

  const limitations: string[] = [];
  if (profile.assurance === 'claimed') {
    limitations.push(CLAIMED_LIMITATION);
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
