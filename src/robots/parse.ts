export type RobotsDirective = 'allow' | 'disallow';

export type RobotsRule = {
  directive: RobotsDirective;
  path: string;
};

export type RobotsGroup = {
  agents: readonly string[];
  rules: readonly RobotsRule[];
};

export type RobotsRuleset = {
  groups: readonly RobotsGroup[];
};

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

// Conservative MVP parser. It understands only User-agent, Allow and Disallow,
// groups rules under their User-agent block, and ignores comments, blank lines
// and unknown fields. Paths are kept verbatim: empty-value directives and
// `*`/`$` patterns are carried through and interpreted at evaluation time.
export function parseRobots(body: string): RobotsRuleset {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let inAgentBlock = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === '') {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (current === null || !inAgentBlock) {
        current = { agents: [], rules: [] };
        groups.push(current);
        inAgentBlock = true;
      }
      if (value !== '') {
        current.agents.push(value);
      }
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      if (current === null) {
        continue;
      }
      inAgentBlock = false;
      current.rules.push({ directive: field, path: value });
    }
  }

  return { groups };
}
