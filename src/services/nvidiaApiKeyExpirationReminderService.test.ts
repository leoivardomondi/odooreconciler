import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDaysRemaining,
  NVIDIA_KEY_EXPIRATION_ISO,
  NVIDIA_KEY_NAME,
} from './nvidiaApiKeyExpirationReminderService';

test('calculateDaysRemaining accurately counts days until 2027-04-28', () => {
  // Exactly on 2027-03-29 (30 days before April 28, 2027)
  const date30dBefore = new Date('2027-03-29T00:00:00+03:00');
  const days30 = calculateDaysRemaining(NVIDIA_KEY_EXPIRATION_ISO, date30dBefore);
  assert.equal(days30, 30);

  // Exactly on 2027-04-21 (7 days before April 28, 2027)
  const date7dBefore = new Date('2027-04-21T00:00:00+03:00');
  const days7 = calculateDaysRemaining(NVIDIA_KEY_EXPIRATION_ISO, date7dBefore);
  assert.equal(days7, 7);

  // Exactly on 2027-04-27 (1 day before April 28, 2027)
  const date1dBefore = new Date('2027-04-27T00:00:00+03:00');
  const days1 = calculateDaysRemaining(NVIDIA_KEY_EXPIRATION_ISO, date1dBefore);
  assert.equal(days1, 1);
});

test('NVIDIA key constants are properly configured', () => {
  assert.equal(NVIDIA_KEY_NAME, 'NVIDIABuild-Autogen-19');
  assert.match(NVIDIA_KEY_EXPIRATION_ISO, /^2027-04-28/);
});
