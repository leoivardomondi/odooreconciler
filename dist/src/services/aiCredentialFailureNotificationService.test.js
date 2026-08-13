"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const aiCredentialFailureNotificationService_1 = require("./aiCredentialFailureNotificationService");
(0, node_test_1.default)('detects invalid API key failures', () => {
    const signals = (0, aiCredentialFailureNotificationService_1.extractAiCredentialFailureSignals)([
        'Google Gemini Vision OCR page 1 failed (HTTP 400): API key not valid. Please pass a valid API key.',
    ]);
    strict_1.default.equal(signals.length, 1);
    strict_1.default.equal(signals[0].kind, 'invalid_api_key');
    strict_1.default.equal(signals[0].provider, 'gemini');
});
(0, node_test_1.default)('detects OAuth connection failures but ignores model demand failures', () => {
    const signals = (0, aiCredentialFailureNotificationService_1.extractAiCredentialFailureSignals)([
        'Google Gemini OAuth refresh failed: invalid_grant. Reconnect Google Gemini.',
        'AI provider "gemini" (gemini-flash-latest) failed: This model is currently experiencing high demand.',
    ]);
    strict_1.default.equal(signals.length, 1);
    strict_1.default.equal(signals[0].kind, 'oauth_connection');
});
