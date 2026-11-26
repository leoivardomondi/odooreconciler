"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStartupState = getStartupState;
exports.markStartupStep = markStartupStep;
exports.markStartupReady = markStartupReady;
exports.markStartupFailed = markStartupFailed;
exports.waitForStartupSettlement = waitForStartupSettlement;
exports.resetStartupStateForTests = resetStartupStateForTests;
exports.markStartupFailedIfStale = markStartupFailedIfStale;
function nowIso() {
    return new Date().toISOString();
}
const startupState = {
    status: 'starting',
    errorMessage: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    stepStartedAt: nowIso(),
    step: 'booting',
};
const settlementWaiters = new Set();
function notifySettlementWaiters() {
    for (const resolve of settlementWaiters) {
        resolve();
    }
    settlementWaiters.clear();
}
function getStartupState() {
    return startupState;
}
function markStartupStep(step) {
    startupState.step = step;
    startupState.stepStartedAt = nowIso();
    startupState.updatedAt = startupState.stepStartedAt;
}
function markStartupReady() {
    startupState.status = 'ready';
    startupState.errorMessage = null;
    startupState.step = 'ready';
    startupState.stepStartedAt = nowIso();
    startupState.updatedAt = startupState.stepStartedAt;
    notifySettlementWaiters();
}
function markStartupFailed(errorMessage) {
    startupState.status = 'failed';
    startupState.errorMessage = errorMessage;
    startupState.step = `${startupState.step} failed`;
    startupState.updatedAt = nowIso();
    notifySettlementWaiters();
}
function waitForStartupSettlement(timeoutMs = 12000) {
    if (startupState.status !== 'starting') {
        return Promise.resolve(startupState);
    }
    const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;
    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            settlementWaiters.delete(finish);
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            resolve(startupState);
        };
        settlementWaiters.add(finish);
        timer = setTimeout(finish, safeTimeoutMs);
        timer.unref?.();
    });
}
function resetStartupStateForTests() {
    const now = nowIso();
    startupState.status = 'starting';
    startupState.errorMessage = null;
    startupState.startedAt = now;
    startupState.updatedAt = now;
    startupState.stepStartedAt = now;
    startupState.step = 'booting';
    settlementWaiters.clear();
}
function markStartupFailedIfStale(maxStepMs) {
    if (startupState.status !== 'starting') {
        return false;
    }
    const stepStartedAt = Date.parse(startupState.stepStartedAt);
    if (!Number.isFinite(stepStartedAt) || Date.now() - stepStartedAt <= maxStepMs) {
        return false;
    }
    markStartupFailed(`Startup step "${startupState.step}" did not finish within ${maxStepMs}ms.`);
    return true;
}
