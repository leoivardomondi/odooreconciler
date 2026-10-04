"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const repositories_1 = require("./repositories");
const db_1 = require("./db");
(0, node_test_1.default)('shop_floor_validation_jobs lifecycle: idempotency, strict FIFO claim, and completion', async () => {
    const picking1 = 88001;
    const picking2 = 88002;
    const picking3 = 88003;
    // Clean up any test records
    await (0, db_1.execute)('DELETE FROM shop_floor_validation_jobs WHERE picking_id IN (?, ?, ?)', [picking1, picking2, picking3]);
    // 1. Enqueue Job 1
    const job1 = await (0, repositories_1.enqueueShopFloorValidationJob)({
        jobType: 'receipt',
        pickingId: picking1,
        actorEmail: 'operator1@example.com',
        actorName: 'Operator One',
    });
    strict_1.default.equal(job1.pickingId, picking1);
    strict_1.default.equal(job1.status, 'pending');
    // 2. Idempotency test: Enqueueing picking1 again returns the existing pending job
    const job1Duplicate = await (0, repositories_1.enqueueShopFloorValidationJob)({
        jobType: 'receipt',
        pickingId: picking1,
        actorEmail: 'operator1@example.com',
        actorName: 'Operator One',
    });
    strict_1.default.equal(job1Duplicate.id, job1.id, 'Duplicate enqueue for same picking should return existing job');
    // 3. Enqueue Job 2 and Job 3 with monotonic timestamps
    await new Promise((r) => setTimeout(r, 15));
    const job2 = await (0, repositories_1.enqueueShopFloorValidationJob)({
        jobType: 'receipt',
        pickingId: picking2,
        actorEmail: 'operator2@example.com',
        actorName: 'Operator Two',
    });
    await new Promise((r) => setTimeout(r, 15));
    const job3 = await (0, repositories_1.enqueueShopFloorValidationJob)({
        jobType: 'receipt',
        pickingId: picking3,
        actorEmail: 'operator3@example.com',
        actorName: 'Operator Three',
    });
    // Verify active jobs count
    const activeJobs = await (0, repositories_1.getActiveShopFloorValidationJobs)('receipt');
    const activeIds = activeJobs.map(j => j.id);
    strict_1.default.ok(activeIds.includes(job1.id));
    strict_1.default.ok(activeIds.includes(job2.id));
    strict_1.default.ok(activeIds.includes(job3.id));
    // 4. Strict FIFO Claim: First claim MUST be Job 1
    const claimed1 = await (0, repositories_1.claimNextShopFloorValidationJob)();
    strict_1.default.ok(claimed1, 'First job should be claimed');
    strict_1.default.equal(claimed1.id, job1.id, 'FIFO: Job 1 must be claimed first');
    strict_1.default.equal(claimed1.status, 'running');
    strict_1.default.ok(claimed1.startedAt, 'startedAt should be set');
    // 5. Strict FIFO Claim: Second claim MUST be Job 2
    const claimed2 = await (0, repositories_1.claimNextShopFloorValidationJob)();
    strict_1.default.ok(claimed2, 'Second job should be claimed');
    strict_1.default.equal(claimed2.id, job2.id, 'FIFO: Job 2 must be claimed second');
    strict_1.default.equal(claimed2.status, 'running');
    // 6. Complete Job 1
    await (0, repositories_1.completeShopFloorValidationJob)({ id: job1.id, status: 'completed' });
    const completed1 = await (0, repositories_1.getShopFloorValidationJobById)(job1.id);
    strict_1.default.equal(completed1.status, 'completed');
    strict_1.default.ok(completed1.completedAt);
    // 7. Complete Job 2 with failure message
    await (0, repositories_1.completeShopFloorValidationJob)({ id: job2.id, status: 'failed', errorMessage: 'Odoo timeout test' });
    const failed2 = await (0, repositories_1.getShopFloorValidationJobById)(job2.id);
    strict_1.default.equal(failed2.status, 'failed');
    strict_1.default.equal(failed2.errorMessage, 'Odoo timeout test');
    // 8. Strict FIFO Claim: Third claim MUST be Job 3
    const claimed3 = await (0, repositories_1.claimNextShopFloorValidationJob)();
    strict_1.default.ok(claimed3);
    strict_1.default.equal(claimed3.id, job3.id, 'FIFO: Job 3 must be claimed third');
    await (0, repositories_1.completeShopFloorValidationJob)({ id: job3.id, status: 'completed' });
    // Clean up
    await (0, db_1.execute)('DELETE FROM shop_floor_validation_jobs WHERE picking_id IN (?, ?, ?)', [picking1, picking2, picking3]);
});
