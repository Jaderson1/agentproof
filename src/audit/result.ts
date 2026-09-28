export type CheckStatus = 'pass' | 'fail' | 'inconclusive' | 'error';

export type CheckResult = {
  id: string;
  status: CheckStatus;
  title: string;
  message: string;
  expected?: string;
  observed?: string;
};

export type AuditResult = {
  target: string;
  status: CheckStatus;
  checks: CheckResult[];
};

export function aggregateStatus(checks: readonly CheckResult[]): CheckStatus {
  // Empty is inconclusive: "no checks ran" must not read as pass.
  if (checks.length === 0) {
    return 'inconclusive';
  }
  if (checks.some((check) => check.status === 'error')) {
    return 'error';
  }
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }
  if (checks.some((check) => check.status === 'inconclusive')) {
    return 'inconclusive';
  }
  return 'pass';
}
