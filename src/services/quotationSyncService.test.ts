import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  isTemplateOnlyQuotation,
  compareQuotationLinesWithJobSummary,
} from './quotationSyncService';
import { parseJobSummaryPdf } from './pdfParser';
import { DEFAULT_PARSER_CONFIG } from '../utils/helpers';
import { ParsedJobSummaryResult, SaleOrderLine } from '../models/types';

test('isTemplateOnlyQuotation correctly identifies freshly created template-only quotation', () => {
  // Case 1: Standard quotation template (as shown in user screenshot)
  const templateLines: SaleOrderLine[] = [
    {
      id: 1,
      name: 'BOARDS',
      display_type: 'line_section',
    },
    {
      id: 2,
      name: 'Example Board 18mm',
      product_id: [101, 'Example Board 18mm'],
      product_uom_qty: 1,
      display_type: false,
    },
    {
      id: 3,
      name: 'CUTTING + EDGING + GROOVING',
      display_type: 'line_section',
    },
    {
      id: 4,
      name: 'Optimised Panels',
      product_id: [102, 'Optimised Panels'],
      product_uom_qty: 1,
      display_type: false,
    },
  ];

  assert.equal(isTemplateOnlyQuotation(templateLines), true);

  // Case 2: Empty quotation
  assert.equal(isTemplateOnlyQuotation([]), true);

  // Case 3: Quotation with custom board (already customized)
  const customBoardLines: SaleOrderLine[] = [
    ...templateLines,
    {
      id: 5,
      name: 'White MDF 18mm',
      product_id: [201, 'White MDF 18mm'],
      product_uom_qty: 3,
      display_type: false,
    },
  ];
  assert.equal(isTemplateOnlyQuotation(customBoardLines), false);

  // Case 4: Quotation with edge banding service (already customized)
  const customEdgingLines: SaleOrderLine[] = [
    {
      id: 1,
      name: 'Example Board 18mm',
      product_id: [101, 'Example Board 18mm'],
      product_uom_qty: 1,
      display_type: false,
    },
    {
      id: 2,
      name: 'Edge Banding Service White',
      product_id: [301, 'Edge Banding Service White'],
      product_uom_qty: 16,
      display_type: false,
    },
  ];
  assert.equal(isTemplateOnlyQuotation(customEdgingLines), false);
});

