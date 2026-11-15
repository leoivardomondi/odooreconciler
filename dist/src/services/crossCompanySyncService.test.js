"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const crossCompanySyncService_js_1 = require("./crossCompanySyncService.js");
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
