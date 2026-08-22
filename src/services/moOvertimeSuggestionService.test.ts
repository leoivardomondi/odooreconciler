import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligiblePurchaseOrderState } from './moOvertimeSuggestionService';

test('only confirmed purchase orders awaiting approval or approved qualify', () => {
  assert.equal(isEligiblePurchaseOrderState('to approve'), true);
  assert.equal(isEligiblePurchaseOrderState('purchase'), true);
  assert.equal(isEligiblePurchaseOrderState('draft'), false);
  assert.equal(isEligiblePurchaseOrderState('sent'), false);
  assert.equal(isEligiblePurchaseOrderState(null), false);
});
