import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueShopFloorValidationJob,
  claimNextShopFloorValidationJob,
  completeShopFloorValidationJob,
  getActiveShopFloorValidationJobs,
  getShopFloorValidationJobById,
} from './repositories';
import { execute } from './db';

test('shop_floor_validation_jobs lifecycle: idempotency, strict FIFO claim, and completion', async () => {
  const picking1 = 88001;
  const picking2 = 88002;
  const picking3 = 88003;

  // Clean up any test records
  await execute('DELETE FROM shop_floor_validation_jobs WHERE picking_id IN (?, ?, ?)', [picking1, picking2, picking3]);

  // 1. Enqueue Job 1
  const job1 = await enqueueShopFloorValidationJob({
    jobType: 'receipt',
    pickingId: picking1,
    actorEmail: 'operator1@example.com',
    actorName: 'Operator One',
  });
  assert.equal(job1.pickingId, picking1);
  assert.equal(job1.status, 'pending');

  // 2. Idempotency test: Enqueueing picking1 again returns the existing pending job
  const job1Duplicate = await enqueueShopFloorValidationJob({
    jobType: 'receipt',
    pickingId: picking1,
    actorEmail: 'operator1@example.com',
    actorName: 'Operator One',
  });
  assert.equal(job1Duplicate.id, job1.id, 'Duplicate enqueue for same picking should return existing job');

  // 3. Enqueue Job 2 and Job 3 with monotonic timestamps
  await new Promise((r) => setTimeout(r, 15));
  const job2 = await enqueueShopFloorValidationJob({
    jobType: 'receipt',
    pickingId: picking2,
    actorEmail: 'operator2@example.com',
    actorName: 'Operator Two',
  });

  await new Promise((r) => setTimeout(r, 15));
  const job3 = await enqueueShopFloorValidationJob({
    jobType: 'receipt',
    pickingId: picking3,
    actorEmail: 'operator3@example.com',
    actorName: 'Operator Three',
  });

  // Verify active jobs count
  const activeJobs = await getActiveShopFloorValidationJobs('receipt');
  const activeIds = activeJobs.map(j => j.id);
  assert.ok(activeIds.includes(job1.id));
  assert.ok(activeIds.includes(job2.id));
  assert.ok(activeIds.includes(job3.id));

  // 4. Strict FIFO Claim: First claim MUST be Job 1
  const claimed1 = await claimNextShopFloorValidationJob();
  assert.ok(claimed1, 'First job should be claimed');
  assert.equal(claimed1.id, job1.id, 'FIFO: Job 1 must be claimed first');
  assert.equal(claimed1.status, 'running');
  assert.ok(claimed1.startedAt, 'startedAt should be set');

  // 5. Strict FIFO Claim: Second claim MUST be Job 2
  const claimed2 = await claimNextShopFloorValidationJob();
  assert.ok(claimed2, 'Second job should be claimed');
  assert.equal(claimed2.id, job2.id, 'FIFO: Job 2 must be claimed second');
  assert.equal(claimed2.status, 'running');

  // 6. Complete Job 1
  await completeShopFloorValidationJob({ id: job1.id, status: 'completed' });
  const completed1 = await getShopFloorValidationJobById(job1.id);
  assert.equal(completed1.status, 'completed');
  assert.ok(completed1.completedAt);

  // 7. Complete Job 2 with failure message
  await completeShopFloorValidationJob({ id: job2.id, status: 'failed', errorMessage: 'Odoo timeout test' });
  const failed2 = await getShopFloorValidationJobById(job2.id);
  assert.equal(failed2.status, 'failed');
  assert.equal(failed2.errorMessage, 'Odoo timeout test');

  // 8. Strict FIFO Claim: Third claim MUST be Job 3
  const claimed3 = await claimNextShopFloorValidationJob();
  assert.ok(claimed3);
  assert.equal(claimed3.id, job3.id, 'FIFO: Job 3 must be claimed third');
  await completeShopFloorValidationJob({ id: job3.id, status: 'completed' });

  // Clean up
  await execute('DELETE FROM shop_floor_validation_jobs WHERE picking_id IN (?, ?, ?)', [picking1, picking2, picking3]);
});
