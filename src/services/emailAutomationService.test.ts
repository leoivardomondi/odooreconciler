import test from 'node:test';
import assert from 'node:assert/strict';
import { isDue, nairobiNow } from './emailAutomationService';
import { EmailAutomation } from '../models/types';

test('emailAutomationService - 7:00 AM Wednesday Exclusivity & Deduplication Rules', async (t) => {
  // Wednesday Sep 9, 2026 at 07:05:00 Nairobi time (+03:00) -> 04:05:00 UTC
  const wednesday7am = new Date('2026-09-09T04:05:00.000Z');
  // Wednesday Sep 9, 2026 at 08:05:00 Nairobi time (+03:00) -> 05:05:00 UTC
  const wednesday8am = new Date('2026-09-09T05:05:00.000Z');
  // Thursday Sep 10, 2026 at 07:05:00 Nairobi time (+03:00) -> 04:05:00 UTC
  const thursday7am = new Date('2026-09-10T04:05:00.000Z');
  // Sunday Sep 13, 2026 at 10:00:00 Nairobi time (+03:00) -> 07:00:00 UTC
  const sunday10am = new Date('2026-09-13T07:00:00.000Z');

  const weeklyReportAutomation: EmailAutomation = {
    id: 'weekly-shop-floor-report',
    name: 'Weekly shop-floor accountability report',
    systemKey: 'weekly-shop-floor-report',
    enabled: true,
    frequency: 'weekly',
    interval: 1,
    dayOfWeek: 3,
    hour: 7,
    recipients: '',
    subject: '',
    body: '',
    lastSentAt: '2026-09-02T04:01:00.000Z', // 7 days ago
  };

  const hourlyRemindersAutomation: EmailAutomation = {
    id: 'shop-floor-reminders',
    name: 'Shop-floor task reminders',
    systemKey: 'shop-floor-reminders',
    enabled: true,
    frequency: 'hourly',
    interval: 1,
    dayOfWeek: 1,
    hour: 8,
    recipients: '',
    subject: '',
    body: '',
    lastSentAt: '2026-09-09T02:00:00.000Z', // 2 hours ago
  };

  const mpesaReviewAutomation: EmailAutomation = {
    id: 'mpesa-review',
    name: 'M-Pesa review pending',
    systemKey: 'mpesa-review',
    enabled: true,
    frequency: 'daily',
    interval: 1,
    dayOfWeek: 1,
    hour: 9,
    recipients: '',
    subject: '',
    body: '',
    lastSentAt: '2026-09-08T06:00:00.000Z',
  };

  const custom7amAutomation: EmailAutomation = {
    id: 'custom-daily',
    name: 'Custom Daily Alert',
    systemKey: 'custom',
    enabled: true,
    frequency: 'daily',
    interval: 1,
    dayOfWeek: 3,
    hour: 7,
    recipients: 'test@example.com',
    subject: 'Alert',
    body: 'Test',
    lastSentAt: '2026-09-08T04:00:00.000Z',
  };

  await t.test('verifies nairobiNow parsing at Wednesday 7:05 AM', () => {
    const parts = nairobiNow(wednesday7am);
    assert.equal(parts.dayOfWeek, 3); // Wednesday
    assert.equal(parts.hour, 7);
    assert.equal(parts.dateKey, '2026-09-09');
  });

  await t.test('weekly report is due at 7:00 AM on Wednesday when not yet sent today', () => {
    assert.equal(isDue(weeklyReportAutomation, wednesday7am), true);
  });

  await t.test('weekly report is NOT due if already sent today (deduplication)', () => {
    const alreadySentToday: EmailAutomation = {
      ...weeklyReportAutomation,
      lastSentAt: '2026-09-09T04:01:00.000Z', // Sent earlier this morning at 7:01 AM
    };
    assert.equal(isDue(alreadySentToday, wednesday7am), false);
  });

  await t.test('weekly report is NOT due on non-Wednesdays or outside 7:00 AM', () => {
    assert.equal(isDue(weeklyReportAutomation, wednesday8am), false);
    assert.equal(isDue(weeklyReportAutomation, thursday7am), false);
  });

  await t.test('NO other email is due at 7:00 AM on Wednesday (Exclusivity Rule)', () => {
    // Hourly reminders suppressed
    assert.equal(isDue(hourlyRemindersAutomation, wednesday7am), false);
    // Daily M-Pesa review suppressed
    assert.equal(isDue(mpesaReviewAutomation, wednesday7am), false);
    // Custom automation scheduled for 7:00 AM is suppressed on Wednesday
    assert.equal(isDue(custom7amAutomation, wednesday7am), false);
  });

  await t.test('hourly reminders are NOT due outside working hours (7:00 AM, Sunday, night)', () => {
    assert.equal(isDue(hourlyRemindersAutomation, thursday7am), false);
    assert.equal(isDue(hourlyRemindersAutomation, sunday10am), false);
  });

  await t.test('hourly reminders ARE due during regular working hours (e.g. 8:00 AM)', () => {
    assert.equal(isDue(hourlyRemindersAutomation, wednesday8am), true);
  });
});
