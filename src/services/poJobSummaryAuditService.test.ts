import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSoNameFromOrigin,
  comparePoLinesWithSheetMaterials,
} from './poJobSummaryAuditService';
import { ParsedSheetMaterial, PurchaseOrderLine } from '../models/types';

test('extractSoNameFromOrigin correctly extracts Sales Order name from various PO origin patterns', () => {
  assert.equal(extractSoNameFromOrigin('S02182'), 'S02182');
  assert.equal(extractSoNameFromOrigin('s02182'), 'S02182');
  assert.equal(extractSoNameFromOrigin('S02182:WH/MO/05412'), 'S02182');
  assert.equal(extractSoNameFromOrigin('SO1005'), 'SO1005');
  assert.equal(extractSoNameFromOrigin('Customer order S01999 for kitchen'), 'S01999');
  assert.equal(extractSoNameFromOrigin('WH/MO/05412'), null);
  assert.equal(extractSoNameFromOrigin(''), null);
  assert.equal(extractSoNameFromOrigin(null), null);
});

test('comparePoLinesWithSheetMaterials detects shortfalls when PO ordered less than Job Summary', () => {
  const sheetMaterials: ParsedSheetMaterial[] = [
    {
      name: 'WHITE MDF',
      thickness_mm: 18,
      sheets: 3,
      panels: 3,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];

  // Case A: PO has only 2 sheets (shortfall)
  const poLinesShortfall: PurchaseOrderLine[] = [
    {
      id: 1,
      name: 'WHITE MDF 18mm',
      product_id: [101, 'WHITE MDF 18mm'],
      product_qty: 2,
    },
  ];

  const resultShortfall = comparePoLinesWithSheetMaterials(poLinesShortfall, sheetMaterials);
  assert.equal(resultShortfall.hasShortfall, true);
  assert.equal(resultShortfall.shortfalls.length, 1);
  assert.ok(resultShortfall.shortfalls[0].includes('PO ordered 2 sheet(s)'));
  assert.ok(resultShortfall.shortfalls[0].includes('Job Summary requires 3 sheet(s)'));

  // Case B: PO has exactly 3 sheets (match)
  const poLinesMatch: PurchaseOrderLine[] = [
    {
      id: 1,
      name: 'WHITE MDF 18mm',
      product_id: [101, 'WHITE MDF 18mm'],
      product_qty: 3,
    },
  ];

  const resultMatch = comparePoLinesWithSheetMaterials(poLinesMatch, sheetMaterials);
  assert.equal(resultMatch.hasShortfall, false);
  assert.equal(resultMatch.shortfalls.length, 0);
  assert.equal(resultMatch.verified.length, 1);

  // Case C: PO has 5 sheets for boards (mismatch: "not less, but can be more" does NOT apply to boards)
  const poLinesSurplus: PurchaseOrderLine[] = [
    {
      id: 1,
      name: 'WHITE MDF 18mm',
      product_id: [101, 'WHITE MDF 18mm'],
      product_qty: 5,
    },
  ];

  const resultSurplus = comparePoLinesWithSheetMaterials(poLinesSurplus, sheetMaterials);
  assert.equal(resultSurplus.hasShortfall, true);
  assert.equal(resultSurplus.shortfalls.length, 1);
  assert.ok(resultSurplus.shortfalls[0].includes('Excess: 2 sheet(s)'));
});

test('comparePoLinesWithSheetMaterials handles multiple board materials correctly', () => {
  const sheetMaterials: ParsedSheetMaterial[] = [
    {
      name: 'WHITE MDF',
      thickness_mm: 18,
      sheets: 3,
      panels: 3,
      length_mm: 2440,
      width_mm: 1220,
    },
    {
      name: 'SUEZ OAK',
      thickness_mm: 18,
      sheets: 22,
      panels: 82,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];

  const poLines: PurchaseOrderLine[] = [
    {
      id: 1,
      name: 'WHITE MDF 18mm',
      product_id: [101, 'WHITE MDF 18mm'],
      product_qty: 3, // Sufficient
    },
    {
      id: 2,
      name: 'SUEZ OAK 18mm',
      product_id: [102, 'SUEZ OAK 18mm'],
      product_qty: 15, // Shortfall (requires 22, only 15)
    },
  ];

  const result = comparePoLinesWithSheetMaterials(poLines, sheetMaterials);
  assert.equal(result.hasShortfall, true);
  assert.equal(result.shortfalls.length, 1);
  assert.ok(result.shortfalls[0].includes('SUEZ OAK'));
  assert.ok(result.shortfalls[0].includes('Shortfall: 7 sheet(s)'));
  assert.equal(result.verified.length, 1);
  assert.ok(result.verified[0].includes('WHITE MDF'));
});

test('comparePoLinesWithSheetMaterials allows edge banding surplus but flags board surplus', () => {
  const sheetMaterials: ParsedSheetMaterial[] = [
    {
      name: 'WHITE MDF',
      thickness_mm: 18,
      sheets: 4,
      panels: 10,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];

  const edgingItems = [
    {
      color: 'White',
      thickness_mm: 1,
      length_mm: 35000, // 35m
    },
  ];

  // PO has exact board match (4 sheets) and surplus edge banding (50m >= 35m) -> MATCH!
  const poLinesMatch: PurchaseOrderLine[] = [
    {
      id: 1,
      name: 'WHITE MDF 18mm',
      product_id: [101, 'WHITE MDF 18mm'],
      product_qty: 4,
    },
    {
      id: 2,
      name: 'Edge Banding White 1mm',
      product_id: [201, 'Edge Banding White 1mm'],
      product_qty: 50, // 50m >= 35m: valid under "not less, but can be more"
    },
  ];

  const resMatch = comparePoLinesWithSheetMaterials(poLinesMatch, sheetMaterials, edgingItems as any);
  assert.equal(resMatch.hasShortfall, false);
  assert.equal(resMatch.shortfalls.length, 0);
  assert.equal(resMatch.verified.length, 2);

  // PO has edge banding shortfall (20m < 35m) -> MISMATCH!
  const poLinesEdgingShortfall: PurchaseOrderLine[] = [
    {
      id: 1,
      name: 'WHITE MDF 18mm',
      product_id: [101, 'WHITE MDF 18mm'],
      product_qty: 4,
    },
    {
      id: 2,
      name: 'Edge Banding White 1mm',
      product_id: [201, 'Edge Banding White 1mm'],
      product_qty: 20, // 20m < 35m: shortfall!
    },
  ];

  const resShortfall = comparePoLinesWithSheetMaterials(poLinesEdgingShortfall, sheetMaterials, edgingItems as any);
  assert.equal(resShortfall.hasShortfall, true);
  assert.equal(resShortfall.shortfalls.length, 1);
  assert.ok(resShortfall.shortfalls[0].includes('Short by 15m'));
});

