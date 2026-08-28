"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const accountStatus_1 = require("./accountStatus");
(0, node_test_1.default)('inactive approved users are deactivated', () => {
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(false), true);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(true), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(undefined), false);
});
(0, node_test_1.default)('the configured local administrator remains available', () => {
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(false, true), false);
});
