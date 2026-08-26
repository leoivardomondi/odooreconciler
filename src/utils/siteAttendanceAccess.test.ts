import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedAttendanceIp } from './siteAttendanceAccess';

test('allows the configured site public IP', () => {
  assert.equal(isAllowedAttendanceIp('41.139.216.177', '41.139.216.177'), true);
});

test('normalizes IPv4-mapped addresses and rejects other networks', () => {
  assert.equal(isAllowedAttendanceIp('::ffff:41.139.216.177', '41.139.216.177'), true);
  assert.equal(isAllowedAttendanceIp('197.1.2.3', '41.139.216.177'), false);
});
