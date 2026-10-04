import test from 'node:test';
import assert from 'node:assert/strict';
import { isStockExemptEdgeBandingService, isBoardProductName } from './boardProductClassifier';
import { MoMissingComponent, MoStockAvailabilityResult } from '../models/types';

test('isStockExemptEdgeBandingService correctly identifies service products', () => {
  assert.equal(isStockExemptEdgeBandingService('Edge Banding Service'), true);
  assert.equal(isStockExemptEdgeBandingService('edging banding service 1mm'), true);
  assert.equal(isStockExemptEdgeBandingService('Custom Edge Banding Services'), true);
  assert.equal(isStockExemptEdgeBandingService('18mm MDF White Board'), false);
  assert.equal(isStockExemptEdgeBandingService('Soft Close Hinge 35mm'), false);
  assert.equal(isStockExemptEdgeBandingService(null), false);
  assert.equal(isStockExemptEdgeBandingService(undefined), false);
});

test('MoStockAvailabilityResult correctly distinguishes boards from hardware and flags missing components', () => {
  const components: MoMissingComponent[] = [
    {
      id: 101,
      productId: 501,
      productName: '18mm Marine Plywood 8x4',
      requiredQty: 4,
      availableQty: 1,
      missingQty: 3,
      uom: 'Units',
      state: 'partially_available',
      isBoard: isBoardProductName('18mm Marine Plywood 8x4'),
    },
    {
      id: 102,
      productId: 502,
      productName: 'Soft Close Drawer Runner 450mm',
      requiredQty: 6,
      availableQty: 0,
      missingQty: 6,
      uom: 'Pairs',
      state: 'confirmed',
      isBoard: isBoardProductName('Soft Close Drawer Runner 450mm'),
    },
  ];

  assert.equal(components[0].isBoard, true, 'Marine Plywood should be identified as a board');
  assert.equal(components[1].isBoard, false, 'Drawer runner should be identified as hardware');

  const result: MoStockAvailabilityResult = {
    moId: 999,
    moName: 'WH/MO/00999',
    moState: 'confirmed',
    isFullyAvailable: components.length === 0,
    totalComponents: components.length,
    missingComponents: components,
    hasMissingBoards: components.some((c) => c.isBoard),
    hasMissingHardware: components.some((c) => !c.isBoard),
  };

  assert.equal(result.isFullyAvailable, false, 'MO with missing components should NOT be fully available');
  assert.equal(result.hasMissingBoards, true, 'Should detect missing boards');
  assert.equal(result.hasMissingHardware, true, 'Should detect missing hardware');
  assert.equal(result.missingComponents[0].missingQty, 3);
  assert.equal(result.missingComponents[1].missingQty, 6);
});

test('MoStockAvailabilityResult flags MO as fully available when no components are missing', () => {
  const result: MoStockAvailabilityResult = {
    moId: 1000,
    moName: 'WH/MO/01000',
    moState: 'confirmed',
    isFullyAvailable: true,
    totalComponents: 3,
    missingComponents: [],
    hasMissingBoards: false,
    hasMissingHardware: false,
  };

  assert.equal(result.isFullyAvailable, true);
  assert.equal(result.missingComponents.length, 0);
  assert.equal(result.hasMissingBoards, false);
  assert.equal(result.hasMissingHardware, false);
});
