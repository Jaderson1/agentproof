import { matchesPath } from './match.ts';
import type { Policy, PolicyRule } from './model.ts';

// Selection only, in policy order: no winner is chosen and no precedence applied.
export function findMatchingRules(
  policy: Policy,
  agent: string,
  candidatePath: string,
): readonly PolicyRule[] {
  return policy.rules.filter(
    (rule) => rule.agent === agent && matchesPath(rule.path, candidatePath),
  );
}
