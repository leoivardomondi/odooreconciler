"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logEvent = logEvent;
exports.fetchRecentLogs = fetchRecentLogs;
exports.fetchRecentLogsAsync = fetchRecentLogsAsync;
const repositories_1 = require("../models/repositories");
const helpers_1 = require("../utils/helpers");
async function logEvent(level, message, context = {}, historyId) {
    const sanitized = (0, helpers_1.sanitizeForLog)(context);
    await (0, repositories_1.insertLog)({
        historyId: historyId || null,
        level,
        message,
        context: sanitized,
    });
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logger(`[${level}] ${message}`, sanitized);
}
function fetchRecentLogs(limit = 50, historyId) {
    throw new Error('fetchRecentLogs must be awaited via fetchRecentLogsAsync.');
}
async function fetchRecentLogsAsync(limit = 50, historyId) {
    return (0, repositories_1.getRecentLogs)(limit, historyId);
}
