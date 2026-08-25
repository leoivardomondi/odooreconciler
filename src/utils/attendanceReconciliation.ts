export type AttendanceRecord = {
  id?: number;
  employee_id?: number | [number, string] | null;
  check_in: string | null;
  check_out?: string | null | false;
  worked_hours?: number | null;
};

export type AttendanceStatus = 'Present' | 'Overtime covered' | 'No checkout' | 'Absent';

export function hasAttendanceCheckout(record: AttendanceRecord) {
  return Boolean(record.check_out);
}

export function completedAttendanceCoversWorkday(
  record: AttendanceRecord,
  workday: string,
  dateKey: (value: string) => string,
) {
  if (!record.check_in || !record.check_out) return false;
  return dateKey(record.check_in) < workday && dateKey(record.check_out) === workday;
}

/**
 * Odoo hr.attendance is one record containing both timestamps. A checkout on
 * another calendar day is still a completed record; the dates are never used
 * as a proxy for whether check_out is present.
 */
export function classifyAttendanceRecords(records: AttendanceRecord[]): {
  status: AttendanceStatus;
  record: AttendanceRecord | null;
  completedRecords: AttendanceRecord[];
  missingCheckoutRecords: AttendanceRecord[];
} {
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
