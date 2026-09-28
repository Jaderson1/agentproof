import type { CheckStatus } from './result.ts';

// 0 pass, 1 fail (violation), 2 inconclusive / unavailable, 3 tool error.
export const ExitCode = {
  pass: 0,
  fail: 1,
  inconclusive: 2,
  error: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export function exitCodeForStatus(status: CheckStatus): ExitCode {
  return ExitCode[status];
}
