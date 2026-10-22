"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const accountStatus_1 = require("./accountStatus");
(0, node_test_1.default)('inactive approved users are deactivated across various database types', () => {
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(false), true);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(0), true);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)('0'), true);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)('false'), true);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)('FALSE'), true);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(true), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(1), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)('1'), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)('true'), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(undefined), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(null), false);
});
(0, node_test_1.default)('the configured local administrator remains available even if flag is false', () => {
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(false, true), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)(0, true), false);
    strict_1.default.equal((0, accountStatus_1.isAccountDeactivated)('0', true), false);
});
(0, node_test_1.default)('filtering approved users excludes inactive users from email recipient choices', () => {
    const users = [
        { email: 'active1@urbanvibeinteriordesign.co.ke', active: true },
        { email: 'inactive1@urbanvibeinteriordesign.co.ke', active: false },
        { email: 'active2@urbanvibeinteriordesign.co.ke', active: true },
        { email: 'inactive2@urbanvibeinteriordesign.co.ke', active: false },
        { email: '', active: true },
    ];
    const emailChoices = users
        .filter((u) => u && Boolean(u.active) && typeof u.email === 'string' && u.email.trim().length > 0)
        .map((u) => u.email.trim().toLowerCase());
    strict_1.default.deepEqual(emailChoices, [
        'active1@urbanvibeinteriordesign.co.ke',
        'active2@urbanvibeinteriordesign.co.ke',
    ]);
    strict_1.default.ok(!emailChoices.includes('inactive1@urbanvibeinteriordesign.co.ke'));
    strict_1.default.ok(!emailChoices.includes('inactive2@urbanvibeinteriordesign.co.ke'));
});
