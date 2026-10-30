"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fs_1 = __importDefault(require("fs"));
const quotationSyncService_1 = require("./quotationSyncService");
const pdfParser_1 = require("./pdfParser");
const helpers_1 = require("../utils/helpers");
(0, node_test_1.default)('isTemplateOnlyQuotation correctly identifies freshly created template-only quotation', () => {
    // Case 1: Standard quotation template (as shown in user screenshot)
    const templateLines = [
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
    strict_1.default.equal((0, quotationSyncService_1.isTemplateOnlyQuotation)(templateLines), true);
    // Case 2: Empty quotation
    strict_1.default.equal((0, quotationSyncService_1.isTemplateOnlyQuotation)([]), true);
    // Case 3: Quotation with custom board (already customized)
    const customBoardLines = [
        ...templateLines,
        {
            id: 5,
            name: 'White MDF 18mm',
            product_id: [201, 'White MDF 18mm'],
            product_uom_qty: 3,
            display_type: false,
        },
    ];
    strict_1.default.equal((0, quotationSyncService_1.isTemplateOnlyQuotation)(customBoardLines), false);
    // Case 4: Quotation with edge banding service (already customized)
    const customEdgingLines = [
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
    strict_1.default.equal((0, quotationSyncService_1.isTemplateOnlyQuotation)(customEdgingLines), false);
});
(0, node_test_1.default)('compareQuotationLinesWithJobSummary correctly flags shortfalls and verifies surpluses', () => {
    const parsedJobSummary = {
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
    const shortfallLines = [
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
    const resultShortfall = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(shortfallLines, parsedJobSummary);
    strict_1.default.equal(resultShortfall.hasShortfall, true);
    strict_1.default.equal(resultShortfall.shortfalls.length, 3);
    strict_1.default.ok(resultShortfall.shortfalls[0].includes('WHITE MDF'));
    strict_1.default.ok(resultShortfall.shortfalls[1].includes('Optimised Panels'));
    strict_1.default.ok(resultShortfall.shortfalls[2].includes('Edge Banding Service'));
    // Scenario B: Exact match (equal quantities)
    const exactLines = [
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
    const resultExact = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(exactLines, parsedJobSummary);
    strict_1.default.equal(resultExact.hasShortfall, false);
    strict_1.default.equal(resultExact.shortfalls.length, 0);
    // Scenario C: Edge Banding Surplus (valid: "not less, but can be more" applies to edge banding)
    const edgingSurplusLines = [
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
    const resultEdgingSurplus = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(edgingSurplusLines, parsedJobSummary);
    strict_1.default.equal(resultEdgingSurplus.hasShortfall, false);
    strict_1.default.equal(resultEdgingSurplus.shortfalls.length, 0);
    // Scenario D: Board Surplus (sufficient: only lower quantity is flagged in ATTENTION)
    const boardSurplusLines = [
        {
            id: 1,
            name: 'White MDF 18mm',
            product_id: [201, 'White MDF 18mm'],
            product_uom_qty: 5, // 5 > 3: surplus is sufficient, only lower quantities are flagged
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
    const resultBoardSurplus = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(boardSurplusLines, parsedJobSummary);
    strict_1.default.equal(resultBoardSurplus.hasShortfall, false);
    strict_1.default.equal(resultBoardSurplus.shortfalls.length, 0);
    // Scenario E: Board Mismatch (e.g., Quotation has White Waterproof but Job Summary has Harbour Grey Waterproof)
    const mismatchedBoardLines = [
        {
            id: 1,
            name: 'Cutting White Waterproof 18mm',
            product_id: [401, 'Cutting White Waterproof 18mm'],
            product_uom_qty: 17,
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
    const resultMismatch = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(mismatchedBoardLines, parsedJobSummary);
    strict_1.default.equal(resultMismatch.hasShortfall, true);
    strict_1.default.ok(resultMismatch.shortfalls.some(s => s.includes('Board Mismatch')));
});
(0, node_test_1.default)('compareQuotationLinesWithJobSummary correctly distinguishes multiple boards of same color (WHITE MDF vs WHITE WATERPROOF)', () => {
    const parsedJobSummary = {
        items: [
            {
                color: 'White',
                thickness_mm: 1,
                length_mm: 138733,
                roll_length_mm: 15000,
            },
        ],
        sectionFound: true,
        sectionText: '',
        rawText: '',
        logs: [],
        clientName: 'HARRY INTERIOR',
        optimizedSheets: 12,
        totalPanels: 150,
        sheetMaterials: [
            {
                name: 'WHITE MDF',
                thickness_mm: 18,
                sheets: 8,
                panels: 84,
                length_mm: 2440,
                width_mm: 1220,
            },
            {
                name: 'WHITE WATERPROOF',
                thickness_mm: 18,
                sheets: 4,
                panels: 66,
                length_mm: 2440,
                width_mm: 1220,
            },
        ],
    };
    const quotationLines = [
        {
            id: 1,
            name: 'Optimised Panels',
            product_id: [102, 'Optimised Panels'],
            product_uom_qty: 153,
            display_type: false,
        },
        {
            id: 2,
            name: 'Cutting White MDF 18mm',
            product_id: [201, 'Cutting White MDF 18mm'],
            product_uom_qty: 8,
            display_type: false,
        },
        {
            id: 3,
            name: 'Cutting White Waterproof 18mm',
            product_id: [202, 'Cutting White Waterproof 18mm'],
            product_uom_qty: 4,
            display_type: false,
        },
        {
            id: 4,
            name: 'Edge Banding Service White',
            product_id: [301, 'Edge Banding Service White'],
            product_uom_qty: 171,
            display_type: false,
        },
    ];
    const result = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(quotationLines, parsedJobSummary);
    strict_1.default.equal(result.hasShortfall, false);
    strict_1.default.equal(result.shortfalls.length, 0);
    strict_1.default.equal(result.boardDetails.length, 2);
    strict_1.default.equal(result.boardDetails[0].quotedSheets, 8);
    strict_1.default.equal(result.boardDetails[0].requiredSheets, 8);
    strict_1.default.equal(result.boardDetails[1].quotedSheets, 4);
    strict_1.default.equal(result.boardDetails[1].requiredSheets, 4);
});
(0, node_test_1.default)('compareQuotationLinesWithJobSummary accurately matches edge banding service colors without false positives', () => {
    const parsedJobSummary = {
        items: [
            {
                color: 'White',
                thickness_mm: 1,
                length_mm: 17000, // 17m
                roll_length_mm: 15000,
            },
        ],
        sectionFound: true,
        sectionText: '',
        rawText: '',
        logs: [],
        clientName: 'TEST CLIENT',
        optimizedSheets: 0,
        totalPanels: 0,
        sheetMaterials: [],
    };
    // Case 1: Quotation only has "Edge Banding Service Off-white" -> Should NOT match "White"
    const offWhiteOnlyLines = [
        {
            id: 1,
            name: 'Edge Banding Service Off-white',
            product_id: [932, 'Edge Banding Service Off-white'],
            product_uom_qty: 17,
            display_type: false,
        },
    ];
    const offWhiteResult = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(offWhiteOnlyLines, parsedJobSummary);
    strict_1.default.equal(offWhiteResult.hasShortfall, true);
    strict_1.default.equal(offWhiteResult.edgingDetails[0].quotedMeters, 0);
    strict_1.default.equal(offWhiteResult.edgingDetails[0].isSufficient, false);
    // Case 2: Quotation has "Edge Banding Service White" -> Matches exactly
    const whiteLines = [
        {
            id: 2,
            name: 'Edge Banding Service White',
            product_id: [115, 'Edge Banding Service White'],
            product_uom_qty: 17,
            display_type: false,
        },
    ];
    const whiteResult = (0, quotationSyncService_1.compareQuotationLinesWithJobSummary)(whiteLines, parsedJobSummary);
    strict_1.default.equal(whiteResult.hasShortfall, false);
    strict_1.default.equal(whiteResult.edgingDetails[0].quotedMeters, 17);
    strict_1.default.equal(whiteResult.edgingDetails[0].isSufficient, true);
});
(0, node_test_1.default)('parseJobSummaryPdf extracts sheet materials and header metrics from user PDF', async () => {
    const samplePdfPath = 'C:/Users/ADMIN/.gemini/antigravity-ide/brain/4bbdfaaa-f3d6-4738-b235-1c89d579bcb5/.user_uploaded/media_1792362774320.pdf';
    if (!fs_1.default.existsSync(samplePdfPath)) {
        return;
    }
    const buf = fs_1.default.readFileSync(samplePdfPath);
    const parsed = await (0, pdfParser_1.parseJobSummaryPdf)(buf, helpers_1.DEFAULT_PARSER_CONFIG);
    strict_1.default.equal(parsed.clientName, 'NICKSON');
    strict_1.default.equal(parsed.optimizedSheets, 3);
    strict_1.default.equal(parsed.totalPanels, 3);
    strict_1.default.ok(parsed.sheetMaterials && parsed.sheetMaterials.length >= 1);
    strict_1.default.equal(parsed.sheetMaterials[0].name, 'WHITE MDF');
    strict_1.default.equal(parsed.sheetMaterials[0].thickness_mm, 18);
    strict_1.default.equal(parsed.sheetMaterials[0].sheets, 3);
    strict_1.default.equal(parsed.sheetMaterials[0].panels, 3);
    strict_1.default.equal(parsed.items.length, 1);
    strict_1.default.equal(parsed.items[0].color, 'White');
    strict_1.default.equal(parsed.items[0].length_mm, 16200);
});
(0, node_test_1.default)('getScopedQuotationCategories correctly groups categories into boards and services', async () => {
    const { getScopedQuotationCategories } = await Promise.resolve().then(() => __importStar(require('./quotationSyncService')));
    const mockClient = {
        searchReadRecords: async (model) => {
            if (model === 'product.category') {
                return [
                    { id: 1, name: 'Goods', complete_name: 'Goods' },
                    { id: 7, name: 'Boards', complete_name: 'Goods / Boards' },
                    { id: 11, name: 'Nicewood Boards', complete_name: 'Goods / Nicewood Boards' },
                    { id: 3, name: 'Services', complete_name: 'Services' },
                    { id: 6, name: 'Cutting', complete_name: 'Services / Cutting' },
                    { id: 12, name: 'Cutting Nicewood', complete_name: 'Services / Cutting Nicewood' },
                    { id: 5, name: 'Edging services', complete_name: 'Services / Edging services' },
                    { id: 4, name: 'Grooving', complete_name: 'Services / Grooving' },
                    { id: 8, name: 'Accessories', complete_name: 'Accessories' },
                ];
            }
            return [];
        },
    };
    const result = await getScopedQuotationCategories(mockClient);
    strict_1.default.deepEqual(result.boardCategoryIds.sort(), [7, 11].sort());
    strict_1.default.deepEqual(result.cuttingCategoryIds.sort(), [6, 12].sort());
    strict_1.default.deepEqual(result.edgingCategoryIds, [5]);
    strict_1.default.ok(result.allRelevantIds.includes(5));
    strict_1.default.ok(result.allRelevantIds.includes(6));
    strict_1.default.ok(result.allRelevantIds.includes(7));
    // Non-relevant categories like Accessories (8) and Goods parent (1) must NOT be in allRelevantIds
    strict_1.default.equal(result.allRelevantIds.includes(8), false);
    strict_1.default.equal(result.allRelevantIds.includes(1), false);
});
