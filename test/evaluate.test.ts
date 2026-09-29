import { describe, expect, it } from 'vitest';
import {
  evaluatePolicy,
  type Policy,
  type PolicyRule,
} from '../src/policy/index.ts';

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

const policy = (rules: PolicyRule[]): Policy => ({ version: 1, rules });

describe('evaluatePolicy', () => {
  it('returns allow for a simple exact match', () => {
    const p = policy([exact('/docs', 'allow')]);
    expect(evaluatePolicy(p, 'a', '/docs')).toEqual({
      kind: 'decision',
      action: 'allow',
      rules: [exact('/docs', 'allow')],
    });
  });

  it('returns deny for a simple deny rule', () => {
    const p = policy([exact('/admin', 'deny')]);
    expect(evaluatePolicy(p, 'a', '/admin')).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [exact('/admin', 'deny')],
    });
  });

  it('returns no-match for a different agent', () => {
    const p = policy([exact('/docs', 'allow')]);
    expect(evaluatePolicy(p, 'b', '/docs')).toEqual({ kind: 'no-match' });
  });

  it('returns no-match for a different path (never deny)', () => {
    const p = policy([exact('/docs', 'allow')]);
    expect(evaluatePolicy(p, 'a', '/other')).toEqual({ kind: 'no-match' });
  });

  it('lets exact win over prefix', () => {
    const p = policy([
      prefix('/docs/', 'allow'),
      exact('/docs/private', 'deny'),
    ]);
    expect(evaluatePolicy(p, 'a', '/docs/private')).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [exact('/docs/private', 'deny')],
    });
  });

  it('lets a narrow allow win over a broad deny', () => {
    const p = policy([prefix('/', 'deny'), exact('/health', 'allow')]);
    expect(evaluatePolicy(p, 'a', '/health')).toEqual({
      kind: 'decision',
      action: 'allow',
      rules: [exact('/health', 'allow')],
    });
  });

  it('lets the longest prefix win', () => {
    const p = policy([
      prefix('/docs/', 'allow'),
      prefix('/docs/private/', 'deny'),
    ]);
    expect(evaluatePolicy(p, 'a', '/docs/private/file')).toEqual({
      kind: 'decision',
      action: 'deny',
      rules: [prefix('/docs/private/', 'deny')],
    });
  });

  it('surfaces a conflict', () => {
    const p = policy([exact('/admin', 'allow'), exact('/admin', 'deny')]);
    expect(evaluatePolicy(p, 'a', '/admin')).toEqual({
      kind: 'conflict',
      rules: [exact('/admin', 'allow'), exact('/admin', 'deny')],
    });
  });

  it('does not introduce path normalization', () => {
    const p = policy([prefix('/docs/', 'allow')]);
    expect(evaluatePolicy(p, 'a', '/docs/%2e%2e/admin')).toEqual({
      kind: 'decision',
      action: 'allow',
      rules: [prefix('/docs/', 'allow')],
    });
    // The literal, decoded-looking sibling does not start with "/docs/".
    expect(evaluatePolicy(p, 'a', '/docs%2Fsecret')).toEqual({
      kind: 'no-match',
    });
  });
});
