import { describe, expect, it } from 'vitest';
import { resolvePolicyDecision, type PolicyRule } from '../src/policy/index.ts';

const exact = (
  value: string,
  action: PolicyRule['action'],
  agent = 'a',
): PolicyRule => ({ agent, path: { kind: 'exact', value }, action });

const prefix = (
  value: string,
  action: PolicyRule['action'],
  agent = 'a',
): PolicyRule => ({ agent, path: { kind: 'prefix', value }, action });

describe('resolvePolicyDecision', () => {
  it('returns no-match for an empty list', () => {
    expect(resolvePolicyDecision([])).toEqual({ kind: 'no-match' });
  });

  it('returns the single rule as the decision', () => {
    expect(resolvePolicyDecision([exact('/admin', 'allow')])).toEqual({
      kind: 'decision',
      action: 'allow',
      rules: [exact('/admin', 'allow')],
    });
    expect(resolvePolicyDecision([prefix('/docs/', 'deny')])).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [prefix('/docs/', 'deny')],
    });
  });

  it('lets exact beat prefix (deny wins here)', () => {
    const decision = resolvePolicyDecision([
      prefix('/docs/', 'allow'),
      exact('/docs/private', 'deny'),
    ]);
    expect(decision).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [exact('/docs/private', 'deny')],
    });
  });

  it('lets a narrow allow beat a broad deny (no global deny-overrides)', () => {
    const decision = resolvePolicyDecision([
      prefix('/', 'deny'),
      exact('/health', 'allow'),
    ]);
    expect(decision).toEqual({
      kind: 'decision',
      action: 'allow',
      rules: [exact('/health', 'allow')],
    });
  });

  it('lets the longest prefix win', () => {
    const decision = resolvePolicyDecision([
      prefix('/docs/', 'allow'),
      prefix('/docs/private/', 'deny'),
    ]);
    expect(decision).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [prefix('/docs/private/', 'deny')],
    });
  });

  it('reports a conflict for contradictory identical exacts', () => {
    const decision = resolvePolicyDecision([
      exact('/admin', 'allow'),
      exact('/admin', 'deny'),
    ]);
    expect(decision).toEqual({
      kind: 'conflict',
      rules: [exact('/admin', 'allow'), exact('/admin', 'deny')],
    });
  });

  it('reports a conflict for contradictory identical prefixes', () => {
    const decision = resolvePolicyDecision([
      prefix('/docs/', 'allow'),
      prefix('/docs/', 'deny'),
    ]);
    expect(decision).toEqual({
      kind: 'conflict',
      rules: [prefix('/docs/', 'allow'), prefix('/docs/', 'deny')],
    });
  });

  it('treats a same-action tie as a decision carrying both rules', () => {
    const decision = resolvePolicyDecision([
      exact('/admin', 'allow'),
      exact('/admin', 'allow'),
    ]);
    expect(decision).toEqual({
      kind: 'decision',
      action: 'allow',
      rules: [exact('/admin', 'allow'), exact('/admin', 'allow')],
    });
  });

  it('ignores less specific rules, keeping only the most specific winner', () => {
    const decision = resolvePolicyDecision([
      prefix('/', 'allow'),
      prefix('/docs/', 'deny'),
      exact('/docs/private', 'deny'),
    ]);
    expect(decision).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [exact('/docs/private', 'deny')],
    });
  });
});
