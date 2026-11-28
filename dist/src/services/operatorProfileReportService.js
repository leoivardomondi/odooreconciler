"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEOIVARD_REPORT_EMAIL = exports.CORE_OPERATOR_IDS = void 0;
exports.computeOperatorMasteryScores = computeOperatorMasteryScores;
exports.buildOperatorProfileReport = buildOperatorProfileReport;
exports.renderOperatorProfilePdf = renderOperatorProfilePdf;
exports.sendOperatorProfileReport = sendOperatorProfileReport;
exports.sendAllOperatorProfileReports = sendAllOperatorProfileReports;
const pdfkit_1 = __importDefault(require("pdfkit"));
const db_1 = require("../models/db");
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const mailTransport_1 = require("./mailTransport");
const logService_1 = require("./logService");
const env_1 = require("../utils/env");
const shopFloorReporting_1 = require("../utils/shopFloorReporting");
const attendanceReconciliation_1 = require("../utils/attendanceReconciliation");
const pdfPieChart_1 = require("../utils/pdfPieChart");
exports.CORE_OPERATOR_IDS = [6, 5, 7, 23]; // Bitcher, Joel, Thomas, Michael
exports.LEOIVARD_REPORT_EMAIL = 'dbadmin@urbanvibeinteriordesign.co.ke';
function nairobiDateKey(value) {
    if (!value)
        return '';
    const date = value instanceof Date
        ? value
        : new Date(String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`);
    if (!Number.isFinite(date.getTime()))
        return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}
function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
function defaultProfileWindow() {
    const today = nairobiDateKey(new Date());
    return {
        start: addDays(today, -6),
        end: today,
    };
}
function countNonSundayWorkdays(start, end) {
    const dates = [];
    const startDate = new Date(`${start}T12:00:00Z`);
    const endDate = new Date(`${end}T12:00:00Z`);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate > endDate) {
        return dates;
    }
    const cur = new Date(startDate);
    while (cur <= endDate && dates.length < 366) {
        const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(cur);
        if (weekday !== 'Sun') {
            dates.push(cur.toISOString().slice(0, 10));
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}
function slugifyName(name) {
    return String(name || 'operator')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'operator';
}
function computeOperatorMasteryScores(input) {
    const closedSessions = Math.max(0, input.sessionsCount - input.openTimersCount);
    const timerDisciplineRate = input.sessionsCount > 0
        ? Math.round((closedSessions / input.sessionsCount) * 100)
        : 0;
    // Shop Floor Mastery (0-100):
    // - Usage volume (up to 40 pts): working on >= 5 WOs or >= 8 sessions
    // - Completion effectiveness (up to 25 pts): completed / worked ratio
    // - Timer pause/stop discipline (up to 25 pts): cleanly closed timers
    // - Multi-area versatility (up to 10 pts): >= 2 work centers
    const sfVolumePts = input.sessionsCount === 0
        ? 0
        : Math.min(40, Math.round((Math.min(input.workOrdersWorkedCount, 6) / 6) * 28 + (Math.min(input.totalProductionHours, 12) / 12) * 12));
    const sfCompletionRatio = input.workOrdersWorkedCount > 0
        ? Math.min(1, input.workOrdersCompletedCount / input.workOrdersWorkedCount)
        : 0;
    const sfCompletionPts = Math.round(sfCompletionRatio * 25);
    const sfDisciplinePts = input.sessionsCount > 0 ? Math.round((timerDisciplineRate / 100) * 25) : 0;
    const sfVersatilityPts = input.workcenterCount >= 2 ? 10 : input.workcenterCount === 1 ? 6 : 0;
    const shopFloorMasteryScore = Math.min(100, sfVolumePts + sfCompletionPts + sfDisciplinePts + sfVersatilityPts);
    // Board Log Mastery (0-100):
    // - Active logging usage (up to 35 pts): >= 5 logs (or client match actions)
    // - Sync accuracy (up to 30 pts): synced / total logs (penalizes reverts/failures)
    // - Client matching (up to 20 pts): logs with client matched directly or matched via modal
    // - Metadata completeness (up to 15 pts): gate/vehicle/time filled
    const effectiveBoardActivity = input.totalLogs + input.matchedClientActions;
    const accuracyRate = input.totalLogs > 0
        ? Math.round((Math.max(0, input.syncedLogs - input.revertedLogs) / input.totalLogs) * 100)
        : 0;
    const clientMatchRate = input.totalLogs > 0
        ? Math.round((input.clientMatchedLogs / input.totalLogs) * 100)
        : (input.matchedClientActions > 0 ? 100 : 0);
    const metadataCompletenessRate = input.totalLogs > 0
        ? Math.round((input.completeMetadataLogs / input.totalLogs) * 100)
        : 0;
    const blVolumePts = effectiveBoardActivity === 0
        ? 0
        : Math.min(35, Math.round((Math.min(effectiveBoardActivity, 6) / 6) * 35));
    const blAccuracyPts = input.totalLogs > 0 ? Math.round((accuracyRate / 100) * 30) : (input.matchedClientActions > 0 ? 25 : 0);
    const blClientPts = effectiveBoardActivity > 0 ? Math.round((clientMatchRate / 100) * 20) : 0;
    const blMetadataPts = input.totalLogs > 0 ? Math.round((metadataCompletenessRate / 100) * 15) : 0;
    const boardLogMasteryScore = Math.min(100, blVolumePts + blAccuracyPts + blClientPts + blMetadataPts);
    const overallMasteryScore = input.excludeBoardLogs
        ? Math.min(100, Math.round(shopFloorMasteryScore * 0.70 + Math.min(100, Math.max(0, input.attendanceRate)) * 0.30))
        : Math.min(100, Math.round(shopFloorMasteryScore * 0.45 + boardLogMasteryScore * 0.35 + Math.min(100, Math.max(0, input.attendanceRate)) * 0.20));
    const masteryTier = overallMasteryScore >= 85
        ? 'Master'
        : overallMasteryScore >= 70
            ? 'Proficient'
            : overallMasteryScore >= 50
                ? 'Developing'
                : 'Needs Coaching';
    return {
        timerDisciplineRate,
        shopFloorMasteryScore,
        accuracyRate,
        clientMatchRate,
        metadataCompletenessRate,
        boardLogMasteryScore,
        overallMasteryScore,
        masteryTier,
    };
}
function buildInsights(profile) {
    const strengths = [];
    const recommendations = [];
    if (profile.shopFloor.sessionsCount > 0 && profile.shopFloor.timerDisciplineRate >= 90) {
        strengths.push(`Strong Shop Floor timer discipline (${profile.shopFloor.timerDisciplineRate}% of sessions cleanly paused/stopped).`);
    }
    if (profile.shopFloor.workOrdersCompletedCount >= 3) {
        strengths.push(`Consistent job completion: finished ${profile.shopFloor.workOrdersCompletedCount} of ${profile.shopFloor.workOrdersWorkedCount} work orders worked.`);
    }
    if (profile.shopFloor.workcenters.length >= 2) {
        strengths.push(`Cross-trained across ${profile.shopFloor.workcenters.length} factory areas (${profile.shopFloor.workcenters.map((w) => w.workcenterName).join(', ')}).`);
    }
    if (profile.boardLog.totalLogs > 0 && profile.boardLog.accuracyRate >= 90) {
        strengths.push(`High Board Log accuracy (${profile.boardLog.accuracyRate}% clean sync across ${profile.boardLog.totalLogs} intakes, ${profile.boardLog.totalSheets} sheets).`);
    }
    if (profile.boardLog.matchedClientActions > 0) {
        strengths.push(`Actively matched ${profile.boardLog.matchedClientActions} pending board intake(s) to client accounts.`);
    }
    if (profile.attendance.attendanceRate >= 90) {
        strengths.push(`Reliable shift attendance (${profile.attendance.attendanceRate}% coverage, ${profile.attendance.checkoutIntegrityRate}% clean check-outs).`);
    }
    if (profile.shopFloor.sessionsCount === 0) {
        recommendations.push('No Shop Floor work order timers recorded in this window — ensure the operator activates their 4-digit PIN profile and starts/pauses jobs in the Shop Floor app.');
    }
    else {
        if (profile.shopFloor.openTimersCount > 0) {
            recommendations.push(`Left ${profile.shopFloor.openTimersCount} work order timer(s) open — coach on clicking Pause/Stop before breaks and end of shift.`);
        }
        if (profile.shopFloor.workOrdersWorkedCount > 0 && profile.shopFloor.workOrdersCompletedCount === 0) {
            recommendations.push('Started work orders without marking any Finished — confirm operator clicks Finish when cutting/edging completes.');
        }
    }
    if (!(0, shopFloorReporting_1.isExcludedFromBoardLogs)({ name: profile.operator.name, email: profile.operator.workEmail })) {
        if (profile.boardLog.totalLogs === 0 && profile.boardLog.matchedClientActions === 0) {
            recommendations.push('No Board Log entries recorded in this period — verify if operator is assigned gate/board intake duties or needs onboarding on Board Log.');
        }
        else {
            if (profile.boardLog.revertedLogs > 0) {
                recommendations.push(`${profile.boardLog.revertedLogs} board log(s) required revert — double-check board thickness, quantity, and client before submitting.`);
            }
            if (profile.boardLog.totalLogs > 0 && profile.boardLog.metadataCompletenessRate < 70) {
                recommendations.push(`Metadata completeness is ${profile.boardLog.metadataCompletenessRate}% — include vehicle registration, gate, and arrival time consistently.`);
            }
        }
    }
    if (profile.attendance.expectedWorkdays > 0 && profile.attendance.attendanceRate < 80) {
        recommendations.push(`Attendance rate is ${profile.attendance.attendanceRate}% (${profile.attendance.daysAttended}/${profile.attendance.expectedWorkdays} workdays) — review missed check-ins.`);
    }
    if (!strengths.length) {
        strengths.push('Operator profile is active and linked to Odoo attendance & work centers.');
    }
    if (!recommendations.length) {
        recommendations.push('Maintain current Shop Floor and Board Log workflow standards.');
    }
    return { strengths, recommendations };
}
function actorMatchesOperator(actorName, actorEmail, opName, opEmail) {
    const normEmail = String(actorEmail || '').trim().toLowerCase();
    const targetEmail = String(opEmail || '').trim().toLowerCase();
    if (normEmail && targetEmail && normEmail === targetEmail)
        return true;
    const normActor = String(actorName || '').trim().toLowerCase();
    const normOp = String(opName || '').trim().toLowerCase();
    if (!normActor || !normOp)
        return false;
    if (normActor === normOp || normActor.includes(normOp) || normOp.includes(normActor))
        return true;
    const opTokens = normOp.split(/\s+/).filter((t) => t.length >= 4);
    return opTokens.some((token) => normActor.includes(token));
}
async function buildOperatorProfileReport(operatorId, scope) {
    const settings = await (0, repositories_1.getSettings)();
    const client = new odooClient_1.OdooClient(settings.odoo);
    const reportingBaseline = settings.mail.shopFloorReportingStartDate;
    const fallbackWindow = defaultProfileWindow();
    const rawStart = scope?.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(scope.fromDate) ? scope.fromDate : fallbackWindow.start;
    const rawEnd = scope?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(scope.toDate) ? scope.toDate : fallbackWindow.end;
    const reportStart = (0, shopFloorReporting_1.clampShopFloorReportingDate)(rawStart, reportingBaseline);
    const reportEnd = (0, shopFloorReporting_1.clampShopFloorReportingDate)(rawEnd, reportingBaseline);
    const dbOperators = await (0, repositories_1.getShopFloorOperatorsFromDb)().catch(() => []);
    let opMeta = dbOperators.find((o) => Number(o.id) === Number(operatorId));
    if (!opMeta) {
        const odooEmps = await client.searchReadRecords('hr.employee', {
            domain: [['id', '=', operatorId]],
            fields: ['id', 'name', 'job_title', 'work_email'],
            limit: 1,
        }).catch(() => []);
        const emp = odooEmps[0];
        if (!emp) {
            throw new Error(`Operator #${operatorId} was not found.`);
        }
        opMeta = {
            id: emp.id,
            name: emp.name,
            jobTitle: emp.job_title ? String(emp.job_title) : 'Operator',
            workEmail: emp.work_email ? String(emp.work_email) : null,
        };
    }
    const startBoundaryUtc = `${reportStart} 00:00:00`;
    const endBoundaryUtc = `${reportEnd} 23:59:59`;
    const expectedDates = countNonSundayWorkdays(reportStart, reportEnd);
    const [productivityRows, boardRows, attendanceRows] = await Promise.all([
        client.searchReadRecords('mrp.workcenter.productivity', {
            domain: [
                ['employee_id', '=', operatorId],
                ['date_start', '>=', startBoundaryUtc],
                ['date_start', '<=', endBoundaryUtc],
            ],
            fields: ['id', 'workorder_id', 'workcenter_id', 'date_start', 'date_end', 'duration'],
            limit: 500,
            order: 'date_start desc',
        }).catch(() => []),
        (0, db_1.queryAll)(`SELECT id, product_name, customer_name, partner_id, quantity, actor_name, actor_email,
              vehicle_registration, arrival_date, arrival_time, gate, status, reverted_at, matched_by, created_at
       FROM board_intake_queue
       WHERE COALESCE(NULLIF(arrival_date, ''), substr(created_at, 1, 10)) >= ?
         AND COALESCE(NULLIF(arrival_date, ''), substr(created_at, 1, 10)) <= ?
       ORDER BY created_at DESC`, [reportStart, reportEnd]).catch(() => []),
        client.getBulkAttendanceRange([operatorId], addDays(reportStart, -1), reportEnd).catch(() => []),
    ]);
    // Resolve distinct work orders worked & how many reached done
    const woIds = [...new Set(productivityRows
            .map((p) => (Array.isArray(p.workorder_id) ? Number(p.workorder_id[0]) : 0))
            .filter((id) => id > 0))];
    const workorders = woIds.length
        ? await client.searchReadRecords('mrp.workorder', {
            domain: [['id', 'in', woIds]],
            fields: ['id', 'state', 'workcenter_id'],
            limit: 500,
        }).catch(() => [])
        : [];
    const doneWoIds = new Set(workorders.filter((w) => w.state === 'done').map((w) => w.id));
    const wcMap = new Map();
    let totalMinutes = 0;
    let openTimersCount = 0;
    for (const row of productivityRows) {
        if (!row.date_end) {
            openTimersCount += 1;
        }
        const mins = Number(row.duration || 0);
        totalMinutes += mins > 0 ? mins : 0;
        const wcName = Array.isArray(row.workcenter_id) ? String(row.workcenter_id[1] || 'General') : 'General';
        const current = wcMap.get(wcName) || { sessions: 0, minutes: 0 };
        current.sessions += 1;
        current.minutes += mins > 0 ? mins : 0;
        wcMap.set(wcName, current);
    }
    const workcenters = [...wcMap.entries()]
        .map(([workcenterName, stats]) => ({
        workcenterName,
        sessions: stats.sessions,
        hours: Number((stats.minutes / 60).toFixed(2)),
    }))
        .sort((a, b) => b.sessions - a.sessions);
    // Filter board intake logs by this operator
    const myBoardLogs = boardRows.filter((r) => actorMatchesOperator(r.actor_name, r.actor_email, opMeta.name, opMeta.workEmail || null));
    const matchedClientActions = boardRows.filter((r) => r.matched_by && actorMatchesOperator(r.matched_by, null, opMeta.name, opMeta.workEmail || null)).length;
    const totalLogs = myBoardLogs.length;
    const totalSheets = myBoardLogs.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const syncedLogs = myBoardLogs.filter((r) => r.status === 'synced' && !r.reverted_at).length;
    const revertedLogs = myBoardLogs.filter((r) => r.status === 'reverted' || Boolean(r.reverted_at)).length;
    const failedLogs = myBoardLogs.filter((r) => r.status === 'failed').length;
    const clientMatchedLogs = myBoardLogs.filter((r) => Number(r.partner_id || 0) > 0 && String(r.customer_name || '') !== 'Pending Client Matching').length;
    const completeMetadataLogs = myBoardLogs.filter((r) => Boolean(String(r.gate || '').trim()) && Boolean(String(r.vehicle_registration || '').trim()) && Boolean(String(r.arrival_time || '').trim())).length;
    const recentLogs = myBoardLogs.slice(0, 8).map((r) => ({
        date: String(r.arrival_date || String(r.created_at || '').slice(0, 10)),
        productName: String(r.product_name || 'Board'),
        customerName: String(r.customer_name || 'Pending'),
        quantity: Number(r.quantity || 0),
        status: r.reverted_at || r.status === 'reverted' ? 'reverted' : String(r.status || 'pending'),
    }));
    // Attendance summary
    const expectedWorkdays = expectedDates.length;
    let daysAttended = 0;
    let blankCheckouts = 0;
    let overtimeHours = 0;
    for (const dateKey of expectedDates) {
        const dayRecords = attendanceRows.filter((rec) => nairobiDateKey(rec.check_in) === dateKey);
        const classified = (0, attendanceReconciliation_1.classifyAttendanceRecords)(dayRecords);
        const coveredByOvernight = attendanceRows.some((rec) => (0, attendanceReconciliation_1.completedAttendanceCoversWorkday)(rec, dateKey, (v) => nairobiDateKey(v)));
        if (classified.status !== 'Absent' || coveredByOvernight) {
            daysAttended += 1;
        }
        blankCheckouts += classified.missingCheckoutRecords.length;
    }
    for (const rec of attendanceRows) {
        const inKey = nairobiDateKey(rec.check_in);
        if (inKey >= reportStart && inKey <= reportEnd && Number(rec.worked_hours || 0) > 9) {
            overtimeHours += Math.max(0, Number(rec.worked_hours || 0) - 9);
        }
    }
    const attendanceRate = expectedWorkdays > 0 ? Math.round((daysAttended / expectedWorkdays) * 100) : 0;
    const checkoutIntegrityRate = daysAttended > 0
        ? Math.max(0, Math.round(((daysAttended - blankCheckouts) / daysAttended) * 100))
        : 0;
    const scores = computeOperatorMasteryScores({
        sessionsCount: productivityRows.length,
        workOrdersWorkedCount: woIds.length,
        workOrdersCompletedCount: doneWoIds.size,
        totalProductionHours: Number((totalMinutes / 60).toFixed(2)),
        openTimersCount,
        workcenterCount: workcenters.length,
        totalLogs,
        syncedLogs,
        revertedLogs,
        clientMatchedLogs,
        matchedClientActions,
        completeMetadataLogs,
        attendanceRate,
        excludeBoardLogs: (0, shopFloorReporting_1.isExcludedFromBoardLogs)({ name: opMeta.name, email: opMeta.workEmail }),
    });
    const baseProfile = {
        operator: {
            id: opMeta.id,
            name: opMeta.name,
            jobTitle: opMeta.jobTitle || 'Factory Operator',
            workEmail: opMeta.workEmail || null,
        },
        period: {
            start: reportStart,
            end: reportEnd,
            expectedWorkdays,
        },
        shopFloor: {
            sessionsCount: productivityRows.length,
            workOrdersWorkedCount: woIds.length,
            workOrdersCompletedCount: doneWoIds.size,
            totalProductionHours: Number((totalMinutes / 60).toFixed(2)),
            openTimersCount,
            timerDisciplineRate: scores.timerDisciplineRate,
            workcenters,
            masteryScore: scores.shopFloorMasteryScore,
        },
        boardLog: {
            totalLogs,
            totalSheets,
            syncedLogs,
            revertedLogs,
            failedLogs,
            clientMatchedLogs,
            matchedClientActions,
            completeMetadataLogs,
            accuracyRate: scores.accuracyRate,
            clientMatchRate: scores.clientMatchRate,
            metadataCompletenessRate: scores.metadataCompletenessRate,
            masteryScore: scores.boardLogMasteryScore,
            recentLogs,
        },
        attendance: {
            daysAttended,
            expectedWorkdays,
            attendanceRate,
            checkoutIntegrityRate,
            overtimeHours: Number(overtimeHours.toFixed(1)),
        },
        overallMasteryScore: scores.overallMasteryScore,
        masteryTier: scores.masteryTier,
    };
    const insights = buildInsights(baseProfile);
    return { ...baseProfile, ...insights };
}
async function renderOperatorProfilePdf(profile) {
    const doc = new pdfkit_1.default({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    const done = new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 80;
    const navy = '#17162d';
    const ink = '#0f172a';
    const muted = '#64748b';
    const border = '#e2e8f0';
    const tierColor = profile.masteryTier === 'Master'
        ? '#059669'
        : profile.masteryTier === 'Proficient'
            ? '#2563eb'
            : profile.masteryTier === 'Developing'
                ? '#d97706'
                : '#dc2626';
    // Header Banner
    doc.rect(0, 0, pageWidth, 92).fill(navy);
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text(profile.operator.name, 40, 24, { width: 360 });
    doc.font('Helvetica').fontSize(9.5).fillColor('#cbd5e1')
        .text(`${profile.operator.jobTitle} · Employee #${profile.operator.id}`, 40, 48)
        .text(`Operator Usage & Mastery Profile · ${profile.period.start} to ${profile.period.end}`, 40, 63);
    // Mastery Badge on top-right
    doc.roundedRect(pageWidth - 175, 22, 135, 48, 8).fill(tierColor);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#ffffff').text(`${profile.overallMasteryScore}%`, pageWidth - 175, 29, { width: 135, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff').text(profile.masteryTier.toUpperCase(), pageWidth - 175, 51, { width: 135, align: 'center' });
    doc.y = 110;
    // 4 KPI Cards
    const cardGap = 10;
    const cardWidth = (contentWidth - cardGap * 3) / 4;
    const kpis = [
        { label: 'OVERALL MASTERY', value: `${profile.overallMasteryScore}%`, sub: profile.masteryTier, color: tierColor },
        { label: 'SHOP FLOOR SCORE', value: `${profile.shopFloor.masteryScore}%`, sub: `${profile.shopFloor.workOrdersWorkedCount} WOs · ${profile.shopFloor.totalProductionHours}h`, color: '#2563eb' },
        { label: 'BOARD LOG SCORE', value: `${profile.boardLog.masteryScore}%`, sub: `${profile.boardLog.totalLogs} logs · ${profile.boardLog.totalSheets} shts`, color: '#059669' },
        { label: 'ATTENDANCE', value: `${profile.attendance.attendanceRate}%`, sub: `${profile.attendance.daysAttended}/${profile.attendance.expectedWorkdays} days`, color: '#7c3aed' },
    ];
    const cardY = doc.y;
    kpis.forEach((kpi, idx) => {
        const x = 40 + idx * (cardWidth + cardGap);
        doc.roundedRect(x, cardY, cardWidth, 62, 6).fillAndStroke('#f8fafc', border);
        doc.rect(x, cardY, cardWidth, 3).fill(kpi.color);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(muted).text(kpi.label, x + 8, cardY + 10, { width: cardWidth - 16 });
        doc.font('Helvetica-Bold').fontSize(15).fillColor(ink).text(kpi.value, x + 8, cardY + 23, { width: cardWidth - 16 });
        doc.font('Helvetica').fontSize(7.5).fillColor(muted).text(kpi.sub, x + 8, cardY + 44, { width: cardWidth - 16, lineBreak: false });
    });
    doc.y = cardY + 78;
    // Visual System Usage & Knowledge Pie Graphs
    const usagePanelY = doc.y;
    const usagePanelH = 128;
    doc.roundedRect(40, usagePanelY, contentWidth, usagePanelH, 8).fillAndStroke('#f8fafc', border);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(navy)
        .text('SYSTEM USAGE MIX', 52, usagePanelY + 10, { width: 230 })
        .text('KNOWLEDGE & MASTERY CONTRIBUTION', 300, usagePanelY + 10, { width: 240 });
    const totalUsageEvents = profile.shopFloor.sessionsCount
        + profile.boardLog.totalLogs
        + profile.boardLog.matchedClientActions
        + profile.attendance.daysAttended;
    (0, pdfPieChart_1.drawPdfPieChart)(doc, {
        cx: 96,
        cy: usagePanelY + 72,
        radius: 40,
        innerRadius: 19,
        slices: [
            { label: 'Shop Floor Timers', value: profile.shopFloor.sessionsCount, color: '#2563eb', sublabel: `${profile.shopFloor.sessionsCount} session(s)` },
            { label: 'Board Intake Logs', value: profile.boardLog.totalLogs, color: '#059669', sublabel: `${profile.boardLog.totalLogs} log(s)` },
            { label: 'Client Matches', value: profile.boardLog.matchedClientActions, color: '#d97706', sublabel: `${profile.boardLog.matchedClientActions} match(es)` },
            { label: 'Attendance Days', value: profile.attendance.daysAttended, color: '#7c3aed', sublabel: `${profile.attendance.daysAttended} day(s)` },
        ],
        centerTopText: String(totalUsageEvents),
        centerBottomText: 'ACTIONS',
        emptyLabel: 'No usage',
        legend: {
            x: 148,
            y: usagePanelY + 27,
            width: 138,
            rowHeight: 22,
        },
    });
    const sfWeight = Math.round(profile.shopFloor.masteryScore * 0.45);
    const blWeight = Math.round(profile.boardLog.masteryScore * 0.35);
    const attWeight = Math.round(profile.attendance.attendanceRate * 0.20);
    const gapWeight = Math.max(0, 100 - Math.min(100, sfWeight + blWeight + attWeight));
    (0, pdfPieChart_1.drawPdfPieChart)(doc, {
        cx: 344,
        cy: usagePanelY + 72,
        radius: 40,
        innerRadius: 19,
        slices: [
            { label: 'Shop Floor Mastery', value: sfWeight, color: '#2563eb', sublabel: `${profile.shopFloor.masteryScore}% score (45% wt)` },
            { label: 'Board Log Mastery', value: blWeight, color: '#059669', sublabel: `${profile.boardLog.masteryScore}% score (35% wt)` },
            { label: 'Attendance Discipline', value: attWeight, color: '#7c3aed', sublabel: `${profile.attendance.attendanceRate}% rate (20% wt)` },
            { label: 'Growth Opportunity', value: gapWeight, color: '#cbd5e1', sublabel: `${gapWeight} pts to 100%` },
        ],
        centerTopText: `${profile.overallMasteryScore}%`,
        centerBottomText: 'KNOWLEDGE',
        legend: {
            x: 396,
            y: usagePanelY + 27,
            width: 148,
            rowHeight: 22,
        },
    });
    doc.y = usagePanelY + usagePanelH + 14;
    // Section 1: Shop Floor App Usage & Mastery
    doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('1. Shop Floor App Usage & Mastery', 40, doc.y);
    doc.moveTo(40, doc.y + 4).lineTo(pageWidth - 40, doc.y + 4).strokeColor(border).lineWidth(0.8).stroke();
    doc.y += 12;
    const sfStats = [
        `Work Orders Worked: ${profile.shopFloor.workOrdersWorkedCount}`,
        `Work Orders Completed: ${profile.shopFloor.workOrdersCompletedCount}`,
        `Timer Sessions: ${profile.shopFloor.sessionsCount}`,
        `Active Hours: ${profile.shopFloor.totalProductionHours} hrs`,
        `Timer Pause/Stop Discipline: ${profile.shopFloor.timerDisciplineRate}%`,
        `Open/Unclosed Timers: ${profile.shopFloor.openTimersCount}`,
    ];
    doc.font('Helvetica').fontSize(8.8).fillColor(ink);
    for (let i = 0; i < sfStats.length; i += 2) {
        const rowY = doc.y;
        doc.text(`• ${sfStats[i]}`, 46, rowY, { width: contentWidth / 2 - 10 });
        if (sfStats[i + 1]) {
            doc.text(`• ${sfStats[i + 1]}`, 46 + contentWidth / 2, rowY, { width: contentWidth / 2 - 10 });
        }
        doc.y = rowY + 15;
    }
    if (profile.shopFloor.workcenters.length > 0) {
        doc.y += 4;
        const thY = doc.y;
        doc.rect(40, thY, contentWidth, 20).fill('#f1f5f9');
        doc.font('Helvetica-Bold').fontSize(8).fillColor(muted)
            .text('Work Center Area', 48, thY + 6, { width: 260 })
            .text('Sessions', 310, thY + 6, { width: 90, align: 'center' })
            .text('Hours Logged', 410, thY + 6, { width: 90, align: 'right' });
        doc.y = thY + 20;
        profile.shopFloor.workcenters.forEach((wc, idx) => {
            const rY = doc.y;
            if (idx % 2 === 1)
                doc.rect(40, rY, contentWidth, 19).fill('#f8fafc');
            doc.font('Helvetica').fontSize(8.2).fillColor(ink)
                .text(wc.workcenterName, 48, rY + 5, { width: 260 })
                .text(String(wc.sessions), 310, rY + 5, { width: 90, align: 'center' })
                .text(`${wc.hours.toFixed(2)} h`, 410, rY + 5, { width: 90, align: 'right' });
            doc.y = rY + 19;
        });
    }
    else {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(muted).text('No work center timer sessions recorded in this date window.', 46, doc.y + 2);
        doc.y += 18;
    }
    doc.y += 14;
    // Section 2: Board Log App Usage & Mastery
    doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('2. Board Log App Usage & Mastery', 40, doc.y);
    doc.moveTo(40, doc.y + 4).lineTo(pageWidth - 40, doc.y + 4).strokeColor(border).lineWidth(0.8).stroke();
    doc.y += 12;
    const blStats = [
        `Total Board Intakes Logged: ${profile.boardLog.totalLogs}`,
        `Total Sheets Recorded: ${profile.boardLog.totalSheets}`,
        `Clean Sync Accuracy: ${profile.boardLog.accuracyRate}% (${profile.boardLog.syncedLogs} synced, ${profile.boardLog.revertedLogs} reverted)`,
        `Client Match Rate: ${profile.boardLog.clientMatchRate}% (${profile.boardLog.matchedClientActions} pending logs matched)`,
        `Metadata Completeness (Gate/Vehicle/Time): ${profile.boardLog.metadataCompletenessRate}%`,
        `Failed Syncs: ${profile.boardLog.failedLogs}`,
    ];
    doc.font('Helvetica').fontSize(8.8).fillColor(ink);
    for (let i = 0; i < blStats.length; i += 2) {
        const rowY = doc.y;
        doc.text(`• ${blStats[i]}`, 46, rowY, { width: contentWidth / 2 - 10 });
        if (blStats[i + 1]) {
            doc.text(`• ${blStats[i + 1]}`, 46 + contentWidth / 2, rowY, { width: contentWidth / 2 - 10 });
        }
        doc.y = rowY + 15;
    }
    if (profile.boardLog.recentLogs.length > 0) {
        doc.y += 4;
        const thY = doc.y;
        doc.rect(40, thY, contentWidth, 20).fill('#f1f5f9');
        doc.font('Helvetica-Bold').fontSize(8).fillColor(muted)
            .text('Date', 48, thY + 6, { width: 65 })
            .text('Board Product', 118, thY + 6, { width: 175 })
            .text('Client', 298, thY + 6, { width: 130 })
            .text('Qty', 432, thY + 6, { width: 40, align: 'center' })
            .text('Status', 476, thY + 6, { width: 70, align: 'right' });
        doc.y = thY + 20;
        profile.boardLog.recentLogs.slice(0, 6).forEach((log, idx) => {
            const rY = doc.y;
            if (idx % 2 === 1)
                doc.rect(40, rY, contentWidth, 18).fill('#f8fafc');
            doc.font('Helvetica').fontSize(7.8).fillColor(ink)
                .text(log.date, 48, rY + 5, { width: 65, lineBreak: false })
                .text(log.productName.slice(0, 34), 118, rY + 5, { width: 175, lineBreak: false })
                .text(log.customerName.slice(0, 24), 298, rY + 5, { width: 130, lineBreak: false })
                .text(String(log.quantity), 432, rY + 5, { width: 40, align: 'center' })
                .fillColor(log.status === 'synced' ? '#059669' : log.status === 'reverted' ? '#d97706' : '#dc2626')
                .text(log.status.toUpperCase(), 476, rY + 5, { width: 70, align: 'right' });
            doc.y = rY + 18;
        });
    }
    else {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(muted).text('No board intake entries recorded by this operator in this window.', 46, doc.y + 2);
        doc.y += 18;
    }
    doc.y += 14;
    // Section 3: Strengths & Coaching Recommendations
    if (doc.y > 660)
        doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text('3. Profile Assessment & Coaching Focus', 40, doc.y);
    doc.moveTo(40, doc.y + 4).lineTo(pageWidth - 40, doc.y + 4).strokeColor(border).lineWidth(0.8).stroke();
    doc.y += 12;
    doc.font('Helvetica-Bold').fontSize(8.8).fillColor('#059669').text('Strengths', 44, doc.y);
    doc.y += 13;
    profile.strengths.forEach((item) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(ink).text(`✓ ${item}`, 50, doc.y, { width: contentWidth - 14 });
        doc.y += 4;
    });
    doc.y += 6;
    doc.font('Helvetica-Bold').fontSize(8.8).fillColor('#b45309').text('Coaching & Next Steps', 44, doc.y);
    doc.y += 13;
    profile.recommendations.forEach((item) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(ink).text(`→ ${item}`, 50, doc.y, { width: contentWidth - 14 });
        doc.y += 4;
    });
    // Footer
    const footerUrl = String(env_1.env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke').replace(/\/+$/, '');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        const fy = doc.page.height - 44;
        doc.moveTo(40, fy - 6).lineTo(pageWidth - 40, fy - 6).strokeColor(border).lineWidth(0.6).stroke();
        doc.font('Helvetica').fontSize(7.2).fillColor(muted)
            .text(`Urban Vibe Shop Floor · ${footerUrl}`, 40, fy, { width: contentWidth - 60, lineBreak: false })
            .text(`Page ${i - range.start + 1} of ${range.count}`, pageWidth - 95, fy, { width: 55, align: 'right', lineBreak: false });
    }
    doc.end();
    const pdf = await done;
    const filename = `operator-profile-${slugifyName(profile.operator.name)}-${profile.period.start}-to-${profile.period.end}.pdf`;
    return { pdf, filename };
}
async function sendOperatorProfileReport(operatorId, recipientEmail, scope) {
    const settings = await (0, repositories_1.getSettings)();
    const profile = await buildOperatorProfileReport(operatorId, scope);
    const { pdf, filename } = await renderOperatorProfilePdf(profile);
    const to = String(recipientEmail || exports.LEOIVARD_REPORT_EMAIL).trim().toLowerCase();
    await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to,
        subject: `Operator Mastery Profile: ${profile.operator.name} (${profile.overallMasteryScore}% · ${profile.masteryTier})`,
        text: `Attached is the Shop Floor & Board Log mastery profile for ${profile.operator.name} (${profile.period.start} to ${profile.period.end}). Overall Mastery: ${profile.overallMasteryScore}% (${profile.masteryTier}).`,
        html: `
      <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:600px;">
        <h2 style="margin:0 0 8px;color:#17162d;">Operator Usage &amp; Mastery Profile</h2>
        <p style="margin:0 0 12px;color:#475569;"><strong>${profile.operator.name}</strong> (${profile.operator.jobTitle}) · ${profile.period.start} to ${profile.period.end}</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">
          <tr>
            <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Overall Mastery</strong><br/>${profile.overallMasteryScore}% (${profile.masteryTier})</td>
            <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Shop Floor</strong><br/>${profile.shopFloor.masteryScore}% (${profile.shopFloor.workOrdersWorkedCount} WOs)</td>
            <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Board Log</strong><br/>${profile.boardLog.masteryScore}% (${profile.boardLog.totalLogs} logs)</td>
            <td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;"><strong>Attendance</strong><br/>${profile.attendance.attendanceRate}%</td>
          </tr>
        </table>
        <p style="font-size:13px;color:#475569;">The full profiled PDF report is attached.</p>
      </div>
    `,
        attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
    });
    await (0, logService_1.logEvent)('info', 'Operator mastery profile report sent', {
        operatorId: profile.operator.id,
        operatorName: profile.operator.name,
        recipient: to,
        overallMasteryScore: profile.overallMasteryScore,
        masteryTier: profile.masteryTier,
    }).catch(() => undefined);
    return { profile, recipient: to, filename };
}
async function sendAllOperatorProfileReports(recipientEmail, scope) {
    const settings = await (0, repositories_1.getSettings)();
    const to = String(recipientEmail || exports.LEOIVARD_REPORT_EMAIL).trim().toLowerCase();
    const profiles = [];
    const attachments = [];
    for (const opId of exports.CORE_OPERATOR_IDS) {
        try {
            const profile = await buildOperatorProfileReport(opId, scope);
            const { pdf, filename } = await renderOperatorProfilePdf(profile);
            profiles.push(profile);
            attachments.push({ filename, content: pdf, contentType: 'application/pdf' });
        }
        catch (err) {
            console.warn(`[OperatorProfileReport] Skipping operator ${opId}:`, err);
        }
    }
    if (!profiles.length) {
        throw new Error('No factory operator profiles could be generated.');
    }
    const period = profiles[0].period;
    const rowsHtml = profiles
        .map((p) => `
        <tr>
          <td style="padding:8px;border:1px solid #e2e8f0;"><strong>${p.operator.name}</strong><br/><span style="color:#64748b;font-size:11px;">${p.operator.jobTitle}</span></td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;"><strong>${p.shopFloor.masteryScore}%</strong><br/><span style="color:#64748b;font-size:11px;">${p.shopFloor.workOrdersWorkedCount} WOs · ${p.shopFloor.totalProductionHours}h</span></td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;"><strong>${p.boardLog.masteryScore}%</strong><br/><span style="color:#64748b;font-size:11px;">${p.boardLog.totalLogs} logs · ${p.boardLog.totalSheets} shts</span></td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;">${p.attendance.attendanceRate}%</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:center;"><strong>${p.overallMasteryScore}%</strong><br/><span style="font-size:11px;">${p.masteryTier}</span></td>
        </tr>`)
        .join('');
    await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to,
        subject: `Factory Operators Mastery Profiles (${period.start} to ${period.end})`,
        text: `Attached are the ${profiles.length} individual Shop Floor & Board Log mastery profile PDFs for ${profiles.map((p) => p.operator.name).join(', ')}.`,
        html: `
      <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:680px;">
        <h2 style="margin:0 0 6px;color:#17162d;">Factory Operators Usage &amp; Mastery Profiles</h2>
        <p style="margin:0 0 14px;color:#475569;">Period: <strong>${period.start}</strong> to <strong>${period.end}</strong> · ${profiles.length} individual PDF reports attached.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#17162d;color:#ffffff;">
              <th style="padding:8px;text-align:left;">Operator</th>
              <th style="padding:8px;text-align:center;">Shop Floor</th>
              <th style="padding:8px;text-align:center;">Board Log</th>
              <th style="padding:8px;text-align:center;">Attendance</th>
              <th style="padding:8px;text-align:center;">Overall</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `,
        attachments,
    });
    await (0, logService_1.logEvent)('info', 'All factory operator mastery profile reports sent', {
        recipient: to,
        operatorCount: profiles.length,
        period,
    }).catch(() => undefined);
    return { profiles, recipient: to, attachmentCount: attachments.length };
}
