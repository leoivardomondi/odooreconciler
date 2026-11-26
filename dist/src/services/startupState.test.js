"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const startupState_1 = require("./startupState");
(0, node_test_1.default)('waitForStartupSettlement resolves immediately when startup finishes', async () => {
    (0, startupState_1.resetStartupStateForTests)();
    (0, startupState_1.markStartupStep)('initializing database');
    const startedAt = Date.now();
    setTimeout(() => {
        (0, startupState_1.markStartupReady)();
    }, 40);
    const state = await (0, startupState_1.waitForStartupSettlement)(5000);
    const elapsedMs = Date.now() - startedAt;
    strict_1.default.equal(state.status, 'ready');
    strict_1.default.equal((0, startupState_1.getStartupState)().status, 'ready');
    strict_1.default.ok(elapsedMs < 1500, `Expected fast settlement, got ${elapsedMs}ms`);
});
(0, node_test_1.default)('waitForStartupSettlement resolves immediately when startup fails', async () => {
    (0, startupState_1.resetStartupStateForTests)();
    (0, startupState_1.markStartupStep)('initializing database');
    const startedAt = Date.now();
    setTimeout(() => {
        (0, startupState_1.markStartupFailed)('MySQL connection refused');
    }, 30);
    const state = await (0, startupState_1.waitForStartupSettlement)(5000);
    const elapsedMs = Date.now() - startedAt;
    strict_1.default.equal(state.status, 'failed');
    strict_1.default.equal(state.errorMessage, 'MySQL connection refused');
    strict_1.default.ok(elapsedMs < 1500, `Expected fast failure settlement, got ${elapsedMs}ms`);
});
(0, node_test_1.default)('waitForStartupSettlement falls back cleanly on timeout while still starting', async () => {
    (0, startupState_1.resetStartupStateForTests)();
    (0, startupState_1.markStartupStep)('initializing database');
    const state = await (0, startupState_1.waitForStartupSettlement)(60);
    strict_1.default.equal(state.status, 'starting');
    strict_1.default.equal(state.step, 'initializing database');
});
(0, node_test_1.default)('waitForStartupSettlement returns immediately when already ready', async () => {
    (0, startupState_1.resetStartupStateForTests)();
    (0, startupState_1.markStartupReady)();
    const startedAt = Date.now();
    const state = await (0, startupState_1.waitForStartupSettlement)(5000);
    strict_1.default.equal(state.status, 'ready');
    strict_1.default.ok(Date.now() - startedAt < 50);
});
