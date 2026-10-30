"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const nvidiaApiKeyExpirationReminderService_1 = require("./nvidiaApiKeyExpirationReminderService");
(0, node_test_1.default)('calculateDaysRemaining accurately counts days until 2027-04-28', () => {
    // Exactly on 2027-03-29 (30 days before April 28, 2027)
    const date30dBefore = new Date('2027-03-29T00:00:00+03:00');
    const days30 = (0, nvidiaApiKeyExpirationReminderService_1.calculateDaysRemaining)(nvidiaApiKeyExpirationReminderService_1.NVIDIA_KEY_EXPIRATION_ISO, date30dBefore);
    strict_1.default.equal(days30, 30);
    // Exactly on 2027-04-21 (7 days before April 28, 2027)
    const date7dBefore = new Date('2027-04-21T00:00:00+03:00');
    const days7 = (0, nvidiaApiKeyExpirationReminderService_1.calculateDaysRemaining)(nvidiaApiKeyExpirationReminderService_1.NVIDIA_KEY_EXPIRATION_ISO, date7dBefore);
    strict_1.default.equal(days7, 7);
    // Exactly on 2027-04-27 (1 day before April 28, 2027)
    const date1dBefore = new Date('2027-04-27T00:00:00+03:00');
    const days1 = (0, nvidiaApiKeyExpirationReminderService_1.calculateDaysRemaining)(nvidiaApiKeyExpirationReminderService_1.NVIDIA_KEY_EXPIRATION_ISO, date1dBefore);
    strict_1.default.equal(days1, 1);
});
(0, node_test_1.default)('NVIDIA key constants are properly configured', () => {
    strict_1.default.equal(nvidiaApiKeyExpirationReminderService_1.NVIDIA_KEY_NAME, 'NVIDIABuild-Autogen-19');
    strict_1.default.match(nvidiaApiKeyExpirationReminderService_1.NVIDIA_KEY_EXPIRATION_ISO, /^2027-04-28/);
});
