import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoggedQtysFromChatter, reconcileLoggedPurchaseOrderReceipts } from './boardIntakePoBatchReconciliationService';

describe('boardIntakePoBatchReconciliationService', () => {
  it('correctly parses and deduplicates chatter board intake logs', () => {
    const sampleMessages = [
      {
        body: '• Board: Black Waterproof 18mm • Quantity Received: 4 sheets',
        date: '2026-11-16 14:28:54',
      },
      // Immediate duplicate within 2 minutes
      {
        body: '• Board: Black Waterproof 18mm • Quantity Received: 4 sheets',
        date: '2026-11-16 14:29:10',
      },
      {
        body: '• Board: White Waterproof panel 18mm • Quantity Received: 3 sheets',
        date: '2026-11-16 14:40:06',
      },
      {
        body: '• Board: Backer White MDF 3mm • Quantity Received: 2 sheets',
        date: '2026-11-16 14:52:54',
      },
    ];

    const result = parseLoggedQtysFromChatter(sampleMessages);
    assert.equal(result['Black Waterproof 18mm'].max, 4);
    assert.equal(result['Black Waterproof 18mm'].sum, 4);
    assert.equal(result['White Waterproof panel 18mm'].max, 3);
    assert.equal(result['Backer White MDF 3mm'].max, 2);
  });

  it('correctly sums split offloading batches across different times', () => {
    const splitMessages = [
      {
        body: '• Board: White Particle 18mm • Quantity Received: 13 sheets',
        date: '2026-11-12 08:18:11',
      },
      {
        body: '• Board: White Particle 18mm • Quantity Received: 13 sheets',
        date: '2026-11-12 09:04:09',
      },
      {
        body: '• Board: White Particle 18mm • Quantity Received: 8 sheets',
        date: '2026-11-12 09:24:26',
      },
    ];

    const result = parseLoggedQtysFromChatter(splitMessages);
    assert.equal(result['White Particle 18mm'].sum, 34);
    assert.equal(result['White Particle 18mm'].max, 13);
  });

  it('evaluates fully logged POs as validate_full in dry run mode', async () => {
    const mockClient: any = {
      getTargetCompanyIdValue: async () => 1,
      searchReadRecords: async (model: string) => {
        if (model === 'mail.message') {
          return [
            { res_id: 1431, body: '• Board: Black Waterproof 18mm • Quantity Received: 4 sheets' },
            { res_id: 1431, body: '• Board: White Waterproof panel 18mm • Quantity Received: 3 sheets' },
            { res_id: 1431, body: '• Board: Backer White MDF 3mm • Quantity Received: 2 sheets' },
          ];
        }
        if (model === 'purchase.order') {
          return [{
            id: 1431,
            name: 'P01432',
            state: 'purchase',
            partner_id: [10, 'TIP TOP'],
            picking_ids: [4353],
          }];
        }
        if (model === 'stock.picking') {
          return [{
            id: 4353,
            name: 'WH/IN/00903',
            state: 'assigned',
          }];
        }
        if (model === 'purchase.order.line') {
          return [
            { id: 1, product_id: [269, 'Black Waterproof 18mm'], product_qty: 4, qty_received: 0 },
            { id: 2, product_id: [38, 'White Waterproof panel 18mm'], product_qty: 3, qty_received: 0 },
            { id: 3, product_id: [294, 'Backer White MDF 3mm'], product_qty: 2, qty_received: 0 },
          ];
        }
        if (model === 'stock.move') {
          return [
            { id: 101, product_id: [269, 'Black Waterproof 18mm'], product_uom_qty: 4, quantity: 0, state: 'confirmed' },
            { id: 102, product_id: [38, 'White Waterproof panel 18mm'], product_uom_qty: 3, quantity: 0, state: 'confirmed' },
            { id: 103, product_id: [294, 'Backer White MDF 3mm'], product_uom_qty: 2, quantity: 2, state: 'confirmed' },
          ];
        }
        return [];
      },
    };

    const report = await reconcileLoggedPurchaseOrderReceipts(mockClient, { dryRun: true, specificPoIds: [1431] });
    assert.equal(report.dryRun, true);
    assert.equal(report.targets.length, 1);
    assert.equal(report.targets[0].poName, 'P01432');
    assert.equal(report.targets[0].action, 'validate_full');
  });
});
