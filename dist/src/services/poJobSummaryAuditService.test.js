"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const poJobSummaryAuditService_1 = require("./poJobSummaryAuditService");
(0, node_test_1.default)('extractSoNameFromOrigin correctly extracts Sales Order name from various PO origin patterns', () => {
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)('S02182'), 'S02182');
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)('s02182'), 'S02182');
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)('S02182:WH/MO/05412'), 'S02182');
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)('SO1005'), 'SO1005');
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)('Customer order S01999 for kitchen'), 'S01999');
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)('WH/MO/05412'), null);
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)(''), null);
    strict_1.default.equal((0, poJobSummaryAuditService_1.extractSoNameFromOrigin)(null), null);
});
(0, node_test_1.default)('comparePoLinesWithSheetMaterials detects shortfalls when PO ordered less than Job Summary', () => {
    const sheetMaterials = [
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
    const poLinesShortfall = [
        {
            id: 1,
            name: 'WHITE MDF 18mm',
            product_id: [101, 'WHITE MDF 18mm'],
            product_qty: 2,
        },
    ];
    const resultShortfall = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLinesShortfall, sheetMaterials);
    strict_1.default.equal(resultShortfall.hasShortfall, true);
    strict_1.default.equal(resultShortfall.shortfalls.length, 1);
    strict_1.default.ok(resultShortfall.shortfalls[0].includes('PO ordered 2 sheet(s)'));
    strict_1.default.ok(resultShortfall.shortfalls[0].includes('Job Summary requires 3 sheet(s)'));
    // Case B: PO has exactly 3 sheets (match)
    const poLinesMatch = [
        {
            id: 1,
            name: 'WHITE MDF 18mm',
            product_id: [101, 'WHITE MDF 18mm'],
            product_qty: 3,
        },
    ];
    const resultMatch = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLinesMatch, sheetMaterials);
    strict_1.default.equal(resultMatch.hasShortfall, false);
    strict_1.default.equal(resultMatch.shortfalls.length, 0);
    strict_1.default.equal(resultMatch.verified.length, 1);
    // Case C: PO has 5 sheets for boards (mismatch: "not less, but can be more" does NOT apply to boards)
    const poLinesSurplus = [
        {
            id: 1,
            name: 'WHITE MDF 18mm',
            product_id: [101, 'WHITE MDF 18mm'],
            product_qty: 5,
        },
    ];
    const resultSurplus = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLinesSurplus, sheetMaterials);
    strict_1.default.equal(resultSurplus.hasShortfall, true);
    strict_1.default.equal(resultSurplus.shortfalls.length, 1);
    strict_1.default.ok(resultSurplus.shortfalls[0].includes('Excess: 2 sheet(s)'));
});
(0, node_test_1.default)('comparePoLinesWithSheetMaterials handles multiple board materials correctly', () => {
    const sheetMaterials = [
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
    const poLines = [
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
    const result = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLines, sheetMaterials);
    strict_1.default.equal(result.hasShortfall, true);
    strict_1.default.equal(result.shortfalls.length, 1);
    strict_1.default.ok(result.shortfalls[0].includes('SUEZ OAK'));
    strict_1.default.ok(result.shortfalls[0].includes('Shortfall: 7 sheet(s)'));
    strict_1.default.equal(result.verified.length, 1);
    strict_1.default.ok(result.verified[0].includes('WHITE MDF'));
});
(0, node_test_1.default)('comparePoLinesWithSheetMaterials allows edge banding surplus but flags board surplus', () => {
    const sheetMaterials = [
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
    const poLinesMatch = [
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
    const resMatch = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLinesMatch, sheetMaterials, edgingItems);
    strict_1.default.equal(resMatch.hasShortfall, false);
    strict_1.default.equal(resMatch.shortfalls.length, 0);
    strict_1.default.equal(resMatch.verified.length, 2);
    // PO has edge banding shortfall (20m < 35m) -> MISMATCH!
    const poLinesEdgingShortfall = [
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
    const resShortfall = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLinesEdgingShortfall, sheetMaterials, edgingItems);
    strict_1.default.equal(resShortfall.hasShortfall, true);
    strict_1.default.equal(resShortfall.shortfalls.length, 1);
    strict_1.default.ok(resShortfall.shortfalls[0].includes('Short by 15m'));
});
(0, node_test_1.default)('comparePoLinesWithSheetMaterials matches Backer White MDF 3mm with BACKER WHITE 3mm and White Waterproof panel 18mm with WHITE WATERPROOF', () => {
    const sheetMaterials = [
        {
            name: 'BACKER WHITE',
            thickness_mm: 3,
            sheets: 15,
            panels: 33,
            length_mm: 2440,
            width_mm: 1220,
        },
        {
            name: 'WHITE WATERPROOF',
            thickness_mm: 18,
            sheets: 3,
            panels: 21,
            length_mm: 2440,
            width_mm: 1220,
        },
        {
            name: 'LIGHT GREY PARTICLE',
            thickness_mm: 18,
            sheets: 29,
            panels: 249,
            length_mm: 2440,
            width_mm: 1220,
        },
    ];
    // PO lines from P01084 (Vendor: TIP TOP)
    const poLines = [
        {
            id: 1,
            name: 'White Waterproof panel 18mm',
            product_id: [101, 'White Waterproof panel 18mm'],
            product_qty: 4, // 4 ordered vs 3 required (excess of 1)
        },
        {
            id: 2,
            name: 'Backer White MDF 3mm',
            product_id: [102, 'Backer White MDF 3mm'],
            product_qty: 10, // 10 ordered vs 15 required (shortfall of 5, NOT 0 sheets ordered!)
        },
    ];
    const res = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLines, sheetMaterials);
    strict_1.default.equal(res.hasShortfall, true);
    // BACKER WHITE must be recognized as 10 sheets ordered (shortfall of 5 sheets, NOT 15 sheets!)
    const backerShortfall = res.shortfalls.find((s) => s.includes('BACKER WHITE'));
    strict_1.default.ok(backerShortfall, 'BACKER WHITE shortfall must be reported');
    strict_1.default.ok(backerShortfall.includes('PO ordered 10 sheet(s)'), `Expected 10 sheets ordered, got: ${backerShortfall}`);
    strict_1.default.ok(backerShortfall.includes('Shortfall: 5 sheet(s)'), `Expected Shortfall of 5, got: ${backerShortfall}`);
    // WHITE WATERPROOF must be recognized as 4 sheets ordered (excess of 1 sheet)
    const waterproofMismatch = res.shortfalls.find((s) => s.includes('WHITE WATERPROOF'));
    strict_1.default.ok(waterproofMismatch, 'WHITE WATERPROOF excess must be reported');
    strict_1.default.ok(waterproofMismatch.includes('PO ordered 4 sheet(s)'), `Expected 4 sheets ordered, got: ${waterproofMismatch}`);
    strict_1.default.ok(waterproofMismatch.includes('Excess: 1 sheet(s)'), `Expected Excess of 1, got: ${waterproofMismatch}`);
});
(0, node_test_1.default)('comparePoLinesWithSheetMaterials handles multi-PO procurement correctly when other confirmed POs cover remaining materials', () => {
    const sheetMaterials = [
        {
            name: 'BACKER WHITE',
            thickness_mm: 3,
            sheets: 15,
            panels: 33,
            length_mm: 2440,
            width_mm: 1220,
        },
        {
            name: 'WHITE WATERPROOF',
            thickness_mm: 18,
            sheets: 3,
            panels: 21,
            length_mm: 2440,
            width_mm: 1220,
        },
        {
            name: 'LIGHT GREY PARTICLE',
            thickness_mm: 18,
            sheets: 29,
            panels: 249,
            length_mm: 2440,
            width_mm: 1220,
        },
    ];
    // PO lines from P01084 (Vendor: TIP TOP): 3 White Waterproof, 10 Backer White
    const poLinesThis = [
        {
            id: 1,
            name: 'White Waterproof panel 18mm',
            product_id: [101, 'White Waterproof panel 18mm'],
            product_qty: 3, // Exact match
        },
        {
            id: 2,
            name: 'Backer White MDF 3mm',
            product_id: [102, 'Backer White MDF 3mm'],
            product_qty: 10,
        },
    ];
    // PO lines from P01085 (Vendor: PG Bison): 29 Light Grey Particle, 5 Backer White MDF
    const poLinesOther = [
        {
            id: 3,
            name: 'Light Grey Particle 18mm',
            product_id: [103, 'Light Grey Particle 18mm'],
            product_qty: 29,
        },
        {
            id: 4,
            name: 'Backer White MDF 3mm',
            product_id: [102, 'Backer White MDF 3mm'],
            product_qty: 5,
        },
    ];
    const res = (0, poJobSummaryAuditService_1.comparePoLinesWithSheetMaterials)(poLinesThis, sheetMaterials, [], poLinesOther);
    // Across both POs:
    // WHITE WATERPROOF: 3 + 0 = 3 (exact match)
    // LIGHT GREY PARTICLE: 0 + 29 = 29 (exact match on other PO)
    // BACKER WHITE: 10 + 5 = 15 (exact match across both POs)
    strict_1.default.equal(res.hasShortfall, false, 'Expected no shortfall when all materials are covered across linked POs');
    strict_1.default.equal(res.shortfalls.length, 0);
    strict_1.default.equal(res.verified.length, 3);
});
