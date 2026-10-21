"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const authService_1 = require("./authService");
(0, node_test_1.default)('authService - canAccessPath allows /shop-floor and aliases for shop-floor operators', () => {
    const operatorUser = {
        email: 'operator@urbanvibeinteriordesign.co.ke',
        role: 'user',
        apps: ['shop-floor'],
    };
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'GET', '/shop-floor'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'POST', '/shop-floor'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'GET', '/shop-floor/work-order/10/stock-check'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'POST', '/shop-floor/work-order/10/advance'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'POST', '/shop-floor/work-order/10/pause'), true);
    // Aliases that previously caused 404/403:
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'GET', '/shopfloor'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'GET', '/shop_floor'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'GET', '/shop'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'POST', '/shopfloor'), true);
    strict_1.default.equal((0, authService_1.canAccessPath)(operatorUser, 'POST', '/shop_floor'), true);
    // Non-shop-floor user denied
    const guestUser = {
        email: 'guest@urbanvibeinteriordesign.co.ke',
        role: 'user',
        apps: [],
    };
    strict_1.default.equal((0, authService_1.canAccessPath)(guestUser, 'GET', '/shop-floor'), false);
    strict_1.default.equal((0, authService_1.canAccessPath)(guestUser, 'GET', '/shopfloor'), false);
});
