"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const siteAttendanceAccess_1 = require("./siteAttendanceAccess");
(0, node_test_1.default)('allows the configured site public IP', () => {
    strict_1.default.equal((0, siteAttendanceAccess_1.isAllowedAttendanceIp)('41.139.216.177', '41.139.216.177'), true);
});
(0, node_test_1.default)('normalizes IPv4-mapped addresses and rejects other networks', () => {
    strict_1.default.equal((0, siteAttendanceAccess_1.isAllowedAttendanceIp)('::ffff:41.139.216.177', '41.139.216.177'), true);
    strict_1.default.equal((0, siteAttendanceAccess_1.isAllowedAttendanceIp)('197.1.2.3', '41.139.216.177'), false);
});
