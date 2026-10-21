"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const shopFloor_1 = require("./shopFloor");
(0, node_test_1.default)('isBitcherOnyangoUser identifies user Bitcher Onyango correctly', () => {
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'BITCHER ONYANGO', email: 'bitcher@urbanvibe.co.ke' }), true);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'Bitcher Onyango', email: 'bitcher.onyango@gmail.com' }), true);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'bitcher', email: 'operator@urbanvibe.co.ke' }), true);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'Operator 1', email: 'bitcher@urbanvibe.co.ke' }), true);
    // Other operators must NOT be flagged
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'Raphael Onyango', email: 'raphael@urbanvibe.co.ke' }), false);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'Charles', email: 'charles@urbanvibe.co.ke' }), false);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)({ displayName: 'Leoivard Ongule', email: 'leoivard@urbanvibe.co.ke' }), false);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)(null), false);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoUser)(undefined), false);
});
(0, node_test_1.default)('isTintInteriorVendor detects vendor Tint Interior across formats', () => {
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)('TINT INTERIOR'), true);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)('Tint Interior Limited'), true);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)('TINT INTERIORS'), true);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)([42, 'TINT INTERIOR']), true);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)([42, 'Tint Interior Ltd']), true);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)({ name: 'TINT INTERIOR' }), true);
    // Other vendors must NOT match
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)('TIMBER WORLD LTD'), false);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)([15, 'HARDWARE CITY']), false);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)('URBAN VIBE INTERIOR DESIGN'), false);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)(null), false);
    strict_1.default.equal((0, shopFloor_1.isTintInteriorVendor)(undefined), false);
});
(0, node_test_1.default)('isBitcherOnyangoRestrictedFromReceipt restricts ONLY Bitcher Onyango from Tint Interior', () => {
    const bitcherUser = { displayName: 'BITCHER ONYANGO', email: 'bitcher@urbanvibe.co.ke' };
    const raphaelUser = { displayName: 'Raphael Onyango', email: 'raphael@urbanvibe.co.ke' };
    const charlesUser = { displayName: 'Charles', email: 'charles@urbanvibe.co.ke' };
    const tintReceipt = { partner_id: [101, 'TINT INTERIOR'] };
    const timberReceipt = { partner_id: [102, 'TIMBER WORLD LTD'] };
    // Bitcher Onyango is restricted from Tint Interior
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoRestrictedFromReceipt)(bitcherUser, tintReceipt), true);
    // Bitcher Onyango CAN receive from other vendors
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoRestrictedFromReceipt)(bitcherUser, timberReceipt), false);
    // Other operators (Raphael, Charles) CAN receive from Tint Interior
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoRestrictedFromReceipt)(raphaelUser, tintReceipt), false);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoRestrictedFromReceipt)(charlesUser, tintReceipt), false);
    // Fallbacks
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoRestrictedFromReceipt)(null, tintReceipt), false);
    strict_1.default.equal((0, shopFloor_1.isBitcherOnyangoRestrictedFromReceipt)(bitcherUser, null), false);
});
