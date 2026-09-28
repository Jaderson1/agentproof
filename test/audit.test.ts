import { describe, expect, it } from 'vitest';
import {
  aggregateStatus,
  exitCodeForStatus,
  type CheckResult,
  type CheckStatus,
} from '../src/audit/index.ts';

function check(status: CheckStatus): CheckResult {
  return { id: status, status, title: status, message: status };
}

describe('aggregateStatus', () => {
  it('is pass when every check passes', () => {
    expect(aggregateStatus([check('pass'), check('pass')])).toBe('pass');
  });

  it('is fail when a pass and a fail are present', () => {
    expect(aggregateStatus([check('pass'), check('fail')])).toBe('fail');
  });

  it('is error when a fail and an error are present', () => {
    expect(aggregateStatus([check('fail'), check('error')])).toBe('error');
  });

  it('is inconclusive when a pass and an inconclusive are present', () => {
    expect(aggregateStatus([check('pass'), check('inconclusive')])).toBe(
      'inconclusive',
    );
  });

  it('is inconclusive for an empty list', () => {
    expect(aggregateStatus([])).toBe('inconclusive');
  });
});

describe('exitCodeForStatus', () => {
  it('maps each status to its exit code', () => {
    expect(exitCodeForStatus('pass')).toBe(0);
    expect(exitCodeForStatus('fail')).toBe(1);
    expect(exitCodeForStatus('inconclusive')).toBe(2);
    expect(exitCodeForStatus('error')).toBe(3);
  });
});
