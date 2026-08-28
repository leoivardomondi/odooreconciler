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

test('ignores Google Gemini Vision OCR HTTP 429 rate limit and quota exceeded failures', () => {
  const signals = extractAiCredentialFailureSignals([
    'Google Gemini Vision OCR page failed (HTTP 429): You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.5-flash Please retry in 22.945445048s.',
    'Google Gemini Vision OCR page 1 failed (HTTP 429): Rate limit exceeded. Please retry in 10s.',
  ]);
  assert.equal(signals.length, 0);
});

