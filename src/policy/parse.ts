import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { PathMatcher, Policy } from './model.ts';

export class PolicyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyParseError';
  }
}

// Paths are validated, never rewritten: ambiguity is rejected, not "fixed".
const pathValue = z
  .string()
  .refine((v) => v.startsWith('/'), 'path must start with "/"')
  .refine((v) => !v.includes('?'), 'path must not contain a query string')
  .refine((v) => !v.includes('#'), 'path must not contain a fragment');

const pathSchema = z
  .strictObject({
    exact: pathValue.optional(),
    prefix: pathValue.optional(),
  })
  .refine(
    (p) => (p.exact === undefined) !== (p.prefix === undefined),
    'path must contain exactly one of "exact" or "prefix"',
  );

const ruleSchema = z.strictObject({
  agent: z.string().min(1, 'agent must be a non-empty string'),
  path: pathSchema,
  action: z.enum(['allow', 'deny']),
});

const policySchema = z.strictObject({
  version: z.literal(1),
  rules: z.array(ruleSchema).min(1, 'policy must contain at least one rule'),
});

function toMatcher(path: z.infer<typeof pathSchema>): PathMatcher {
  if (path.exact !== undefined) {
    return { kind: 'exact', value: path.exact };
  }
  if (path.prefix !== undefined) {
    return { kind: 'prefix', value: path.prefix };
  }
  // Unreachable: the schema guarantees exactly one matcher.
  throw new PolicyParseError(
    'path must contain exactly one of "exact" or "prefix"',
  );
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location =
        issue.path.length > 0
          ? issue.path.map((segment) => String(segment)).join('.')
          : '(root)';
      return `${location}: ${issue.message}`;
    })
    .join('; ');
}

export function parsePolicy(source: string): Policy {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PolicyParseError(`invalid YAML: ${detail}`);
  }

  const result = policySchema.safeParse(raw);
  if (!result.success) {
    throw new PolicyParseError(formatIssues(result.error));
  }

  return {
    version: 1,
    rules: result.data.rules.map((rule) => ({
      agent: rule.agent,
      path: toMatcher(rule.path),
      action: rule.action,
    })),
  };
}

export async function loadPolicy(filePath: string): Promise<Policy> {
  const source = await readFile(filePath, 'utf8');
  return parsePolicy(source);
}
