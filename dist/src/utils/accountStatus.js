"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAccountDeactivated = isAccountDeactivated;
function isAccountDeactivated(active, isConfiguredLocalAdmin = false) {
    if (isConfiguredLocalAdmin)
        return false;
    if (active === false || active === 0 || active === '0')
        return true;
    if (typeof active === 'string' && active.trim().toLowerCase() === 'false')
        return true;
    return false;
}
