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

const settlementWaiters = new Set<() => void>();

function notifySettlementWaiters() {
  for (const resolve of settlementWaiters) {
    resolve();
  }
  settlementWaiters.clear();
}

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
  notifySettlementWaiters();
}

export function markStartupFailed(errorMessage: string) {
  startupState.status = 'failed';
  startupState.errorMessage = errorMessage;
  startupState.step = `${startupState.step} failed`;
  startupState.updatedAt = nowIso();
  notifySettlementWaiters();
}

export function waitForStartupSettlement(timeoutMs = 12000): Promise<StartupState> {
  if (startupState.status !== 'starting') {
    return Promise.resolve(startupState);
  }

  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000;

  return new Promise<StartupState>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = () => {
      if (settled) return;
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

export function resetStartupStateForTests() {
  const now = nowIso();
  startupState.status = 'starting';
  startupState.errorMessage = null;
  startupState.startedAt = now;
  startupState.updatedAt = now;
  startupState.stepStartedAt = now;
  startupState.step = 'booting';
  settlementWaiters.clear();
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
