import { describe, expect, it } from 'vitest';
import {
  findMatchingRules,
  type Policy,
  type PolicyRule,
} from '../src/policy/index.ts';

const rule = (
  agent: string,
  path: PolicyRule['path'],
  action: PolicyRule['action'],
): PolicyRule => ({ agent, path, action });

const policy = (rules: PolicyRule[]): Policy => ({ version: 1, rules });

describe('findMatchingRules', () => {
  it('returns nothing when no rule matches', () => {
    const p = policy([rule('a', { kind: 'exact', value: '/admin' }, 'deny')]);
    expect(findMatchingRules(p, 'a', '/docs/')).toEqual([]);
  });

  it('matches by exact', () => {
    const target = rule('a', { kind: 'exact', value: '/admin' }, 'deny');
    const p = policy([target]);
    expect(findMatchingRules(p, 'a', '/admin')).toEqual([target]);
  });

  it('matches by prefix', () => {
    const target = rule('a', { kind: 'prefix', value: '/docs/' }, 'allow');
    const p = policy([target]);
    expect(findMatchingRules(p, 'a', '/docs/api')).toEqual([target]);
  });

  it('does not match when the path matches but the agent does not', () => {
    const p = policy([rule('a', { kind: 'prefix', value: '/docs/' }, 'allow')]);
    expect(findMatchingRules(p, 'b', '/docs/api')).toEqual([]);
  });

  it('does not match when the agent matches but the path does not', () => {
    const p = policy([rule('a', { kind: 'exact', value: '/admin' }, 'deny')]);
    expect(findMatchingRules(p, 'a', '/docs/')).toEqual([]);
  });

  it('compares the agent case-sensitively', () => {
    const p = policy([
      rule('example-agent', { kind: 'prefix', value: '/' }, 'allow'),
    ]);
    expect(findMatchingRules(p, 'Example-Agent', '/x')).toEqual([]);
    expect(findMatchingRules(p, 'example-agent', '/x')).toHaveLength(1);
  });

  it('only returns rules for the requested agent in a multi-agent policy', () => {
    const forA = rule('a', { kind: 'prefix', value: '/docs/' }, 'allow');
    const forB = rule('b', { kind: 'prefix', value: '/docs/' }, 'allow');
    const p = policy([forA, forB]);
    expect(findMatchingRules(p, 'b', '/docs/x')).toEqual([forB]);
  });

  it('preserves the original policy order', () => {
    const first = rule('a', { kind: 'prefix', value: '/docs/' }, 'allow');
    const skipped = rule('a', { kind: 'exact', value: '/other' }, 'deny');
    const third = rule('a', { kind: 'prefix', value: '/docs/api' }, 'deny');
    const p = policy([first, skipped, third]);
    expect(findMatchingRules(p, 'a', '/docs/api')).toEqual([first, third]);
  });

  it('returns overlapping allow and deny rules without choosing a winner', () => {
    const allow = rule('a', { kind: 'prefix', value: '/docs/' }, 'allow');
    const deny = rule('a', { kind: 'exact', value: '/docs/private' }, 'deny');
    const p = policy([allow, deny]);

    const matches = findMatchingRules(p, 'a', '/docs/private');

    expect(matches).toHaveLength(2);
    expect(matches).toEqual([allow, deny]);
  });
});
