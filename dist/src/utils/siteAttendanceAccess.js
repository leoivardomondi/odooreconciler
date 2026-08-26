"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeIpAddress = normalizeIpAddress;
exports.isAllowedAttendanceIp = isAllowedAttendanceIp;
function normalizeIpAddress(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}
function isAllowedAttendanceIp(ipAddress, allowedIps) {
    const ip = normalizeIpAddress(ipAddress);
    return allowedIps
        .split(',')
        .map(normalizeIpAddress)
        .filter(Boolean)
        .includes(ip);
}
