import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceRecordCoversWorkday, classifyAttendanceRecords } from './attendanceReconciliation';

test('same-day completed attendance is present', () => {
  const result = classifyAttendanceRecords([{ check_in: '2026-08-24T08:00:00+03:00', check_out: '2026-08-24T17:00:00+03:00' }]);
  assert.equal(result.status, 'Present');
  assert.equal(result.missingCheckoutRecords.length, 0);
});

test('overnight completed attendance is present even when dates differ', () => {
  const result = classifyAttendanceRecords([{ check_in: '2026-08-24T19:57:00+03:00', check_out: '2026-08-25T17:05:00+03:00' }]);
  assert.equal(result.status, 'Present');
  assert.equal(result.record?.check_out, '2026-08-25T17:05:00+03:00');
});

test('a check-in without an Odoo checkout is missing checkout', () => {
  const result = classifyAttendanceRecords([{ check_in: '2026-08-25T08:12:00+03:00', check_out: false }]);
  assert.equal(result.status, 'No checkout');
  assert.equal(result.missingCheckoutRecords.length, 1);
});

test('no attendance record is absence', () => {
  assert.equal(classifyAttendanceRecords([]).status, 'Absent');
});

test('Joel Ochango example is completed attendance, not missing checkout', () => {
  const result = classifyAttendanceRecords([{ id: 123, employee_id: [7, 'Joel Ochango'], check_in: '2026-08-24T19:57:00+03:00', check_out: '2026-08-25T17:05:00+03:00' }]);
  assert.equal(result.status, 'Present');
  assert.equal(result.missingCheckoutRecords.length, 0);
});

test('completed overnight attendance covers its checkout workday', () => {
  const record = { check_in: '2026-08-24T19:57:00+03:00', check_out: '2026-08-25T17:05:00+03:00' };
  const dateKey = (value: string) => value.slice(0, 10);
  assert.equal(attendanceRecordCoversWorkday(record, '2026-08-24', dateKey), true);
  assert.equal(attendanceRecordCoversWorkday(record, '2026-08-25', dateKey), true);
  assert.equal(attendanceRecordCoversWorkday(record, '2026-08-26', dateKey), false);
});
