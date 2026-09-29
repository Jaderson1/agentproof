import type { PolicyDecision, PolicyRule } from './model.ts';

// exact beats any prefix; longer prefix beats shorter; equal keys tie.
type SpecKey = { tier: number; length: number };

function specificityKey(rule: PolicyRule): SpecKey {
  return rule.path.kind === 'exact'
    ? { tier: 1, length: 0 }
    : { tier: 0, length: rule.path.value.length };
}

function compareKeys(a: SpecKey, b: SpecKey): number {
  return a.tier !== b.tier ? a.tier - b.tier : a.length - b.length;
}

export function resolvePolicyDecision(
  matchingRules: readonly PolicyRule[],
): PolicyDecision {
  let winners: PolicyRule[] = [];
  let bestKey: SpecKey | undefined;

  for (const rule of matchingRules) {
    const key = specificityKey(rule);
    if (bestKey === undefined || compareKeys(key, bestKey) > 0) {
      bestKey = key;
      winners = [rule];
    } else if (compareKeys(key, bestKey) === 0) {
      winners.push(rule);
    }
  }

  if (winners.length === 0) {
    return { kind: 'no-match' };
  }

  const hasAllow = winners.some((rule) => rule.action === 'allow');
  const hasDeny = winners.some((rule) => rule.action === 'deny');
  if (hasAllow && hasDeny) {
    return { kind: 'conflict', rules: winners };
  }

  return {
    kind: 'decision',
    action: hasDeny ? 'deny' : 'allow',
    rules: winners,
  };
}
