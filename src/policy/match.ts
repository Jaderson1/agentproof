import type { PathMatcher } from './model.ts';

// Literal comparison only; variants are preserved for a future canonicalization check.
export function matchesPath(
  matcher: PathMatcher,
  candidatePath: string,
): boolean {
  switch (matcher.kind) {
    case 'exact':
      return candidatePath === matcher.value;
    case 'prefix':
      return candidatePath.startsWith(matcher.value);
  }
}
