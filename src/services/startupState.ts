export type StartupStatus = 'starting' | 'ready' | 'failed';

interface StartupState {
  status: StartupStatus;
  errorMessage: string | null;
  startedAt: string;
  updatedAt: string;
  stepStartedAt: string;
  step: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

const startupState: StartupState = {
  status: 'starting',
  errorMessage: null,
  startedAt: nowIso(),
  updatedAt: nowIso(),
  stepStartedAt: nowIso(),
  step: 'booting',
};

export function getStartupState(): StartupState {
  return startupState;
}

export function markStartupStep(step: string) {
  startupState.step = step;
  startupState.stepStartedAt = nowIso();
  startupState.updatedAt = startupState.stepStartedAt;
}

export function markStartupReady() {
  startupState.status = 'ready';
  startupState.errorMessage = null;
  startupState.step = 'ready';
  startupState.stepStartedAt = nowIso();
  startupState.updatedAt = startupState.stepStartedAt;
}

export function markStartupFailed(errorMessage: string) {
  startupState.status = 'failed';
  startupState.errorMessage = errorMessage;
  startupState.step = `${startupState.step} failed`;
  startupState.updatedAt = nowIso();
}

export function markStartupFailedIfStale(maxStepMs: number): boolean {
  if (startupState.status !== 'starting') {
    return false;
  }

  const stepStartedAt = Date.parse(startupState.stepStartedAt);
  if (!Number.isFinite(stepStartedAt) || Date.now() - stepStartedAt <= maxStepMs) {
    return false;
  }

  markStartupFailed(
    `Startup step "${startupState.step}" did not finish within ${maxStepMs}ms.`,
  );
  return true;
}
