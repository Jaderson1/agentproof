import type { RobotsObservation } from './fetch.ts';
import { parseRobots, type RobotsGroup, type RobotsRule } from './parse.ts';

export type PolicyStatus = 'allowed' | 'disallowed' | 'unknown';

export type PolicyMatchedRule = {
  agent: string;
  directive: 'allow' | 'disallow';
  path: string;
};

export type PolicyResult = {
  status: PolicyStatus;
  source: 'robots.txt';
  matchedRule?: PolicyMatchedRule;
};

export type PolicyEvaluation = {
  result: PolicyResult;
  limitation: string;
};

const SOURCE = 'robots.txt' as const;

const DECLARATIVE_LIMITATION =
  'A robots.txt rule reflects a declared crawler preference; it does not guarantee or deny actual HTTP access.';
const UNSUPPORTED_PATTERN_LIMITATION =
  'robots.txt uses an unsupported path pattern (* or $) for this agent; declared policy is unknown.';

type SelectedGroup = { agent: string; rules: readonly RobotsRule[] };

function unavailableLimitation(
  observation: Extract<RobotsObservation, { kind: 'unavailable' }>,
): string {
  switch (observation.reason) {
    case 'too-large':
      return 'robots.txt exceeded the size limit and was not evaluated; declared policy is unknown.';
    case 'not-found':
      return 'robots.txt was not found; declared policy is unknown.';
    case 'timeout':
      return 'robots.txt could not be fetched (timeout); declared policy is unknown.';
    default:
      return 'robots.txt could not be fetched; declared policy is unknown.';
  }
}

// Specific group wins over the wildcard group; rules from every group that
// names a matching agent are merged. No specific and no wildcard group means
// there is nothing to say, which is reported as unknown (never a global allow).
function selectGroup(
  groups: readonly RobotsGroup[],
  robotsUserAgent: string,
): SelectedGroup | null {
  const wanted = robotsUserAgent.toLowerCase();

  let specificAgent: string | null = null;
  const specificRules: RobotsRule[] = [];
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent !== '*' && agent.toLowerCase() === wanted) {
        specificAgent ??= agent;
        specificRules.push(...group.rules);
        break;
      }
    }
  }
  if (specificAgent !== null) {
    return { agent: specificAgent, rules: specificRules };
  }

  let hasWildcard = false;
  const wildcardRules: RobotsRule[] = [];
  for (const group of groups) {
    if (group.agents.includes('*')) {
      hasWildcard = true;
      wildcardRules.push(...group.rules);
    }
  }
  return hasWildcard ? { agent: '*', rules: wildcardRules } : null;
}

function targetPath(target: string): string {
  try {
    return new URL(target).pathname || '/';
  } catch {
    return '/';
  }
}

// `*` and `$` are Robots Exclusion Protocol path-pattern syntax that this MVP
// does not implement. Rather than treat them as literal characters (which would
// silently produce a wrong verdict), a group containing any such rule is
// reported as unknown.
function hasUnsupportedPattern(rules: readonly RobotsRule[]): boolean {
  return rules.some(
    (rule) => rule.path.includes('*') || rule.path.includes('$'),
  );
}

// Longest matching path wins; a tie of equal length resolves in favour of allow.
function matchRule(
  rules: readonly RobotsRule[],
  path: string,
): RobotsRule | null {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (rule.path === '' || !path.startsWith(rule.path)) {
      continue;
    }
    if (best === null || rule.path.length > best.path.length) {
      best = rule;
      continue;
    }
    if (
      rule.path.length === best.path.length &&
      rule.directive === 'allow' &&
      best.directive === 'disallow'
    ) {
      best = rule;
    }
  }
  return best;
}

export function evaluateRobotsPolicy(
  observation: RobotsObservation,
  robotsUserAgent: string,
  targetUrl: string,
): PolicyEvaluation {
  if (observation.kind === 'unavailable') {
    return {
      result: { status: 'unknown', source: SOURCE },
      limitation: unavailableLimitation(observation),
    };
  }

  const { groups } = parseRobots(observation.body);
  const group = selectGroup(groups, robotsUserAgent);
  if (group === null) {
    return {
      result: { status: 'unknown', source: SOURCE },
      limitation:
        'No robots.txt group applied to this agent; declared policy is unknown.',
    };
  }

  if (hasUnsupportedPattern(group.rules)) {
    return {
      result: { status: 'unknown', source: SOURCE },
      limitation: UNSUPPORTED_PATTERN_LIMITATION,
    };
  }

  const match = matchRule(group.rules, targetPath(targetUrl));
  if (match === null) {
    // The agent has an applicable group but no Allow/Disallow matches this path.
    // Under the Robots Exclusion Protocol the default within a group is allow
    // (this also covers an empty `Disallow:`, which imposes no restriction).
    return {
      result: { status: 'allowed', source: SOURCE },
      limitation: DECLARATIVE_LIMITATION,
    };
  }

  return {
    result: {
      status: match.directive === 'allow' ? 'allowed' : 'disallowed',
      source: SOURCE,
      matchedRule: {
        agent: group.agent,
        directive: match.directive,
        path: match.path,
      },
    },
    limitation: DECLARATIVE_LIMITATION,
  };
}
