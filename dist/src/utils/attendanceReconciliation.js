"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAttendanceCheckout = hasAttendanceCheckout;
exports.attendanceRecordCoversWorkday = attendanceRecordCoversWorkday;
exports.classifyAttendanceRecords = classifyAttendanceRecords;
function hasAttendanceCheckout(record) {
    return Boolean(record.check_out);
}
function attendanceRecordCoversWorkday(record, workday, dateKey) {
    if (!record.check_in)
        return false;
    const checkInDate = dateKey(record.check_in);
    if (checkInDate === workday)
        return true;
    return Boolean(record.check_out
        && checkInDate < workday
        && dateKey(record.check_out) === workday);
}
/**
 * Odoo hr.attendance is one record containing both timestamps. A checkout on
 * another calendar day is still a completed record; the dates are never used
 * as a proxy for whether check_out is present.
 */
function classifyAttendanceRecords(records) {
    if (!records.length) {
        return { status: 'Absent', record: null, completedRecords: [], missingCheckoutRecords: [] };
    }
    const ordered = [...records].sort((left, right) => String(right.check_in || '').localeCompare(String(left.check_in || '')));
    const completedRecords = ordered.filter(hasAttendanceCheckout);
    const missingCheckoutRecords = ordered.filter((record) => !hasAttendanceCheckout(record));
    const record = completedRecords[0] || ordered[0] || null;
    return {
        status: completedRecords.length ? 'Present' : 'No checkout',
        record,
        completedRecords,
        missingCheckoutRecords,
    };
}
