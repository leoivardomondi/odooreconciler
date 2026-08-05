import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSoLine, matchSoLines } from './stockProcessingService';

const marbleItem = {
  extractedColor: 'Marble',
  normalizedColor: 'marble',
  componentColor: 'marble',
  componentType: '1mm',
  lengthMm: 305767,
  expectedSoProduct: 'Edge Banding Service Marble',
  serviceNameCandidates: ['Edge Banding Service Marble', 'Edge Band Service Marble'],
};

test('uses the linked Marble product even when its edited description says White Marble', () => {
  const line = {
    id: 1,
    product_id: [10, 'Edge banding service Marble'] as [number, string],
    name: 'Edge banding service White Marble',
    product_uom_qty: 490,
  };

  assert.equal(matchSoLine(marbleItem, [line]), line);
});

test('matches Odoo product display names that include an internal reference', () => {
  const line = {
    id: 2,
    product_id: [11, '[EB-MARBLE] Edge Banding Service Marble'] as [number, string],
    name: 'White Marble is available on the floor',
    product_uom_qty: 490,
  };

  assert.equal(matchSoLine(marbleItem, [line]), line);
});

test('matches a valid product description on one line of a multiline note', () => {
  const line = {
    id: 3,
    product_id: false as const,
    name: 'Edge Banding Service Marble\nUse White Marble on the floor',
    product_uom_qty: 490,
  };

  assert.equal(matchSoLine(marbleItem, [line]), line);
});

test('does not treat White Marble alone as an exact Marble match', () => {
  const line = {
    id: 4,
    product_id: [12, 'Edge Banding Service White Marble'] as [number, string],
    name: 'Edge Banding Service White Marble',
    product_uom_qty: 490,
  };

  assert.equal(matchSoLine(marbleItem, [line]), null);
});

test('uses a close color match when the remaining material and line counts agree', () => {
  const line = {
    id: 5,
    product_id: [13, 'Edge Banding Service White Marble'] as [number, string],
    name: 'Edge Banding Service White Marble',
    product_uom_qty: 490,
  };

  assert.equal(matchSoLines([marbleItem], [line]).get(marbleItem), line);
});

test('does not use fuzzy matching when material and edging-line counts differ', () => {
  const white = {
    id: 6,
    product_id: [14, 'Edge Banding Service White Marble'] as [number, string],
    name: 'Edge Banding Service White Marble',
  };
  const black = {
    id: 7,
    product_id: [15, 'Edge Banding Service Black Marble'] as [number, string],
    name: 'Edge Banding Service Black Marble',
  };

  assert.equal(matchSoLines([marbleItem], [white, black]).has(marbleItem), false);
});

test('leaves equally close colors unmatched instead of guessing', () => {
  const marbleA = { ...marbleItem };
  const marbleB = { ...marbleItem, extractedColor: 'Marble alt' };
  const white = {
    id: 8,
    product_id: [16, 'Edge Banding Service White Marble'] as [number, string],
    name: 'Edge Banding Service White Marble',
  };
  const black = {
    id: 9,
    product_id: [17, 'Edge Banding Service Black Marble'] as [number, string],
    name: 'Edge Banding Service Black Marble',
  };
  const result = matchSoLines([marbleA, marbleB], [white, black]);

  assert.equal(result.size, 0);
});
