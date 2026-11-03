import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, queryOne } from '../models/db';
import { getContinuousBoardIntakeLogs } from '../models/repositories';
import { randomUUID } from 'crypto';

test('getContinuousBoardIntakeLogs retrieves logs ordered by date with effective_date and supports search', async () => {
  const id1 = 'test-log-pub-' + randomUUID();
  const id2 = 'test-log-pub-' + randomUUID();
  const id3 = 'test-log-pub-' + randomUUID();

  try {
    // Insert 3 test board logs across different dates
    await execute(
      `INSERT INTO board_intake_queue (id, product_id, product_name, partner_id, customer_name, quantity, arrival_date, arrival_time, vehicle_registration, is_purchase, status, created_at, actor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id1, 101, 'Red MDF 18mm', 201, 'Public Test Client Alpha', 4, '2026-11-02', '10:00', 'KDA 111A', 0, 'synced', '2026-11-02 10:05:00', 'Operator A']
    );

    await execute(
      `INSERT INTO board_intake_queue (id, product_id, product_name, partner_id, customer_name, quantity, arrival_date, arrival_time, vehicle_registration, is_purchase, status, created_at, actor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id2, 102, 'White MDF 18mm', 202, 'Public Test Client Beta', 6, '2026-11-03', '14:30', 'KDB 222B', 1, 'synced', '2026-11-03 14:35:00', 'Operator B']
    );

    await execute(
      `INSERT INTO board_intake_queue (id, product_id, product_name, partner_id, customer_name, quantity, arrival_date, arrival_time, vehicle_registration, is_purchase, status, created_at, actor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id3, 103, 'Black MDF 18mm', 201, 'Public Test Client Alpha', 2, '2026-11-03', '16:00', 'KDC 333C', 0, 'pending', '2026-11-03 16:02:00', 'Operator C']
    );

    // 1. Fetch continuous logs
    const allLogs = await getContinuousBoardIntakeLogs({ limit: 100 });
    const testLogs = allLogs.filter((l) => l.id === id1 || l.id === id2 || l.id === id3);

    assert.equal(testLogs.length, 3, 'Should retrieve all 3 test logs');
    assert.equal(testLogs[0].effective_date, '2026-11-03', 'Newer date (2026-11-03) must come first');
    assert.equal(testLogs[1].effective_date, '2026-11-03', 'Same date must follow');
    assert.equal(testLogs[2].effective_date, '2026-11-02', 'Older date (2026-11-02) must come after');

    // 2. Search filtering
    const searchAlpha = await getContinuousBoardIntakeLogs({ search: 'Client Alpha' });
    const matchedAlpha = searchAlpha.filter((l) => l.id === id1 || l.id === id2 || l.id === id3);
    assert.equal(matchedAlpha.length, 2, 'Should match only Client Alpha logs');
    assert.ok(matchedAlpha.every((l) => l.customer_name === 'Public Test Client Alpha'));

    // Search by vehicle
    const searchVehicle = await getContinuousBoardIntakeLogs({ search: 'KDB 222B' });
    const matchedVehicle = searchVehicle.filter((l) => l.id === id2);
    assert.equal(matchedVehicle.length, 1, 'Should find log by vehicle registration');
    assert.equal(matchedVehicle[0].customer_name, 'Public Test Client Beta');

  } finally {
    await execute('DELETE FROM board_intake_queue WHERE id IN (?, ?, ?)', [id1, id2, id3]);
  }
});
