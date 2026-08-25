import PDFDocument from 'pdfkit';
import { getApprovedAuthUsers, getBoardIntakeLoggingReport, getSettings } from '../models/repositories';
import { OdooClient } from './odooClient';
import { sendMailWithConfig } from './mailTransport';
import { logEvent } from './logService';
import { getConfirmedMoQueueSchedule, getMoOverdueState } from './moOverdueService';
import { env } from '../utils/env';
import { clampShopFloorReportingDate } from '../utils/shopFloorReporting';
import { resolveFromProjectRoot } from '../utils/paths';
import { completedAttendanceCoversWorkday, classifyAttendanceRecords, type AttendanceRecord } from '../utils/attendanceReconciliation';

const DEPARTMENTS = ['Operations', 'Production', 'Shop Floor', 'Manufacturing', 'Factory'];
const RECIPIENT_NAMES = ['dbadmin', 'charles', 'raphael'];

function dateOnly(date: Date) { return date.toISOString().slice(0, 10); }
function productName(value: unknown) { return Array.isArray(value) ? String(value[1] || '') : String(value || ''); }
function parseOdooDateTime(value: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return value;
  // Odoo JSON-2 returns naive UTC datetimes such as "2026-08-24 16:57:04".
  // Mark them as UTC before formatting them in the Nairobi timezone.
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(normalized);
}
function nairobiDateTime(value: string | null) {
  if (!value) return '-';
  const date = parseOdooDateTime(value);
  return date ? new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(date) : '-';
}
function isOvertimeCheckIn(value: string | null) {
  if (!value) return false;
  const date = parseOdooDateTime(value);
  if (!date) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  return hour >= 17;
}
function isLateCheckIn(value: string | null) {
  if (!value) return false;
  const date = parseOdooDateTime(value);
  if (!date) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get('hour') > 8 || (get('hour') === 8 && get('minute') > 20);
}
function nairobiDateKey(value: string | Date | null) {
  if (!value) return '';
  const date = parseOdooDateTime(value);
  return date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
}
function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateOnly(date);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function defaultReportWindow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const today = nairobiDateKey(now);
  const daysSinceWednesday = (weekday - 3 + 7) % 7;

  if (weekday === 3) {
    return { start: addDays(today, -7), end: previousDate(today) };
  }

  const end = Number(get('hour')) >= 18 ? today : previousDate(today);
  return { start: addDays(today, -daysSinceWednesday), end };
}

async function getOperators(client: OdooClient, companyId: number) {
  const departments = (await Promise.all(DEPARTMENTS.map((name) => client.findDepartmentByName(name)))).flat();
  const unique = [...new Map(departments.map((department) => [department.id, department])).values()];
  const employees = (await Promise.all(unique.map((department) => client.getEmployeesByDepartment(department.id, companyId)))).flat();
  return [...new Map(employees.map((employee) => [employee.id, employee])).values()];
}

