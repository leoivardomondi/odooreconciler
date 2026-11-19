import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOperatorMasteryScores, renderOperatorProfilePdf, type OperatorProfileMetrics } from './operatorProfileReportService';

test('computeOperatorMasteryScores classifies Master vs Needs Coaching tiers accurately', () => {
  const master = computeOperatorMasteryScores({
    sessionsCount: 10,
    workOrdersWorkedCount: 6,
    workOrdersCompletedCount: 6,
    totalProductionHours: 14,
    openTimersCount: 0,
    workcenterCount: 2,
    totalLogs: 6,
    syncedLogs: 6,
    revertedLogs: 0,
    clientMatchedLogs: 6,
    matchedClientActions: 2,
    completeMetadataLogs: 6,
    attendanceRate: 100,
  });

  assert.equal(master.timerDisciplineRate, 100);
  assert.equal(master.shopFloorMasteryScore, 100);
  assert.equal(master.boardLogMasteryScore, 100);
  assert.equal(master.overallMasteryScore, 100);
  assert.equal(master.masteryTier, 'Master');

  const needsCoaching = computeOperatorMasteryScores({
    sessionsCount: 0,
    workOrdersWorkedCount: 0,
    workOrdersCompletedCount: 0,
    totalProductionHours: 0,
    openTimersCount: 0,
    workcenterCount: 0,
    totalLogs: 1,
    syncedLogs: 0,
    revertedLogs: 1,
    clientMatchedLogs: 0,
    matchedClientActions: 0,
    completeMetadataLogs: 0,
    attendanceRate: 50,
  });

  assert.equal(needsCoaching.shopFloorMasteryScore, 0);
  assert.ok(needsCoaching.overallMasteryScore < 50);
  assert.equal(needsCoaching.masteryTier, 'Needs Coaching');
});

test('renderOperatorProfilePdf generates a valid PDF buffer and filename', async () => {
  const sampleProfile: OperatorProfileMetrics = {
    operator: { id: 6, name: 'Onyango Bitcher Akulo', jobTitle: 'Senior Operator', workEmail: 'onyangoakulo@gmail.com' },
    period: { start: '2026-11-12', end: '2026-11-18', expectedWorkdays: 6 },
    shopFloor: {
      sessionsCount: 8,
      workOrdersWorkedCount: 5,
      workOrdersCompletedCount: 4,
      totalProductionHours: 11.5,
      openTimersCount: 0,
      timerDisciplineRate: 100,
      workcenters: [
        { workcenterName: 'Table Saw Area', sessions: 5, hours: 7.5 },
        { workcenterName: 'Edge Banding Area', sessions: 3, hours: 4.0 },
      ],
      masteryScore: 89,
    },
    boardLog: {
      totalLogs: 5,
      totalSheets: 28,
      syncedLogs: 5,
      revertedLogs: 0,
      failedLogs: 0,
      clientMatchedLogs: 5,
      matchedClientActions: 1,
      completeMetadataLogs: 4,
      accuracyRate: 100,
      clientMatchRate: 100,
      metadataCompletenessRate: 80,
      masteryScore: 92,
      recentLogs: [
        { date: '2026-11-18', productName: '2700 * 1800 Particle 18mm', customerName: 'ABONGO', quantity: 5, status: 'synced' },
      ],
    },
    attendance: { daysAttended: 6, expectedWorkdays: 6, attendanceRate: 100, checkoutIntegrityRate: 100, overtimeHours: 1.5 },
    overallMasteryScore: 92,
    masteryTier: 'Master',
    strengths: ['Strong Shop Floor timer discipline (100%).'],
    recommendations: ['Maintain current Shop Floor and Board Log workflow standards.'],
  };

  const { pdf, filename } = await renderOperatorProfilePdf(sampleProfile);
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 1000, 'PDF buffer should contain rendered content');
  assert.equal(pdf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.equal(filename, 'operator-profile-onyango-bitcher-akulo-2026-11-12-to-2026-11-18.pdf');
});
