import { findMatchingRules } from './find-matches.ts';
import type { Policy, PolicyDecision } from './model.ts';
import { resolvePolicyDecision } from './resolve.ts';

// No default: when nothing applies the result stays no-match, never deny.
export function evaluatePolicy(
  policy: Policy,
  agent: string,
  candidatePath: string,
): PolicyDecision {
  return resolvePolicyDecision(findMatchingRules(policy, agent, candidatePath));
}