export async function buildWeeklyShopFloorReport(scope?: { fromDate?: string; toDate?: string }) {
  const settings = await getSettings();
  const client = new OdooClient(settings.odoo);
  const companyId = await client.getTargetCompanyIdValue();
  const warehouseId = Number(settings.stock.warehouseId || 0);
  if (!warehouseId) throw new Error('The Urban Vibe warehouse ID must be configured before generating the weekly report.');

  let reportStart: string;
  let reportEnd: string;
  const reportingBaseline = settings.mail.shopFloorReportingStartDate;

  if (scope?.fromDate && scope?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(String(scope.fromDate)) && /^\d{4}-\d{2}-\d{2}$/.test(String(scope.toDate))) {
    reportStart = clampShopFloorReportingDate(String(scope.fromDate), reportingBaseline);
    reportEnd = clampShopFloorReportingDate(String(scope.toDate), reportingBaseline);
  } else {
    const window = defaultReportWindow();
    reportStart = clampShopFloorReportingDate(window.start, reportingBaseline);
    reportEnd = clampShopFloorReportingDate(window.end, reportingBaseline);
  }

  const [boardSummary, penalties, orders, moCompletion, operators, boardLoggingByOperator] = await Promise.all([
    client.getBoardRegistrationSummary({
      ...settings.stock,
      fromDate: reportStart,
      toDate: reportEnd,
    }),
    client.getTeamPenalties(settings.stock),
    client.getWarehouseScopedActiveWorkOrders(warehouseId, 500),
    client.getWarehouseManufacturingOrderCompletionSummary(warehouseId, reportStart, reportEnd),
    getOperators(client, companyId),
    getBoardIntakeLoggingReport(reportStart, reportEnd, reportingBaseline),
  ]);
  const endDateObj = new Date(`${reportEnd}T23:59:59Z`);
  const confirmedQueueSchedule = getConfirmedMoQueueSchedule(orders);
  const overdueNotStarted = orders.filter((order) => {
    const overdue = getMoOverdueState({ createDate: order.create_date, plannedStart: order.date_start, clientDeadline: order.date_deadline, quantity: order.product_qty, productName: productName(order.product_id) }, endDateObj);
    const queueFinish = confirmedQueueSchedule.get(order.id)?.estimatedFinishAt;
    return !['done', 'cancel', 'progress'].includes(order.state) && !overdue.createdToday && (overdue.overdueReason !== null || Boolean(queueFinish && endDateObj > new Date(queueFinish)));
  }).map((order) => ({ ...order, queueEstimatedFinishAt: confirmedQueueSchedule.get(order.id)?.estimatedFinishAt || null }));
  const reportStartDate = new Date(`${reportStart}T12:00:00Z`);
  const reportEndDate = new Date(`${reportEnd}T12:00:00Z`);
  const reportingDayCount = Math.max(1, Math.floor((reportEndDate.getTime() - reportStartDate.getTime()) / 86400000) + 1);
  const dates = Array.from({ length: reportingDayCount }, (_, index) => {
    const value = new Date(reportStartDate); value.setUTCDate(reportStartDate.getUTCDate() + index); return dateOnly(value);
  }).filter((date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`)) !== 'Sun');
  // Include the previous day so a completed overnight overtime row can cover
  // the following workday when its checkout is recorded on that date.
  const attendanceQueryDates = [...new Set([previousDate(reportStart), ...dates])];
  const attendanceByDate = operators.length
    ? await Promise.all(attendanceQueryDates.map((date) => client.getBulkAttendance(operators.map((operator) => operator.id), date).catch(() => [])))
    : attendanceQueryDates.map(() => []);
  const allAttendanceRecords = attendanceByDate.flat() as AttendanceRecord[];
  const attendance = operators.map((operator) => ({
    name: operator.name,
    days: dates.map((date, index) => {
      const employeeRecords = allAttendanceRecords.filter((entry) =>
        (Array.isArray(entry.employee_id) ? entry.employee_id[0] : entry.employee_id) === operator.id,
      ).filter((entry) => {
        const startsOnWorkday = nairobiDateKey(entry.check_in) === date;
        const coversWorkday = isOvertimeCheckIn(entry.check_in)
          && completedAttendanceCoversWorkday(entry, date, nairobiDateKey);
        return startsOnWorkday || coversWorkday;
      });
      const regularRecords = employeeRecords.filter((entry) =>
        nairobiDateKey(entry.check_in) === date && !isOvertimeCheckIn(entry.check_in),
      );
      const classification = classifyAttendanceRecords(regularRecords);
      const overnightCoverage = employeeRecords.find((entry) =>
        nairobiDateKey(entry.check_in) !== date
        && isOvertimeCheckIn(entry.check_in)
        && completedAttendanceCoversWorkday(entry, date, nairobiDateKey),
      );
      const record = classification.record || overnightCoverage || null;
      const overtimeRecords = employeeRecords
        .filter((entry) => nairobiDateKey(entry.check_in) === date && entry !== record && isOvertimeCheckIn(entry.check_in))
        .sort((left, right) => String(left.check_in).localeCompare(String(right.check_in)));
      return {
        date,
        status: classification.status === 'Absent' && overnightCoverage ? 'Overtime covered' : classification.status,
        late: Boolean(record && nairobiDateKey(record.check_in) === date && isLateCheckIn(record.check_in)),
        checkIn: record?.check_in || null,
        checkOut: record?.check_out || null,
        workedHours: Number(record?.worked_hours || (record?.check_in && record?.check_out ? ((parseOdooDateTime(record.check_out)?.getTime() || 0) - (parseOdooDateTime(record.check_in)?.getTime() || 0)) / 3600000 : 0)),
        missingCheckoutRecords: employeeRecords.filter((entry) => nairobiDateKey(entry.check_in) === date && !entry.check_out),
        overnight: Boolean(record?.check_in && record?.check_out && nairobiDateKey(record.check_in) === date && nairobiDateKey(record.check_in) !== nairobiDateKey(record.check_out)),
        overtimeSessions: overtimeRecords.map((overtimeRecord) => ({
          checkIn: overtimeRecord.check_in,
          checkOut: overtimeRecord.check_out,
          workedHours: Number(overtimeRecord.worked_hours || (overtimeRecord.check_in && overtimeRecord.check_out
            ? ((parseOdooDateTime(overtimeRecord.check_out)?.getTime() || 0) - (parseOdooDateTime(overtimeRecord.check_in)?.getTime() || 0)) / 3600000
            : 0)),
        })),
      };
    }),
  }));
  return { generatedAt: new Date(), start: reportStart, end: reportEnd, reportingBaseline, companyName: 'URBAN VIBE INTERIOR DESIGN COMPANY LTD', warehouseId, boardSummary, boardLoggingByOperator, penalties, moCompletion, overdueNotStarted, attendance };
}

export async function renderWeeklyShopFloorReportPdf(
  reportInput?: Awaited<ReturnType<typeof buildWeeklyShopFloorReport>>,
  scope?: { fromDate?: string; toDate?: string }
): Promise<Buffer> {
  const report = reportInput || await buildWeeklyShopFloorReport(scope);
  const document = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
  const chunks: Buffer[] = [];
  document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => { document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject); });
  const navy = '#22213f'; const copper = '#cf8464'; const ink = '#1e293b'; const muted = '#64748b'; const border = '#dbe2ea';
  const pageWidth = 595.28; const contentWidth = pageWidth - 84;
  const logoPath = resolveFromProjectRoot('src', 'public', 'icons', 'urban-vibe-logo-dark.png');
  const ensureSpace = (height: number) => { if (document.y + height > 762) document.addPage(); };
  const section = (title: string, subtitle?: string) => {
    ensureSpace(subtitle ? 48 : 32); document.moveDown(.65);
    document.x = 42;
    document.font('Helvetica-Bold').fontSize(13).fillColor(navy).text(title, 42, document.y, { width: contentWidth });
    document.moveTo(42, document.y + 3).lineTo(553, document.y + 3).strokeColor(copper).lineWidth(1.5).stroke(); document.moveDown(.55);
    if (subtitle) document.font('Helvetica').fontSize(8).fillColor(muted).text(subtitle, 42, document.y, { width: contentWidth, lineGap: 2 });
  };
  const card = (x: number, y: number, width: number, label: string, value: string, note: string, accent: string) => {
    document.roundedRect(x, y, width, 66, 7).fillAndStroke('#f8fafc', border);
    document.rect(x, y, 4, 66).fill(accent);
    document.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(value, x + 12, y + 11, { width: width - 20 });
    document.font('Helvetica-Bold').fontSize(7).fillColor(muted).text(label.toUpperCase(), x + 12, y + 34, { width: width - 20 });
    document.font('Helvetica').fontSize(6.8).fillColor(muted).text(note, x + 12, y + 47, { width: width - 20, lineBreak: false });
  };
  const tableHeader = (columns: Array<{ label: string; x: number; width: number }>) => {
    const y = document.y; document.rect(42, y, contentWidth, 22).fill(navy);
    columns.forEach((column) => document.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text(column.label, column.x, y + 7, { width: column.width, lineBreak: false })); document.y = y + 22;
  };

  document.rect(0, 0, pageWidth, 112).fill(navy);
  document.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff').text('Wednesday Shop Floor Report', 42, 30);
  document.font('Helvetica-Bold').fontSize(9).fillColor(copper).text(report.companyName, 42, 59);
  document.font('Helvetica').fontSize(8).fillColor('#dbe2ea').text(`Warehouse ${report.warehouseId}  |  Period ${report.start} to ${report.end}  |  Data baseline ${report.reportingBaseline}  |  Generated ${report.generatedAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`, 42, 78);
  document.image(logoPath, pageWidth - 150, 24, { fit: [108, 62], align: 'right', valign: 'center' });
  document.y = 130;

  const attendanceTotals = report.attendance.reduce((totals, person) => {
    person.days.forEach((day) => {
      if (day.status === 'Present' || day.status === 'Overtime covered') totals.present += 1;
      else if (day.status === 'Absent') totals.absent += 1;
      if (day.late) totals.late += 1;
      totals.noCheckout += day.missingCheckoutRecords.length;
    });
    return totals;
  }, { present: 0, absent: 0, noCheckout: 0, late: 0 });
  const expectedAttendance = report.attendance.length * (report.attendance[0]?.days.length || 0);
  const attendanceRate = expectedAttendance ? Math.round(((attendanceTotals.present + Math.min(attendanceTotals.noCheckout, expectedAttendance)) / expectedAttendance) * 100) : 0;
  const coverage = Number(report.boardSummary?.coveragePercent || 0);
  const cardGap = 8; const cardWidth = (contentWidth - cardGap * 3) / 4; const cardY = document.y;
  card(42, cardY, cardWidth, 'MO board coverage', `${coverage}%`, `${report.boardSummary?.registeredBoards || 0}/${report.boardSummary?.expectedBoards || 0} cutting MOs logged`, coverage >= 90 ? '#16a34a' : '#dc2626');
  card(42 + cardWidth + cardGap, cardY, cardWidth, 'Missing MO board logs', String(report.boardSummary?.missingBoards || 0), `From ${report.start}`, '#dc2626');
  card(42 + (cardWidth + cardGap) * 2, cardY, cardWidth, 'Open receipts', String(report.penalties?.undoneReceipts || 0), 'Awaiting validation', '#d97706');
  card(42 + (cardWidth + cardGap) * 3, cardY, cardWidth, 'Attendance rate', `${attendanceRate}%`, `${attendanceTotals.absent} absence(s)`, attendanceRate >= 90 ? '#16a34a' : '#d97706');
  document.y = cardY + 78;

  section('Management summary');
  const missingCheckoutNames = [...new Set(report.attendance.flatMap((person) => person.days.flatMap((day) => day.missingCheckoutRecords.length ? [person.name] : [])))];
  const missingCheckoutSummary = attendanceTotals.noCheckout
    ? `Did not check out: ${attendanceTotals.noCheckout} employee record(s)${missingCheckoutNames.length ? ` - ${missingCheckoutNames.join(', ')}` : ''}.`
    : 'Missing checkouts: 0';
  const criticalPoints = [
    `${report.boardSummary?.missingBoards || 0} cutting MO(s) from ${report.start} to ${report.end} have no same-day board inventory log; current coverage is ${coverage}%.`,
    `${report.penalties?.undoneReceipts || 0} purchased-board receipt(s) need validation.`,
    `${report.moCompletion.completed} of ${report.moCompletion.eligible} eligible MO(s) created in the period were completed by ${report.end} (${report.moCompletion.completionPercent}%).`,
    `${report.overdueNotStarted.length} manufacturing order(s) are overdue and have not started.`,
    `${attendanceTotals.absent} absence record(s) were recorded across ${report.attendance[0]?.days.length || 0} working day(s). ${missingCheckoutSummary}`,
    `${attendanceTotals.late} late check-in(s) were recorded after 8:20 AM Nairobi time.`,
  ];
  criticalPoints.forEach((point, index) => {
    document.circle(48, document.y + 5, 3).fill(index === 0 || index === 2 ? '#dc2626' : copper);
    document.font('Helvetica').fontSize(9).fillColor(ink).text(point, 58, document.y, { width: 490, lineGap: 2 }); document.moveDown(.35);
  });

  const attendanceDataCompleteness = expectedAttendance
    ? Math.max(0, Math.round(((expectedAttendance - attendanceTotals.noCheckout) / expectedAttendance) * 100))
    : 100;
  const receiptUsageScore = Number(report.penalties?.undoneReceipts || 0) === 0 ? 100 : Number(report.penalties?.undoneReceipts || 0) <= 2 ? 60 : 20;
  const moUsageScore = report.moCompletion.completionPercent;
  const adoptionScore = Math.round((coverage + receiptUsageScore + moUsageScore + attendanceDataCompleteness) / 4);
  const adoptionLabel = adoptionScore >= 90 ? 'FULL USE' : adoptionScore >= 75 ? 'PARTIAL USE' : 'POOR USE';
  const adoptionColor = adoptionScore >= 90 ? '#16a34a' : adoptionScore >= 75 ? '#d97706' : '#dc2626';
  ensureSpace(145);
  section('Director system-usage assessment', 'This score measures whether required shop-floor actions are being recorded in the system; it does not treat genuine absence as app misuse.');
  const assessmentY = document.y;
  document.roundedRect(42, assessmentY, 108, 55, 6).fillAndStroke('#f8fafc', border);
  document.font('Helvetica-Bold').fontSize(19).fillColor(adoptionColor).text(`${adoptionScore}%`, 54, assessmentY + 9, { width: 84 });
  document.font('Helvetica-Bold').fontSize(7).fillColor(adoptionColor).text(adoptionLabel, 54, assessmentY + 34, { width: 84 });
  const usageEvidence = [
    { label: 'MO board logging', score: coverage, issue: `${report.boardSummary?.missingBoards || 0} MOs missing` },
    { label: 'Receipt validation', score: receiptUsageScore, issue: `${report.penalties?.undoneReceipts || 0} pending` },
    { label: 'MO completion rate', score: moUsageScore, issue: `${report.moCompletion.completed}/${report.moCompletion.eligible} completed; ${report.moCompletion.open} open` },
    { label: 'Checkout data integrity', score: attendanceDataCompleteness, issue: `${attendanceTotals.noCheckout} blank checkout; ${attendanceTotals.absent} regular absence(s)` },
  ];
  usageEvidence.forEach((item, index) => {
    const x = 165 + (index % 2) * 194; const y = assessmentY + Math.floor(index / 2) * 27;
    document.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(item.label, x, y + 2, { width: 116, lineBreak: false });
    document.font('Helvetica-Bold').fontSize(8).fillColor(item.score >= 90 ? '#16a34a' : item.score >= 75 ? '#d97706' : '#dc2626').text(`${item.score}%`, x + 118, y + 2, { width: 32, align: 'right' });
    document.font('Helvetica').fontSize(6.5).fillColor(muted).text(item.issue, x, y + 13, { width: 150, lineBreak: false });
  });
  document.y = assessmentY + 64;
  const usageActions = usageEvidence.filter((item) => item.score < 90).map((item) => item.label);
  document.font('Helvetica-Bold').fontSize(7.5).fillColor(usageActions.length ? '#dc2626' : '#16a34a').text(
    usageActions.length ? `DIRECTOR ACTION: Require completion of ${usageActions.join(', ')} and review exceptions with the responsible operators.` : `DIRECTOR NOTE: Checkout data integrity is complete. ${attendanceTotals.absent} regular-shift absence(s) and separate overnight/overtime records are reported independently.`,
    42, document.y, { width: contentWidth, lineGap: 2 },
  );
  document.moveDown(.5);

  const checkoutRows = report.attendance.flatMap((person) => person.days.flatMap((day) => day.missingCheckoutRecords.map((record) => ({ person, day, record }))));
  if (checkoutRows.length) {
    section('Missing checkout details', 'Missing checkout means the Odoo attendance row has check_in but its check_out value is blank. A different check-in and checkout date is not a failure.');
    const checkoutCols = [
      { label: 'EMPLOYEE', x: 48, width: 145 },
      { label: 'CHECK-IN DATE / TIME', x: 198, width: 104 },
      { label: 'EXPECTED SHIFT / DATE', x: 306, width: 92 },
      { label: 'CHECK-OUT', x: 402, width: 78 },
      { label: 'STATUS / REASON', x: 484, width: 64 },
    ];
    tableHeader(checkoutCols);
    checkoutRows.forEach(({ person, day, record }, index) => {
      ensureSpace(32); if (document.y < 55) tableHeader(checkoutCols); const y = document.y;
      document.rect(42, y, contentWidth, 30).fill(index % 2 ? '#fff7f7' : '#ffffff');
      document.font('Helvetica-Bold').fontSize(6.9).fillColor(ink).text(person.name, 48, y + 9, { width: 145, lineBreak: false });
      document.font('Helvetica').fontSize(6.5).text(nairobiDateTime(record.check_in), 198, y + 8, { width: 104, height: 18 });
      document.font('Helvetica').fontSize(6.5).text(day.date, 306, y + 8, { width: 92, height: 18 });
      document.font('Helvetica').fontSize(6.5).fillColor('#991b1b').text('Not recorded', 402, y + 8, { width: 78, height: 18 });
      document.font('Helvetica-Bold').fontSize(6.2).fillColor('#991b1b').text('Missing\ncheck-out', 484, y + 5, { width: 64, height: 22 });
      document.y = y + 30;
    });
  }

  const overtimeCheckIns = report.attendance.flatMap((person) => person.days
    .flatMap((day) => [
      ...(day.overnight && day.checkIn && day.checkOut && nairobiDateKey(day.checkIn) === day.date ? [{ name: person.name, day, session: { checkIn: day.checkIn, checkOut: day.checkOut, workedHours: day.workedHours } }] : []),
      ...day.overtimeSessions.map((session) => ({ name: person.name, day, session })),
    ]));
  if (overtimeCheckIns.length) {
    section('Overnight and overtime records', 'Overnight attendance is complete when the same Odoo row has a checkout, even when checkout is on the following date. Advise operators to use separate logins for overtime and check out before 8:00 AM before starting the new day.');
    const overtimeCols = [
      { label: 'EMPLOYEE', x: 48, width: 190 },
      { label: 'DATE', x: 244, width: 70 },
      { label: 'CHECK-IN', x: 318, width: 72 },
      { label: 'CHECK-OUT', x: 394, width: 72 },
      { label: 'HOURS / STATUS', x: 470, width: 76 },
    ];
    tableHeader(overtimeCols);
    overtimeCheckIns.forEach(({ name, day, session }, index) => {
      ensureSpace(30); if (document.y < 55) tableHeader(overtimeCols); const y = document.y;
      document.rect(42, y, contentWidth, 28).fill(index % 2 ? '#f8fafc' : '#ffffff');
      document.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(name, 48, y + 9, { width: 190, lineBreak: false });
      document.font('Helvetica').fontSize(7.5).text(day.date, 244, y + 9, { width: 70, lineBreak: false });
      document.font('Helvetica').fontSize(6.8).text(nairobiDateTime(session.checkIn), 318, y + 9, { width: 72, lineBreak: false });
      document.text(session.checkOut ? nairobiDateTime(session.checkOut) : 'Open', 394, y + 9, { width: 72, lineBreak: false });
      document.font('Helvetica-Bold').fontSize(6.8).fillColor(session.checkOut ? '#16a34a' : '#b45309').text(`${Number(session.workedHours || 0).toFixed(1)}h ${session.checkOut ? 'Complete' : 'Open'}`, 470, y + 9, { width: 76, lineBreak: false });
      document.y = y + 28;
    });
  }

  const boardLogTotals = report.boardLoggingByOperator.reduce((totals, operator) => {
    totals.records += operator.records;
    totals.boards += operator.boards;
    totals.synced += operator.synced;
    totals.failed += operator.failed;
    totals.pending += operator.pending;
    return totals;
  }, { records: 0, boards: 0, synced: 0, failed: 0, pending: 0 });
  section('Board logging by operator', `Board intake records created from ${report.start} to ${report.end}. Total: ${boardLogTotals.records} record(s), ${boardLogTotals.boards} board(s).`);
  const boardLogCols = [
    { label: 'OPERATOR', x: 48, width: 146 },
    { label: 'RECORDS', x: 198, width: 42 },
    { label: 'BOARDS', x: 244, width: 42 },
    { label: 'SHARE', x: 290, width: 42 },
    { label: 'SYNCED', x: 336, width: 42 },
    { label: 'FAILED', x: 382, width: 42 },
    { label: 'PENDING', x: 428, width: 46 },
    { label: 'LAST LOG', x: 478, width: 66 },
  ];
  tableHeader(boardLogCols);
  if (!report.boardLoggingByOperator.length) {
    document.font('Helvetica').fontSize(9).fillColor(muted).text('No board intake records were logged during this reporting period.', 48, document.y + 8);
    document.y += 28;
  }
  report.boardLoggingByOperator.forEach((operator, index) => {
    ensureSpace(32);
    if (document.y < 55) tableHeader(boardLogCols);
    const y = document.y;
    document.rect(42, y, contentWidth, 29).fill(index % 2 ? '#f8fafc' : '#ffffff');
    const boardShare = boardLogTotals.boards ? Math.round((operator.boards / boardLogTotals.boards) * 100) : 0;
    document.font('Helvetica-Bold').fontSize(7.3).fillColor(ink).text(operator.name, 48, y + 6, { width: 146, height: 10, ellipsis: true });
    if (operator.email) document.font('Helvetica').fontSize(5.8).fillColor(muted).text(operator.email, 48, y + 17, { width: 146, height: 8, ellipsis: true });
    document.font('Helvetica').fontSize(7.5).fillColor(ink)
      .text(String(operator.records), 198, y + 9, { width: 42, align: 'center' })
      .text(String(operator.boards), 244, y + 9, { width: 42, align: 'center' })
      .text(`${boardShare}%`, 290, y + 9, { width: 42, align: 'center' })
      .text(String(operator.synced), 336, y + 9, { width: 42, align: 'center' });
    document.fillColor(operator.failed > 0 ? '#dc2626' : ink).text(String(operator.failed), 382, y + 9, { width: 42, align: 'center' });
    document.fillColor(operator.pending > 0 ? '#d97706' : ink).text(String(operator.pending), 428, y + 9, { width: 46, align: 'center' });
    document.fontSize(5.9).fillColor(muted).text(nairobiDateTime(operator.lastLoggedAt), 478, y + 6, { width: 66, height: 18 });
    document.y = y + 29;
  });
  document.moveDown(.35);
  document.font('Helvetica').fontSize(7).fillColor(muted).text(`Totals: ${boardLogTotals.records} records | ${boardLogTotals.boards} boards | ${boardLogTotals.synced} synced | ${boardLogTotals.failed} failed | ${boardLogTotals.pending} pending`, 42, document.y, { width: contentWidth });
  document.moveDown(.4);

  const classifyArea = (name: string) => name.toLowerCase().includes('edge band') || name.toLowerCase().includes('edging band') ? 'Edge Banding' : name.toLowerCase().includes('optimised') || name.toLowerCase().includes('optimized') || name.toLowerCase().includes('panel') ? 'Panel Rack' : 'Table Saw';
  const now = report.generatedAt.getTime();
  const enrichedOrders = report.overdueNotStarted.map((order) => {
    const estimate = order.queueEstimatedFinishAt || getMoOverdueState({ createDate: order.create_date, plannedStart: order.date_start, clientDeadline: order.date_deadline, quantity: order.product_qty, productName: productName(order.product_id) }).estimatedFinishAt;
    const overdueDays = estimate ? Math.max(1, Math.floor((now - new Date(estimate).getTime()) / 86400000)) : 0;
    return { order, estimate, overdueDays, area: classifyArea(productName(order.product_id)) };
  });
  section('Overdue MO analysis', 'Only not-started MOs from the configured Urban Vibe warehouse are included.');
  const areaCounts = ['Table Saw', 'Edge Banding', 'Panel Rack'].map((area) => ({ area, count: enrichedOrders.filter((item) => item.area === area).length }));
  const aging = [
    { label: '1-2 days', count: enrichedOrders.filter((item) => item.overdueDays <= 2).length },
    { label: '3-7 days', count: enrichedOrders.filter((item) => item.overdueDays >= 3 && item.overdueDays <= 7).length },
    { label: '8+ days', count: enrichedOrders.filter((item) => item.overdueDays >= 8).length },
  ];
  document.font('Helvetica-Bold').fontSize(8).fillColor(muted).text(`BY AREA   ${areaCounts.map((item) => `${item.area}: ${item.count}`).join('   |   ')}`);
  document.moveDown(.3); document.font('Helvetica-Bold').fontSize(8).fillColor(muted).text(`BY AGE     ${aging.map((item) => `${item.label}: ${item.count}`).join('   |   ')}`); document.moveDown(.6);
  const moCols = [{ label: 'MO', x: 48, width: 86 }, { label: 'AREA / PRODUCT', x: 136, width: 220 }, { label: 'CLIENT REF', x: 360, width: 80 }, { label: 'EST. FINISH', x: 444, width: 64 }, { label: 'LATE', x: 512, width: 34 }];
  tableHeader(moCols);
  if (!enrichedOrders.length) { document.font('Helvetica').fontSize(9).fillColor('#16a34a').text('No overdue, not-started manufacturing orders.', 48, document.y + 8); document.y += 28; }
  enrichedOrders.forEach((item, index) => {
    ensureSpace(32); if (document.y < 55) tableHeader(moCols); const y = document.y;
    document.rect(42, y, contentWidth, 29).fill(index % 2 ? '#f8fafc' : '#ffffff');
    document.font('Helvetica-Bold').fontSize(7.2).fillColor(ink).text(item.order.name, 48, y + 8, { width: 86, lineBreak: false });
    document.font('Helvetica').fontSize(7).fillColor(ink).text(`${item.area} - ${productName(item.order.product_id)}`, 136, y + 6, { width: 220, height: 18, ellipsis: true });
    document.text(item.order.origin || '-', 360, y + 8, { width: 80, lineBreak: false }); document.fontSize(6.3).text(nairobiDateTime(item.estimate), 444, y + 6, { width: 64, height: 18 });
    document.font('Helvetica-Bold').fillColor(item.overdueDays >= 8 ? '#dc2626' : '#d97706').text(`${item.overdueDays}d`, 512, y + 8, { width: 34, lineBreak: false }); document.y = y + 29;
  });

  document.moveDown(.55);
  section('Attendance system usage', 'Attendance rate measures scheduled-shift coverage. A completed overnight overtime row covers the following workday and is shown separately; it does not create an absence or no-check-in exception. Checkout data integrity measures whether recorded Odoo rows have a checkout.');
  const usageCols = [
    { label: 'EMPLOYEE', x: 48, width: 170 },
    { label: 'CHECK-IN', x: 224, width: 68 },
    { label: 'CHECK-OUT', x: 296, width: 76 },
    { label: 'COMPLETE', x: 376, width: 74 },
    { label: 'SYSTEM USAGE', x: 454, width: 92 },
  ];
  tableHeader(usageCols);
  report.attendance.forEach((person, index) => {
    ensureSpace(32); if (document.y < 55) tableHeader(usageCols);
    const expectedDays = person.days.length;
    const checkIns = person.days.filter((day) => ['Present', 'Overtime covered', 'No checkout'].includes(day.status)).length;
    const checkOuts = person.days.filter((day) => ['Present', 'Overtime covered'].includes(day.status)).length;
    const completeShifts = checkOuts;
    const checkInRate = expectedDays ? Math.round((checkIns / expectedDays) * 100) : 0;
    const checkOutRate = expectedDays ? Math.round((checkOuts / expectedDays) * 100) : 0;
    const systemRate = expectedDays ? Math.round((completeShifts / expectedDays) * 100) : 0;
    const y = document.y;
    document.rect(42, y, contentWidth, 29).fill(index % 2 ? '#f8fafc' : '#ffffff');
    document.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(person.name, 48, y + 9, { width: 170, lineBreak: false });
    document.font('Helvetica').fontSize(7.5).fillColor(checkInRate >= 90 ? '#16a34a' : checkInRate >= 75 ? '#d97706' : '#dc2626').text(`${checkInRate}%`, 224, y + 9, { width: 68, align: 'center' });
    document.fillColor(checkOutRate >= 90 ? '#16a34a' : checkOutRate >= 75 ? '#d97706' : '#dc2626').text(`${checkOutRate}%`, 296, y + 9, { width: 76, align: 'center' });
    document.fillColor(ink).text(`${completeShifts}/${expectedDays}`, 376, y + 9, { width: 74, align: 'center' });
    document.font('Helvetica-Bold').fillColor(systemRate >= 90 ? '#16a34a' : systemRate >= 75 ? '#d97706' : '#dc2626').text(`${systemRate}%`, 454, y + 9, { width: 92, align: 'center' });
    document.y = y + 29;
  });
  document.moveDown(.3);
  document.font('Helvetica').fontSize(7).fillColor(muted).text('Attendance rate = scheduled workdays covered by a regular check-in or a completed overnight overtime row ÷ scheduled working days. Checkout data integrity = scheduled attendance denominator less blank checkouts; it does not treat an absence as a missing checkout. Overnight overtime rows are shown separately and cover the following workday when their checkout is recorded on that date.', 42, document.y, { width: contentWidth });
  const footerUrl = String(env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke').replace(/\/+$/, '');
  const footerRange = document.bufferedPageRange();
  for (let pageIndex = footerRange.start; pageIndex < footerRange.start + footerRange.count; pageIndex += 1) {
    document.switchToPage(pageIndex);
    const footerY = document.page.height - 30;
    document.moveTo(42, footerY - 6).lineTo(pageWidth - 42, footerY - 6).strokeColor(border).lineWidth(0.6).stroke();
    document.font('Helvetica').fontSize(7).fillColor(muted)
      .text(`Report source: ${footerUrl}`, 42, footerY, { width: contentWidth - 55, lineBreak: false })
      .text(`Page ${pageIndex - footerRange.start + 1} of ${footerRange.count}`, pageWidth - 95, footerY, { width: 53, align: 'right', lineBreak: false });
  }
  document.end();
  return done;
}

export async function sendWeeklyShopFloorReport(additionalRecipients: string[] = [], includeDefaultRecipients = true) {
  const [settings, users, pdf] = await Promise.all([getSettings(), getApprovedAuthUsers(), renderWeeklyShopFloorReportPdf()]);
  const defaultRecipients = includeDefaultRecipients ? [
    env.AUTH_LOCAL_ADMIN_EMAIL.trim().toLowerCase(),
    ...users.filter((user) => user.active && RECIPIENT_NAMES.some((name) => user.email.toLowerCase().includes(name))).map((user) => user.email.toLowerCase()),
  ] : [];
  const recipients = [...new Set([
    ...defaultRecipients,
    ...additionalRecipients.map((email) => email.trim().toLowerCase()),
  ].filter(Boolean))];
  if (!recipients.length) throw new Error('No active approved users matched dbadmin, Charles, or Raphael.');
  const mailResult = await sendMailWithConfig(settings.mail, { to: recipients.join(', '), subject: 'Wednesday Shop Floor Accountability Report', text: 'Attached is the Urban Vibe weekly Shop Floor accountability report covering board logging, receipts, overdue manufacturing orders, attendance, and system usage.', html: '<p>Attached is the Urban Vibe weekly Shop Floor accountability report covering board logging, receipts, overdue manufacturing orders, attendance, and system usage.</p>', attachments: [{ filename: `shop-floor-wednesday-${dateOnly(new Date())}.pdf`, content: pdf, contentType: 'application/pdf' }] } as any);
  const smtpInfo = mailResult.info as { accepted?: string[]; rejected?: string[]; pending?: string[]; response?: string; messageId?: string };
  await logEvent('info', 'Wednesday Shop Floor report sent', {
    recipients,
    smtpAccount: mailResult.fromEmail,
    accepted: smtpInfo.accepted || [],
    rejected: smtpInfo.rejected || [],
    pending: smtpInfo.pending || [],
    response: smtpInfo.response || null,
    messageId: smtpInfo.messageId || null,
  });
  return recipients;
}

let interval: NodeJS.Timeout | null = null;
let lastSentDate = '';
export function startWeeklyShopFloorReportInterval() {
  if (interval) return;
  const check = async () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    const key = `${get('year')}-${get('month')}-${get('day')}`;
    if (get('weekday') === 'Wed' && Number(get('hour')) >= 8 && lastSentDate !== key) {
      try { await sendWeeklyShopFloorReport(); lastSentDate = key; } catch (error) { console.error('[weekly-report]', error); }
    }
  };
  void check();
  interval = setInterval(() => void check(), 60 * 60 * 1000);
}
