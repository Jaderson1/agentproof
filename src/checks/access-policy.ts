import type { CheckResult } from '../audit/index.ts';
import type { HttpObservation } from '../http/index.ts';
import type { PolicyDecision } from '../policy/index.ts';

const CHECK_ID = 'access-policy';
const CHECK_TITLE = 'Access policy enforcement';

type AccessKind = 'accessible' | 'denied' | 'other';

// Conservative: only 2xx = accessible, only 401/403 = denied; the rest is not evidence.
function classifyStatus(status: number): AccessKind {
  if (status >= 200 && status < 300) {
    return 'accessible';
  }
  if (status === 401 || status === 403) {
    return 'denied';
  }
  return 'other';
}

// A 401/403 shows the request was denied at the HTTP layer, not that this policy caused it.
export function evaluateAccessObservation(
  decision: PolicyDecision,
  observation: HttpObservation,
): CheckResult {
  const base = { id: CHECK_ID, title: CHECK_TITLE } as const;
  const http = `HTTP ${String(observation.status)}`;

  if (decision.kind === 'no-match') {
    return {
      ...base,
      status: 'inconclusive',
      expected: 'an explicit allow or deny rule',
      observed: 'no matching policy rule',
      message:
        'No policy rule applies to this request, so enforcement cannot be judged.',
    };
  }

  if (decision.kind === 'conflict') {
    return {
      ...base,
      status: 'inconclusive',
      expected: 'unambiguous policy decision',
      observed: 'conflicting policy rules',
      message:
        'The policy has conflicting rules for this request, so enforcement cannot be judged.',
    };
  }

  const access = classifyStatus(observation.status);
  const expected = decision.action;

  if (decision.action === 'allow') {
    if (access === 'accessible') {
      return {
        ...base,
        status: 'pass',
        expected,
        observed: http,
        message: `The request returned ${http}, consistent with the declared allow policy.`,
      };
    }
    if (access === 'denied') {
      return {
        ...base,
        status: 'fail',
        expected,
        observed: http,
        message: `The request was denied with ${http}, but the declared policy allows access.`,
      };
    }
    return {
      ...base,
      status: 'inconclusive',
      expected,
      observed: http,
      message: `${http} does not provide enough evidence to determine whether the declared allow policy is enforced.`,
    };
  }

  if (access === 'accessible') {
    return {
      ...base,
      status: 'fail',
      expected,
      observed: http,
      message: `The request returned ${http} even though the declared policy denies access.`,
    };
  }
  if (access === 'denied') {
    return {
      ...base,
      status: 'pass',
      expected,
      observed: http,
      message: `The request was denied with ${http}, consistent with the declared deny policy. This alone does not prove the agent policy caused the block.`,
    };
  }
  return {
    ...base,
    status: 'inconclusive',
    expected,
    observed: http,
    message: `${http} does not provide enough evidence to determine whether the declared deny policy is enforced.`,
  };
}
