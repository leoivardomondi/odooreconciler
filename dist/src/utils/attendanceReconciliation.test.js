"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const attendanceReconciliation_1 = require("./attendanceReconciliation");
(0, node_test_1.default)('same-day completed attendance is present', () => {
    const result = (0, attendanceReconciliation_1.classifyAttendanceRecords)([{ check_in: '2026-08-24T08:00:00+03:00', check_out: '2026-08-24T17:00:00+03:00' }]);
    strict_1.default.equal(result.status, 'Present');
    strict_1.default.equal(result.missingCheckoutRecords.length, 0);
});
(0, node_test_1.default)('overnight completed attendance is present even when dates differ', () => {
    const result = (0, attendanceReconciliation_1.classifyAttendanceRecords)([{ check_in: '2026-08-24T19:57:00+03:00', check_out: '2026-08-25T17:05:00+03:00' }]);
    strict_1.default.equal(result.status, 'Present');
    strict_1.default.equal(result.record?.check_out, '2026-08-25T17:05:00+03:00');
});
(0, node_test_1.default)('a check-in without an Odoo checkout is missing checkout', () => {
    const result = (0, attendanceReconciliation_1.classifyAttendanceRecords)([{ check_in: '2026-08-25T08:12:00+03:00', check_out: false }]);
    strict_1.default.equal(result.status, 'No checkout');
    strict_1.default.equal(result.missingCheckoutRecords.length, 1);
});
(0, node_test_1.default)('no attendance record is absence', () => {
    strict_1.default.equal((0, attendanceReconciliation_1.classifyAttendanceRecords)([]).status, 'Absent');
});
(0, node_test_1.default)('Joel Ochango example is completed attendance, not missing checkout', () => {
    const result = (0, attendanceReconciliation_1.classifyAttendanceRecords)([{ id: 123, employee_id: [7, 'Joel Ochango'], check_in: '2026-08-24T19:57:00+03:00', check_out: '2026-08-25T17:05:00+03:00' }]);
    strict_1.default.equal(result.status, 'Present');
    strict_1.default.equal(result.missingCheckoutRecords.length, 0);
});
(0, node_test_1.default)('completed overnight overtime covers the following workday without becoming an absence', () => {
    const record = { check_in: '2026-08-24T19:57:00+03:00', check_out: '2026-08-25T17:05:00+03:00' };
    const dateKey = (value) => value.slice(0, 10);
    strict_1.default.equal((0, attendanceReconciliation_1.completedAttendanceCoversWorkday)(record, '2026-08-25', dateKey), true);
});
