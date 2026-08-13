import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAiCredentialFailureSignals } from './aiCredentialFailureNotificationService';

test('detects invalid API key failures', () => {
  const signals = extractAiCredentialFailureSignals([
    'Google Gemini Vision OCR page 1 failed (HTTP 400): API key not valid. Please pass a valid API key.',
  ]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, 'invalid_api_key');
  assert.equal(signals[0].provider, 'gemini');
});

test('detects OAuth connection failures but ignores model demand failures', () => {
  const signals = extractAiCredentialFailureSignals([
    'Google Gemini OAuth refresh failed: invalid_grant. Reconnect Google Gemini.',
    'AI provider "gemini" (gemini-flash-latest) failed: This model is currently experiencing high demand.',
  ]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, 'oauth_connection');
});
