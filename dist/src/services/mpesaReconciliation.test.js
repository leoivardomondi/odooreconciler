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
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const XLSX = __importStar(require("xlsx"));
const mpesaSpreadsheetService_1 = require("./mpesaSpreadsheetService");
const aiCategoryService_1 = require("./aiCategoryService");
(0, node_test_1.default)('spreadsheet extraction: reliably extracts Other Party Info column and maps to counterparty, userSupplier and raw.otherPartyText', async () => {
    const sampleData = [
        ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Transaction Type', 'Other Party Info'],
        ['UEPTQBVEI1', '2026-03-01 10:15:00', 'Customer Merchant Payment', 'Completed', '', '5000.00', '45000.00', 'Merchant Payment', '400200 - TIMSALES LTD'],
        ['UEPTQBVEI2', '2026-03-01 11:30:00', 'Pay Merchant', 'Completed', '', '1200.00', '43800.00', 'Paybill', '254717***721 - JEREMIAH ODERA'],
        ['UEPTQBVEI3', '2026-03-01 12:00:00', 'Merchant Customer Payment', 'Completed', '', '350.00', '43450.00', 'B2C', '0712345678 - JOHN MWANGI'],
        ['UEPTQBVEI4', '2026-03-01 14:20:00', 'Customer Payment', 'Completed', '15000.00', '', '58450.00', 'C2B', 'KEVIN OKUMAYIA AMALANDA'],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const result = await (0, mpesaSpreadsheetService_1.extractMpesaSpreadsheet)({
        buffer,
        originalFilename: 'mpesa_statement_test.xlsx',
    });
    strict_1.default.equal(result.transactions.length, 4, 'Should extract 4 transaction rows');
    // Row 1: Till prefix (TIMSALES LTD)
    const tx1 = result.transactions[0];
    strict_1.default.equal(tx1.counterparty, 'TIMSALES LTD');
    strict_1.default.equal(tx1.userSupplier, 'TIMSALES LTD');
    strict_1.default.equal(tx1.raw.otherPartyText, '400200 - TIMSALES LTD');
    strict_1.default.equal(tx1.withdrawn, 5000);
    // Row 2: Masked phone prefix (JEREMIAH ODERA)
    const tx2 = result.transactions[1];
    strict_1.default.equal(tx2.counterparty, 'JEREMIAH ODERA');
    strict_1.default.equal(tx2.userSupplier, 'JEREMIAH ODERA');
    strict_1.default.equal(tx2.phoneNumber, '254717***721');
    strict_1.default.equal(tx2.raw.otherPartyText, '254717***721 - JEREMIAH ODERA');
    // Row 3: Standard phone prefix (JOHN MWANGI)
    const tx3 = result.transactions[2];
    strict_1.default.equal(tx3.counterparty, 'JOHN MWANGI');
    strict_1.default.equal(tx3.phoneNumber, '0712345678');
    strict_1.default.equal(tx3.raw.otherPartyText, '0712345678 - JOHN MWANGI');
    // Row 4: Standalone name (KEVIN OKUMAYIA AMALANDA)
    const tx4 = result.transactions[3];
    strict_1.default.equal(tx4.counterparty, 'KEVIN OKUMAYIA AMALANDA');
    strict_1.default.equal(tx4.paidIn, 15000);
    strict_1.default.equal(tx4.direction, 'in');
});
(0, node_test_1.default)('spreadsheet extraction: recognizes alternative header names for other party', async () => {
    const sampleData = [
        ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Type', 'Counterparty'],
        ['UEPTQBVEI5', '2026-03-02 09:00:00', 'Payment to Vendor', 'Completed', '', '2500.00', '40000.00', 'Paybill', 'ELGON HARDWARE LTD'],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const result = await (0, mpesaSpreadsheetService_1.extractMpesaSpreadsheet)({
        buffer,
        originalFilename: 'counterparty_test.xlsx',
    });
    strict_1.default.equal(result.transactions.length, 1);
    const tx = result.transactions[0];
    strict_1.default.equal(tx.counterparty, 'ELGON HARDWARE LTD');
    strict_1.default.equal(tx.userSupplier, 'ELGON HARDWARE LTD');
    strict_1.default.equal(tx.raw.otherPartyText, 'ELGON HARDWARE LTD');
});
(0, node_test_1.default)('categorization from user notes: identifies Kenyan operational expense categories', async () => {
    // Staff lunch expense
    const lunchResult = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Completed Pay Merchant',
        counterparty: 'Kibandaski Cafe',
        direction: 'out',
        paidIn: null,
        withdrawn: 450,
        notes: 'lunch for staff',
    });
    strict_1.default.equal(lunchResult.category, 'staff_lunch_expense');
    // Transport expense via tuktuk
    const transportResult = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'Rider',
        direction: 'out',
        paidIn: null,
        withdrawn: 300,
        notes: 'tuktuk transport carrying boards from timsales',
    });
    strict_1.default.equal(transportResult.category, 'transport_expense');
    // Staff overtime expense
    const overtimeResult = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'Brian',
        direction: 'out',
        paidIn: null,
        withdrawn: 1200,
        notes: 'overtime on 24th',
    });
    strict_1.default.equal(overtimeResult.category, 'staff_overtime_expense');
    // Staff loading / offloading expense
    const loadingResult = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'Casual Workers',
        direction: 'out',
        paidIn: null,
        withdrawn: 1500,
        notes: 'payment for loading order',
    });
    strict_1.default.equal(loadingResult.category, 'staff_loading_expense');
    // Office water expense
    const waterResult = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Pay Merchant',
        counterparty: 'Maifan',
        direction: 'out',
        paidIn: null,
        withdrawn: 600,
        notes: 'water dispenser refills for office',
    });
    strict_1.default.equal(waterResult.category, 'office_water_expense');
    // Salary advance
    const advanceResult = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'John',
        direction: 'out',
        paidIn: null,
        withdrawn: 5000,
        notes: 'advance salary for march',
    });
    strict_1.default.equal(advanceResult.category, 'advance_salary');
});
(0, node_test_1.default)('keyword fallback: accurately scores and reasons notes without AI', () => {
    const result = (0, aiCategoryService_1.categorizeByKeywords)({
        details: 'Completed Pay Merchant',
        counterparty: 'Jane',
        direction: 'out',
        paidIn: null,
        withdrawn: 300,
        notes: 'food for staff',
    });
    strict_1.default.equal(result.category, 'staff_lunch_expense');
    strict_1.default.ok(result.confidence >= 0.4);
    strict_1.default.equal(result.method, 'keyword');
});
