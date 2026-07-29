"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeManufacturingState = normalizeManufacturingState;
exports.isManufacturingOrderReady = isManufacturingOrderReady;
exports.getManufacturingReadyAt = getManufacturingReadyAt;
function normalizeManufacturingState(state) {
    return String(state || '').trim().toLowerCase();
}
function isManufacturingOrderReady(state) {
    return ['progress', 'in_progress', 'done'].includes(normalizeManufacturingState(state));
}
function parseOdooDate(value) {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
        ? `${trimmed.replace(' ', 'T')}Z`
        : trimmed;
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function getManufacturingReadyAt(order) {
    if (!isManufacturingOrderReady(order.state)) {
        return null;
    }
    return (parseOdooDate(order.date_start) ||
        parseOdooDate(order.date_finished) ||
        parseOdooDate(order.write_date) ||
        parseOdooDate(order.create_date));
}