test('compareQuotationLinesWithJobSummary correctly flags shortfalls and verifies surpluses', () => {
  const parsedJobSummary: ParsedJobSummaryResult = {
    items: [
      {
        color: 'White',
        thickness_mm: 1,
        length_mm: 16200, // 16.2m -> 16m
        roll_length_mm: 15000,
      },
    ],
    sectionFound: true,
    sectionText: '',
    rawText: '',
    logs: [],
    clientName: 'NICKSON',
    optimizedSheets: 3,
    totalPanels: 3,
    sheetMaterials: [
      {
        name: 'WHITE MDF',
        thickness_mm: 18,
        sheets: 3,
        panels: 3,
        length_mm: 2440,
        width_mm: 1220,
      },
    ],
  };

  // Scenario A: Quotation lines have shortfalls (less than required)
  const shortfallLines: SaleOrderLine[] = [
    {
      id: 1,
      name: 'White MDF 18mm',
      product_id: [201, 'White MDF 18mm'],
      product_uom_qty: 1, // Shortfall: requires 3, only has 1
      display_type: false,
    },
    {
      id: 2,
      name: 'Optimised Panels',
      product_id: [102, 'Optimised Panels'],
      product_uom_qty: 1, // Shortfall: requires 3, only has 1
      display_type: false,
    },
    {
      id: 3,
      name: 'Edge Banding Service White',
      product_id: [301, 'Edge Banding Service White'],
      product_uom_qty: 10, // Shortfall: requires 16m, only has 10m
      display_type: false,
    },
  ];

  const resultShortfall = compareQuotationLinesWithJobSummary(shortfallLines, parsedJobSummary);
  assert.equal(resultShortfall.hasShortfall, true);
  assert.equal(resultShortfall.shortfalls.length, 3);
  assert.ok(resultShortfall.shortfalls[0].includes('WHITE MDF'));
  assert.ok(resultShortfall.shortfalls[1].includes('Optimised Panels'));
  assert.ok(resultShortfall.shortfalls[2].includes('Edge Banding Service'));

  // Scenario B: Exact match (equal quantities)
  const exactLines: SaleOrderLine[] = [
    {
      id: 1,
      name: 'White MDF 18mm',
      product_id: [201, 'White MDF 18mm'],
      product_uom_qty: 3,
      display_type: false,
    },
    {
      id: 2,
      name: 'Optimised Panels',
      product_id: [102, 'Optimised Panels'],
      product_uom_qty: 3,
      display_type: false,
    },
    {
      id: 3,
      name: 'Edge Banding Service White',
      product_id: [301, 'Edge Banding Service White'],
      product_uom_qty: 16,
      display_type: false,
    },
  ];

  const resultExact = compareQuotationLinesWithJobSummary(exactLines, parsedJobSummary);
  assert.equal(resultExact.hasShortfall, false);
  assert.equal(resultExact.shortfalls.length, 0);

  // Scenario C: Edge Banding Surplus (valid: "not less, but can be more" applies to edge banding)
  const edgingSurplusLines: SaleOrderLine[] = [
    {
      id: 1,
      name: 'White MDF 18mm',
      product_id: [201, 'White MDF 18mm'],
      product_uom_qty: 3, // Exactly matches 3
      display_type: false,
    },
    {
      id: 2,
      name: 'Optimised Panels',
      product_id: [102, 'Optimised Panels'],
      product_uom_qty: 3,
      display_type: false,
    },
    {
      id: 3,
      name: 'Edge Banding Service White',
      product_id: [301, 'Edge Banding Service White'],
      product_uom_qty: 25, // 25 >= 16: valid under "not less, but can be more"
      display_type: false,
    },
  ];

  const resultEdgingSurplus = compareQuotationLinesWithJobSummary(edgingSurplusLines, parsedJobSummary);
  assert.equal(resultEdgingSurplus.hasShortfall, false);
  assert.equal(resultEdgingSurplus.shortfalls.length, 0);

  // Scenario D: Board Surplus (mismatch: "not less, but can be more" does NOT apply to boards)
  const boardSurplusLines: SaleOrderLine[] = [
    {
      id: 1,
      name: 'White MDF 18mm',
      product_id: [201, 'White MDF 18mm'],
      product_uom_qty: 5, // 5 > 3: excess mismatch for boards!
      display_type: false,
    },
    {
      id: 2,
      name: 'Optimised Panels',
      product_id: [102, 'Optimised Panels'],
      product_uom_qty: 3,
      display_type: false,
    },
    {
      id: 3,
      name: 'Edge Banding Service White',
      product_id: [301, 'Edge Banding Service White'],
      product_uom_qty: 16,
      display_type: false,
    },
  ];

  const resultBoardSurplus = compareQuotationLinesWithJobSummary(boardSurplusLines, parsedJobSummary);
  assert.equal(resultBoardSurplus.hasShortfall, true);
  assert.equal(resultBoardSurplus.shortfalls.length, 1);
  assert.ok(resultBoardSurplus.shortfalls[0].includes('Excess: 2 sheet(s)'));
});

test('parseJobSummaryPdf extracts sheet materials and header metrics from user PDF', async () => {
  const samplePdfPath = 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/4bbdfaaa-f3d6-4738-b235-1c89d579bcb5/.user_uploaded/media_1792362774320.pdf';
  if (!fs.existsSync(samplePdfPath)) {
    return;
  }

  const buf = fs.readFileSync(samplePdfPath);
  const parsed = await parseJobSummaryPdf(buf, DEFAULT_PARSER_CONFIG as any);

  assert.equal(parsed.clientName, 'NICKSON');
  assert.equal(parsed.optimizedSheets, 3);
  assert.equal(parsed.totalPanels, 3);
  assert.ok(parsed.sheetMaterials && parsed.sheetMaterials.length >= 1);
  assert.equal(parsed.sheetMaterials![0].name, 'WHITE MDF');
  assert.equal(parsed.sheetMaterials![0].thickness_mm, 18);
  assert.equal(parsed.sheetMaterials![0].sheets, 3);
  assert.equal(parsed.sheetMaterials![0].panels, 3);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].color, 'White');
  assert.equal(parsed.items[0].length_mm, 16200);
});
