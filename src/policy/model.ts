export type PolicyAction = 'allow' | 'deny';

export type PathMatcher =
  { kind: 'exact'; value: string } | { kind: 'prefix'; value: string };

export type PolicyRule = {
  agent: string;
  path: PathMatcher;
  action: PolicyAction;
};

export type Policy = {
  version: 1;
  rules: PolicyRule[];
};

export type PolicyDecision =
  | { kind: 'decision'; action: PolicyAction; rules: readonly PolicyRule[] }
  | { kind: 'no-match' }
  | { kind: 'conflict'; rules: readonly PolicyRule[] };
