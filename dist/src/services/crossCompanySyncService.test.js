"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const crossCompanySyncService_js_1 = require("./crossCompanySyncService.js");
const repositories_js_1 = require("../models/repositories.js");
(0, node_test_1.default)('isEligibleStandaloneEtrPo correctly filters standalone ETR POs', () => {
    // Case 1: Eligible standalone ETR PO in Company 1 from Nov 1st onwards
    const eligiblePo = {
        id: 100,
        name: 'P01409',
        partner_id: [524, 'TINT INTERIORS'],
        company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
        date_order: '2026-11-12 14:45:50',
        date_approve: '2026-11-14 06:01:31',
        origin: false,
        state: 'purchase',
        amount_total: 26000,
        order_line: [1],
        x_studio_selection_field_68_1k74mkea1: 'ETR',
    };
    strict_1.default.equal((0, crossCompanySyncService_js_1.isEligibleStandaloneEtrPo)(eligiblePo), true);
    // Case 2: Not eligible because Tax Option is NO ETR
    const noEtrPo = {
        ...eligiblePo,
        x_studio_selection_field_68_1k74mkea1: 'NO ETR',
    };
    strict_1.default.equal((0, crossCompanySyncService_js_1.isEligibleStandaloneEtrPo)(noEtrPo), false);
    // Case 3: Not eligible because it is linked to a Sales Order (not standalone)
    const soLinkedPo = {
        ...eligiblePo,
        origin: 'S03885',
    };
    strict_1.default.equal((0, crossCompanySyncService_js_1.isEligibleStandaloneEtrPo)(soLinkedPo), false);
    // Case 4: Not eligible because date is before November 1st, 2026
    const oldPo = {
        ...eligiblePo,
        date_order: '2026-10-25 10:00:00',
    };
    strict_1.default.equal((0, crossCompanySyncService_js_1.isEligibleStandaloneEtrPo)(oldPo), false);
    // Case 5: Not eligible because it is in Company 3 or Company 2
    const otherCompanyPo = {
        ...eligiblePo,
        company_id: [3, 'URBAN VIBE 2'],
    };
    strict_1.default.equal((0, crossCompanySyncService_js_1.isEligibleStandaloneEtrPo)(otherCompanyPo), false);
});
(0, node_test_1.default)('upsertCrossCompanyPoLog and getCrossCompanyPoLogs track POs with Tax Option ETR moved to Company 3', async () => {
    const testSourcePoId = 1432;
    const testSourcePoName = 'P01432';
    // 1. Log creation of mirror in Company 3
    const logId = await (0, repositories_js_1.upsertCrossCompanyPoLog)({
        source_po_id: testSourcePoId,
        source_po_name: testSourcePoName,
        source_company_id: 1,
        target_company_id: 3,
        target_po_id: 5890,
        target_po_name: 'P05890',
        partner_id: 42,
        partner_name: 'TIP TOP',
        tax_option: 'ETR',
        amount_total: 28350.0,
        currency: 'KES',
        source_state: 'purchase',
        target_state: 'purchase',
        origin: testSourcePoName,
        bill_id: 991,
        bill_name: 'BILL/2026/11/0088',
        payment_id: 501,
        payment_name: 'PAY/2026/11/0045',
        action: 'approved_and_paid',
        message: 'PO P01432 successfully mirrored to Company 3 (P05890). Bill: BILL/2026/11/0088, Paid: true.',
        moved_at: '2026-11-16 13:05:00',
    });
    strict_1.default.ok(logId, 'Log ID should be returned');
    // 2. Retrieve log by source PO ID
    const foundLog = await (0, repositories_js_1.getCrossCompanyPoLogBySourcePoId)(testSourcePoId);
    strict_1.default.ok(foundLog, 'Log should be retrievable by source PO ID');
    strict_1.default.equal(foundLog?.source_po_name, 'P01432');
    strict_1.default.equal(foundLog?.target_company_id, 3);
    strict_1.default.equal(foundLog?.target_po_name, 'P05890');
    strict_1.default.equal(foundLog?.partner_name, 'TIP TOP');
    strict_1.default.equal(foundLog?.tax_option, 'ETR');
    strict_1.default.equal(Number(foundLog?.amount_total), 28350.0);
    strict_1.default.equal(foundLog?.bill_name, 'BILL/2026/11/0088');
    strict_1.default.equal(foundLog?.payment_name, 'PAY/2026/11/0045');
    // 3. Search logs
    const logs = await (0, repositories_js_1.getCrossCompanyPoLogs)({ search: 'P01432' });
    strict_1.default.ok(logs.length >= 1, 'Should find at least 1 log for P01432');
    strict_1.default.equal(logs[0].source_po_name, 'P01432');
    // 4. Check total count
    const count = await (0, repositories_js_1.getCrossCompanyPoLogsCount)();
    strict_1.default.ok(count >= 1, 'Count should be at least 1');
});
