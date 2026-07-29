"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStartupState = getStartupState;
exports.markStartupStep = markStartupStep;
exports.markStartupReady = markStartupReady;
exports.markStartupFailed = markStartupFailed;
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
}
function markStartupFailed(errorMessage) {
    startupState.status = 'failed';
    startupState.errorMessage = errorMessage;
    startupState.step = `${startupState.step} failed`;
    startupState.updatedAt = nowIso();
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
