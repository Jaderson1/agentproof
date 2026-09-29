import { describe, expect, it } from 'vitest';
import {
  parsePolicy,
  PolicyParseError,
  type Policy,
} from '../src/policy/index.ts';

describe('parsePolicy — valid', () => {
  it('normalizes an exact matcher with deny', () => {
    const policy = parsePolicy(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /admin',
        '    action: deny',
      ].join('\n'),
    );
    expect(policy).toEqual({
      version: 1,
      rules: [
        {
          agent: 'a',
          path: { kind: 'exact', value: '/admin' },
          action: 'deny',
        },
      ],
    } satisfies Policy);
  });

  it('normalizes a prefix matcher with allow', () => {
    const policy = parsePolicy(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      prefix: /docs/',
        '    action: allow',
      ].join('\n'),
    );
    expect(policy).toEqual({
      version: 1,
      rules: [
        {
          agent: 'a',
          path: { kind: 'prefix', value: '/docs/' },
          action: 'allow',
        },
      ],
    } satisfies Policy);
  });

  it('keeps multiple rules in order', () => {
    const policy = parsePolicy(
      [
        'version: 1',
        'rules:',
        '  - agent: openai',
        '    path:',
        '      prefix: /docs/',
        '    action: allow',
        '  - agent: openai',
        '    path:',
        '      exact: /admin',
        '    action: deny',
      ].join('\n'),
    );
    expect(policy.rules).toEqual([
      {
        agent: 'openai',
        path: { kind: 'prefix', value: '/docs/' },
        action: 'allow',
      },
      {
        agent: 'openai',
        path: { kind: 'exact', value: '/admin' },
        action: 'deny',
      },
    ]);
  });

  it('preserves the path verbatim (no canonicalization)', () => {
    const policy = parsePolicy(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /Docs/../Admin/',
        '    action: deny',
      ].join('\n'),
    );
    expect(policy.rules[0]?.path).toEqual({
      kind: 'exact',
      value: '/Docs/../Admin/',
    });
  });
});

describe('parsePolicy — invalid', () => {
  function expectReject(source: string): void {
    expect(() => parsePolicy(source)).toThrow(PolicyParseError);
  }

  it('rejects version other than 1', () => {
    expectReject(
      [
        'version: 2',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /a',
        '    action: allow',
      ].join('\n'),
    );
  });

  it('rejects an empty rules list', () => {
    expectReject(['version: 1', 'rules: []'].join('\n'));
  });

  it('rejects an empty agent', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: ""',
        '    path:',
        '      exact: /a',
        '    action: allow',
      ].join('\n'),
    );
  });

  it('rejects an unknown action', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /a',
        '    action: challenge',
      ].join('\n'),
    );
  });

  it('rejects a path without a leading slash', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: admin',
        '    action: deny',
      ].join('\n'),
    );
  });

  it('rejects exact and prefix together', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /a',
        '      prefix: /b/',
        '    action: deny',
      ].join('\n'),
    );
  });

  it('rejects a path with no matcher', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path: {}',
        '    action: deny',
      ].join('\n'),
    );
  });

  it('rejects a query string in the path', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /a?x=1',
        '    action: deny',
      ].join('\n'),
    );
  });

  it('rejects a fragment in the path', () => {
    expectReject(
      [
        'version: 1',
        'rules:',
        '  - agent: a',
        '    path:',
        '      exact: /a#top',
        '    action: deny',
      ].join('\n'),
    );
  });

  it('rejects invalid YAML', () => {
    expectReject('rules: [unterminated');
  });
});
