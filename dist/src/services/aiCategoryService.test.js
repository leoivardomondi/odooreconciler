"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const aiCategoryService_1 = require("./aiCategoryService");
(0, node_test_1.default)('boda service -> staff_transport_expense', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Completed Pay Merchant',
        counterparty: 'Boda Driver',
        direction: 'out',
        paidIn: null,
        withdrawn: 200,
        notes: 'boda service',
    });
    strict_1.default.equal(result.category, 'staff_transport_expense', `Expected staff_transport_expense, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('tuktuk service -> transport_expense', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Completed Pay Merchant',
        counterparty: 'Tuktuk Rider',
        direction: 'out',
        paidIn: null,
        withdrawn: 350,
        notes: 'tuktuk service',
    });
    strict_1.default.equal(result.category, 'transport_expense', `Expected transport_expense, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('pickup -> transport_expense', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Pay Merchant',
        counterparty: 'Pickup Driver',
        direction: 'out',
        paidIn: null,
        withdrawn: 1200,
        notes: 'pick up to site',
    });
    strict_1.default.equal(result.category, 'transport_expense', `Expected transport_expense, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('deposited to bank -> bank_transfer', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'KCB Bank',
        direction: 'out',
        paidIn: null,
        withdrawn: 50000,
        notes: 'deposited to bank',
    });
    strict_1.default.equal(result.category, 'bank_transfer', `Expected bank_transfer, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('deposited to ABC bank -> bank_transfer', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Pay Merchant',
        counterparty: 'ABC Bank Account',
        direction: 'out',
        paidIn: null,
        withdrawn: 25000,
        notes: 'deposited to ABC bank',
    });
    strict_1.default.equal(result.category, 'bank_transfer', `Expected bank_transfer, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('advance salary -> advance_salary', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'Peter Omondi',
        direction: 'out',
        paidIn: null,
        withdrawn: 4000,
        notes: 'advance salary',
    });
    strict_1.default.equal(result.category, 'advance_salary', `Expected advance_salary, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('overtime 24th -> staff_overtime_expense', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'John Mwangi',
        direction: 'out',
        paidIn: null,
        withdrawn: 1500,
        notes: 'overtime 24th',
    });
    strict_1.default.equal(result.category, 'staff_overtime_expense', `Expected staff_overtime_expense, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('casuals offloaded -> staff_loading_expense', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Payment',
        counterparty: 'Casual Crew',
        direction: 'out',
        paidIn: null,
        withdrawn: 2000,
        notes: 'casuals offloaded Odera\'s order',
    });
    strict_1.default.equal(result.category, 'staff_loading_expense', `Expected staff_loading_expense, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('luch for staff -> staff_lunch_expense', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Pay Merchant',
        counterparty: 'Kibandaski Cafe',
        direction: 'out',
        paidIn: null,
        withdrawn: 500,
        notes: 'luch for staff',
    });
    strict_1.default.equal(result.category, 'staff_lunch_expense', `Expected staff_lunch_expense, got ${result.category} (reason: ${result.reason})`);
});
(0, node_test_1.default)('refund to customer -> refunds', async () => {
    const result = await (0, aiCategoryService_1.categorizeWithAi)({
        details: 'Customer Refund',
        counterparty: 'Jane Doe',
        direction: 'out',
        paidIn: null,
        withdrawn: 3000,
        notes: 'refund to customer',
    });
    strict_1.default.equal(result.category, 'refunds', `Expected refunds, got ${result.category} (reason: ${result.reason})`);
});
