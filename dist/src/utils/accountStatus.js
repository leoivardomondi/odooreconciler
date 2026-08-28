"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAccountDeactivated = isAccountDeactivated;
function isAccountDeactivated(active, isConfiguredLocalAdmin = false) {
    return active === false && !isConfiguredLocalAdmin;
}
