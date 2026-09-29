import { describe, expect, it } from 'vitest';
import { matchesPath, type PathMatcher } from '../src/policy/index.ts';

const exact = (value: string): PathMatcher => ({ kind: 'exact', value });
const prefix = (value: string): PathMatcher => ({ kind: 'prefix', value });

describe('matchesPath — exact', () => {
  const matcher = exact('/admin');

  it('matches the identical path', () => {
    expect(matchesPath(matcher, '/admin')).toBe(true);
  });

  it('does not match a different trailing slash', () => {
    expect(matchesPath(matcher, '/admin/')).toBe(false);
  });

  it('does not match a different case', () => {
    expect(matchesPath(matcher, '/Admin')).toBe(false);
  });

  it('does not match a child path', () => {
    expect(matchesPath(matcher, '/admin/users')).toBe(false);
  });

  it('matches root against a root matcher', () => {
    expect(matchesPath(exact('/'), '/')).toBe(true);
    expect(matchesPath(exact('/'), '/x')).toBe(false);
  });
});

describe('matchesPath — prefix', () => {
  const matcher = prefix('/docs/');

  it('matches the prefix itself', () => {
    expect(matchesPath(matcher, '/docs/')).toBe(true);
  });

  it('matches a simple child', () => {
    expect(matchesPath(matcher, '/docs/api')).toBe(true);
  });

  it('matches a deep child', () => {
    expect(matchesPath(matcher, '/docs/api/v1')).toBe(true);
  });

  it('does not match the prefix without its trailing slash', () => {
    expect(matchesPath(matcher, '/docs')).toBe(false);
  });

  it('does not match a different case', () => {
    expect(matchesPath(matcher, '/Docs/')).toBe(false);
  });

  it('does not match when the prefix appears mid-string', () => {
    expect(matchesPath(matcher, '/foo/docs/')).toBe(false);
  });
});

describe('matchesPath — literal preservation (no canonicalization)', () => {
  const matcher = prefix('/docs/');

  it.each([
    '/docs/../admin',
    '/docs/%2e%2e/admin',
    '/docs//admin',
    '/docs/%2Fadmin',
  ])('treats %s as a literal match', (candidate) => {
    expect(matchesPath(matcher, candidate)).toBe(true);
  });

  it('does not match /docs%2Fsecret against prefix /docs/', () => {
    expect(matchesPath(matcher, '/docs%2Fsecret')).toBe(false);
  });
});
