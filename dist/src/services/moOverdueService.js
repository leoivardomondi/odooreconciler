"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMoEstimatedFinish = getMoEstimatedFinish;
exports.getConfirmedMoQueueSchedule = getConfirmedMoQueueSchedule;
exports.getMoOverdueState = getMoOverdueState;
const NAIROBI_WORK_START_UTC_HOUR = 5; // 8:00 AM Nairobi
const NAIROBI_WORK_END_UTC_HOUR = 14; // 5:00 PM Nairobi
const NAIROBI_SATURDAY_END_UTC_HOUR = 11; // 2:00 PM Nairobi
const CUTTING_MINUTES_PER_BOARD = 5;
const EDGING_MINUTES_PER_METRE = 1;
const BREAKS_UTC_MINUTES = [
    [7 * 60, 7 * 60 + 15], // 10:00-10:15 Nairobi breakfast
    [10 * 60, 10 * 60 + 40], // 1:00-1:40 Nairobi lunch
];
function parseOdooDate(value) {
    if (!value)
        return null;
    const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function nairobiDateKey(value) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function isNonWorkingDay(value) {
    return value.getUTCDay() === 0;
}
function workEndUtcHour(value) {
    return value.getUTCDay() === 6 ? NAIROBI_SATURDAY_END_UTC_HOUR : NAIROBI_WORK_END_UTC_HOUR;
}
function nextWorkingStart(value) {
    const result = new Date(value);
    while (isNonWorkingDay(result))
        result.setUTCDate(result.getUTCDate() + 1);
    result.setUTCHours(NAIROBI_WORK_START_UTC_HOUR, 0, 0, 0);
    return result;
}
function normalizeWorkingStart(value) {
    const result = new Date(value);
    if (isNonWorkingDay(result))
        return nextWorkingStart(result);
    const minutes = result.getUTCHours() * 60 + result.getUTCMinutes();
    const workStart = NAIROBI_WORK_START_UTC_HOUR * 60;
    const workEnd = workEndUtcHour(result) * 60;
    if (minutes < workStart)
        result.setUTCHours(NAIROBI_WORK_START_UTC_HOUR, 0, 0, 0);
    if (minutes >= workEnd) {
        result.setUTCDate(result.getUTCDate() + 1);
        return nextWorkingStart(result);
    }
    const activeBreak = BREAKS_UTC_MINUTES.find(([from, to]) => minutes >= from && minutes < to);
    if (activeBreak)
        result.setUTCHours(Math.floor(activeBreak[1] / 60), activeBreak[1] % 60, 0, 0);
    return result;
}
function addWorkingMinutes(start, totalMinutes) {
    const result = normalizeWorkingStart(start);
    let remaining = Math.max(1, totalMinutes);
    while (remaining > 0) {
        const minuteOfDay = result.getUTCHours() * 60 + result.getUTCMinutes();
        const activeBreak = BREAKS_UTC_MINUTES.find(([from, to]) => minuteOfDay >= from && minuteOfDay < to);
        if (activeBreak) {
            result.setUTCHours(Math.floor(activeBreak[1] / 60), activeBreak[1] % 60, 0, 0);
            continue;
        }
        const nextBreak = BREAKS_UTC_MINUTES.find(([from]) => from > minuteOfDay);
        const dayEndMinutes = workEndUtcHour(result) * 60;
        const boundaryMinutes = nextBreak && nextBreak[0] < dayEndMinutes ? nextBreak[0] : dayEndMinutes;
        const available = Math.max(0, boundaryMinutes - minuteOfDay);
        const used = Math.min(remaining, available);
        result.setUTCMinutes(result.getUTCMinutes() + used);
        remaining -= used;
        if (remaining > 0 && boundaryMinutes === dayEndMinutes) {
            result.setUTCDate(result.getUTCDate() + 1);
            result.setTime(nextWorkingStart(result).getTime());
        }
    }
    return result;
}
function isEdgingOperation(productName) {
    return /edge\s*band|edging/i.test(productName || '');
}
function getMoEstimatedFinish(input) {
    const created = parseOdooDate(input.createDate) || parseOdooDate(input.plannedStart);
    if (!created)
        return null;
    const quantity = Math.max(1, Number(input.quantity || 1));
    const minutesPerUnit = isEdgingOperation(input.productName) ? EDGING_MINUTES_PER_METRE : CUTTING_MINUTES_PER_BOARD;
    return addWorkingMinutes(created, Math.ceil(quantity * minutesPerUnit));
}
function getConfirmedMoQueueSchedule(orders) {
    const resourceAvailable = new Map();
    const schedule = new Map();
    const product = (order) => Array.isArray(order.product_id) ? String(order.product_id[1] || '') : String(order.product_id || '');
    const priority = (order) => !isEdgingOperation(product(order)) && Math.max(1, Number(order.product_qty || 1)) < 10 ? 0 : 1;
    [...orders].sort((a, b) => priority(a) - priority(b) || String(a.create_date || '').localeCompare(String(b.create_date || ''))).forEach((order) => {
        const name = product(order);
        const resource = isEdgingOperation(name) ? 'edging' : 'cutting';
        const created = parseOdooDate(order.create_date) || parseOdooDate(order.date_start);
        if (!created)
            return;
        const available = resourceAvailable.get(resource);
        const start = normalizeWorkingStart(available && available > created ? available : created);
        const quantity = Math.max(1, Number(order.product_qty || 1));
        const minutesPerUnit = resource === 'edging' ? EDGING_MINUTES_PER_METRE : CUTTING_MINUTES_PER_BOARD;
        const duration = Math.ceil(quantity * minutesPerUnit);
        const finish = addWorkingMinutes(start, duration);
        resourceAvailable.set(resource, finish);
        schedule.set(order.id, { estimatedStartAt: start.toISOString(), estimatedFinishAt: finish.toISOString(), estimatedDurationMinutes: duration, timingBasis: resource === 'edging' ? '1 minute per edging metre' : '5 minutes per cutting board', queuePriority: priority(order) === 0 ? 'small-mo-priority' : 'standard' });
    });
    return schedule;
}
function getMoOverdueState(input, now = new Date()) {
    const created = parseOdooDate(input.createDate) || parseOdooDate(input.plannedStart);
    const estimatedFinish = getMoEstimatedFinish(input);
    const createdToday = Boolean(created && nairobiDateKey(created) === nairobiDateKey(now));
    const quantity = Math.max(1, Number(input.quantity || 1));
    // Small cutting MOs must begin on their creation day. Edging quantity is in
    // metres, so the under-10-board start rule does not apply to edging services.
    const missedSmallMoStart = Boolean(created && !isEdgingOperation(input.productName) && quantity < 10 && !createdToday && now > created);
    return {
        isOverdue: missedSmallMoStart || Boolean(!createdToday && estimatedFinish && now > estimatedFinish),
        createdToday,
        estimatedFinishAt: estimatedFinish?.toISOString() || null,
        expectedStartAt: quantity < 10 && !isEdgingOperation(input.productName) ? created?.toISOString() || null : null,
        estimatedDurationMinutes: Math.ceil(quantity * (isEdgingOperation(input.productName) ? EDGING_MINUTES_PER_METRE : CUTTING_MINUTES_PER_BOARD)),
        timingBasis: isEdgingOperation(input.productName) ? '1 minute per edging metre' : '5 minutes per cutting board',
        overdueReason: missedSmallMoStart ? 'Small MO not started on creation day' : null,
    };
}
