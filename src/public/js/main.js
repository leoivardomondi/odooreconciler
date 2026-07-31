function ensureCsrfHiddenFields() {
  const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
  if (!(csrfTokenMeta instanceof HTMLMetaElement) || !csrfTokenMeta.content) {
    return;
  }

  const forms = document.querySelectorAll('form[method="post"], form[method="POST"]');
  forms.forEach((form) => {
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    let csrfInput = form.querySelector('input[name="_csrf"]');
    if (!(csrfInput instanceof HTMLInputElement)) {
      csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = '_csrf';
      form.appendChild(csrfInput);
    }

    csrfInput.value = csrfTokenMeta.content;
  });
}

function ensureAppLoadingOverlay() {
  let overlay = document.querySelector('[data-app-loading-overlay]');
  if (overlay instanceof HTMLElement) {
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.className = 'app-loading-overlay';
  overlay.setAttribute('data-app-loading-overlay', 'true');
  overlay.innerHTML = `
    <div class="app-loading-card" role="status" aria-live="polite">
      <span class="app-loading-spinner" aria-hidden="true"></span>
      <span class="app-loading-message">Working...</span>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function showAppLoading(message) {
  const overlay = ensureAppLoadingOverlay();
  const messageElement = overlay.querySelector('.app-loading-message');
  if (messageElement instanceof HTMLElement) {
    messageElement.textContent = message || 'Working...';
  }
  window.requestAnimationFrame(() => {
    overlay.classList.add('is-visible');
  });
  window.clearTimeout(window.__appLoadingSafetyTimer);
  window.__appLoadingSafetyTimer = window.setTimeout(() => {
    overlay.classList.remove('is-visible');
  }, 15000);
}

function hideAppLoading() {
  window.clearTimeout(window.__appLoadingSafetyTimer);
  const overlay = document.querySelector('[data-app-loading-overlay]');
  if (overlay instanceof HTMLElement) overlay.classList.remove('is-visible');
}

window.addEventListener('pageshow', hideAppLoading);
window.addEventListener('pagehide', () => window.clearTimeout(window.__appLoadingSafetyTimer));

function shouldShowLinkLoading(event, anchor) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (anchor.classList.contains('disabled') || anchor.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  if (anchor.target && anchor.target.toLowerCase() !== '_self') {
    return false;
  }
  if (anchor.hasAttribute('download')) {
    return false;
  }
  const href = anchor.getAttribute('href') || '';
  return Boolean(href) && href !== '#';
}

function beginInstantNavigation(anchor) {
  const label = (anchor.textContent || 'Page').replace(/\s+/g, ' ').trim();
  const nav = anchor.closest('.main-nav');
  if (nav) {
    nav.querySelectorAll('.nav-link.active').forEach((link) => link.classList.remove('active'));
    const topLevelLink = anchor.classList.contains('nav-link')
      ? anchor
      : anchor.closest('.dropdown')?.querySelector('.nav-link');
    if (topLevelLink instanceof HTMLElement) topLevelLink.classList.add('active');
  }

  const main = document.querySelector('main');
  if (!(main instanceof HTMLElement)) return;
  main.setAttribute('aria-busy', 'true');
  main.classList.add('instant-page-shell');
  main.innerHTML = `
    <section class="instant-page-loading" role="status" aria-live="polite">
      <div class="instant-page-loading__heading">
        <span class="instant-page-loading__spinner" aria-hidden="true"></span>
        <div>
          <p class="instant-page-loading__eyebrow">Opening</p>
          <h1>${label.replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
          })[character])}</h1>
          <p>Your menu is ready. The latest data is loading now.</p>
        </div>
      </div>
      <div class="instant-page-loading__grid" aria-hidden="true">
        <span class="instant-page-loading__card instant-page-loading__card--wide"></span>
        <span class="instant-page-loading__card"></span>
        <span class="instant-page-loading__card"></span>
        <span class="instant-page-loading__card instant-page-loading__card--wide"></span>
      </div>
    </section>
  `;
}

function markSubmitterLoading(submitter, message) {
  if (submitter instanceof HTMLButtonElement) {
    if (!submitter.dataset.originalText) {
      submitter.dataset.originalText = submitter.textContent || '';
    }
    submitter.classList.add('is-loading');
    submitter.textContent = submitter.getAttribute('data-loading-label') || message || 'Working...';
  }

  if (submitter instanceof HTMLInputElement && submitter.type === 'submit') {
    if (!submitter.dataset.originalValue) {
      submitter.dataset.originalValue = submitter.value || '';
    }
    submitter.classList.add('is-loading');
    submitter.value = submitter.getAttribute('data-loading-label') || message || 'Working...';
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const copyTrigger = target.closest('[data-copy-target]');
  const copyTargetId = copyTrigger instanceof HTMLElement ? copyTrigger.getAttribute('data-copy-target') : '';
  if (copyTargetId) {
    const source = document.getElementById(copyTargetId);
    if (!source) {
      return;
    }

    try {
      await navigator.clipboard.writeText(source.textContent || '');
      const originalLabel = copyTrigger.textContent;
      copyTrigger.textContent = 'Copied';
      window.setTimeout(() => {
        copyTrigger.textContent = originalLabel;
      }, 1200);
    } catch (_error) {
      window.alert('Could not copy the JSON payload.');
    }
  }

  const refreshTrigger = target.closest('[data-app-refresh]');
  if (refreshTrigger instanceof HTMLElement) {
    event.preventDefault();
    showAppLoading(refreshTrigger.getAttribute('data-loading-message') || 'Refreshing app...');
    window.location.reload();
    return;
  }

  const instantNavLink = target.closest('a[data-instant-nav]');
  if (
    instantNavLink instanceof HTMLAnchorElement
    && shouldShowLinkLoading(event, instantNavLink)
    && instantNavLink.origin === window.location.origin
  ) {
    const destination = new URL(instantNavLink.href);
    const current = new URL(window.location.href);
    if (destination.pathname !== current.pathname || destination.search !== current.search) {
      event.preventDefault();
      beginInstantNavigation(instantNavLink);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => window.location.assign(destination.href));
      });
      return;
    }
  }

  const loadingLink = target.closest('a[data-loading-message]');
  if (loadingLink instanceof HTMLAnchorElement && shouldShowLinkLoading(event, loadingLink)) {
    showAppLoading(loadingLink.getAttribute('data-loading-message') || 'Loading...');
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const submitter = event.submitter instanceof HTMLElement ? event.submitter : null;

  const message = submitter?.getAttribute('data-confirm') || form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
    return;
  }

  const loadingDisabled = form.getAttribute('data-no-loading') === 'true';
  const loadingMessage = submitter?.getAttribute('data-loading-message') || form.getAttribute('data-loading-message') || 'Submitting, please wait...';
  if (!loadingDisabled) {
    showAppLoading(loadingMessage);
    if (submitter) {
      markSubmitterLoading(submitter, loadingMessage);
    }
  }

  if (form.getAttribute('data-disable-submit') === 'true') {
    const buttons = form.querySelectorAll('button, input[type="submit"]');
    buttons.forEach((button) => {
      if (button instanceof HTMLButtonElement || button instanceof HTMLInputElement) {
        button.disabled = true;
      }
    });
  }
});

function mpesaReviewBadgeClass(value) {
  if (value === 'reviewed' || value === 'verified') return 'success';
  if (value === 'ignored') return 'secondary';
  if (value === 'needs_followup') return 'warning';
  return 'info';
}

function applyMpesaReviewSelectColor(select) {
  const statuses = ['new', 'reviewed', 'verified', 'ignored', 'needs_followup'];
  statuses.forEach((status) => {
    select.classList.remove(`mpesa-review-${status}`);
  });
  const status = statuses.includes(select.value) ? select.value : 'new';
  select.classList.add(`mpesa-review-${status}`);

  const badge = select.parentElement?.querySelector('.badge');
  if (badge instanceof HTMLElement) {
    badge.className = `badge text-bg-${mpesaReviewBadgeClass(status)} mt-1`;
    badge.textContent = status;
  }
}

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.classList.contains('mpesa-review-select')) {
    applyMpesaReviewSelectColor(target);
  }

  if (target instanceof HTMLSelectElement && target.name === 'mailPreset') {
    syncMailPresetControls();
  }
});

function setMailCheckbox(name, checked) {
  const input = document.querySelector(`[name="${name}"]`);
  if (input instanceof HTMLInputElement) {
    input.checked = checked;
  }
}

function setMailField(name, value) {
  const input = document.querySelector(`[name="${name}"]`);
  if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) {
    input.value = value;
  }
}

function syncMailPresetControls() {
  const preset = document.querySelector('select[name="mailPreset"]');
  if (!(preset instanceof HTMLSelectElement)) {
    return;
  }

  if (preset.value === 'zoho-587') {
    setMailField('mailHost', 'smtp.zoho.com');
    setMailField('mailPort', '587');
    setMailCheckbox('mailSecure', false);
    setMailCheckbox('mailRequireTls', true);
    setMailCheckbox('mailIgnoreTls', false);
  }

  if (preset.value === 'zoho-465') {
    setMailField('mailHost', 'smtp.zoho.com');
    setMailField('mailPort', '465');
    setMailCheckbox('mailSecure', true);
    setMailCheckbox('mailRequireTls', false);
    setMailCheckbox('mailIgnoreTls', false);
  }

  if (preset.value === 'cpanel-465') {
    setMailField('mailPort', '465');
    setMailCheckbox('mailSecure', true);
    setMailCheckbox('mailRequireTls', false);
    setMailCheckbox('mailIgnoreTls', false);
  }
}

function clearSensitiveFieldsOnLoad() {
  const sensitiveFields = document.querySelectorAll('[data-clear-sensitive-field="true"]');
  sensitiveFields.forEach((field) => {
    if (field instanceof HTMLInputElement) {
      field.value = '';
    }
  });
}

function setupMpesaStatementColumnToggle() {
  const table = document.querySelector('[data-mpesa-grid]');
  const toggle = document.querySelector('[data-mpesa-column-toggle]');
  if (!(table instanceof HTMLTableElement) || !(toggle instanceof HTMLButtonElement)) {
    return;
  }

  const collapsedLabel = toggle.getAttribute('data-collapsed-label') || 'Expand statement columns';
  const expandedLabel = toggle.getAttribute('data-expanded-label') || 'Minimize statement columns';
  const syncToggle = () => {
    const isCollapsed = table.classList.contains('mpesa-grid-statement-collapsed');
    toggle.textContent = isCollapsed ? collapsedLabel : expandedLabel;
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
  };

  toggle.addEventListener('click', () => {
    table.classList.toggle('mpesa-grid-statement-collapsed');
    syncToggle();
  });

  syncToggle();
}

function setupMpesaColumnResizing() {
  const table = document.querySelector('[data-mpesa-grid]');
  if (!(table instanceof HTMLTableElement)) {
    return;
  }

  const cols = Array.from(table.querySelectorAll('colgroup col'));
  const headerRows = Array.from(table.tHead?.rows || []);
  if (!cols.length || headerRows.length < 2) {
    return;
  }

  const storageKey = `mpesa-grid-column-widths:v3:${table.id || 'transactions'}`;
  const minimumWidths = cols.map((_, index) => (index === 0 ? 48 : 56));
  const getLeafHeaders = () => {
    const rowNumberHeader = headerRows[0]?.querySelector('th[rowspan]');
    const statementHeaders = Array.from(headerRows[1]?.cells || []);
    return [rowNumberHeader, ...statementHeaders].filter((cell) => cell instanceof HTMLTableCellElement);
  };

  const getSavedWidths = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (_error) {
      return [];
    }
  };

  const saveWidths = () => {
    try {
      const widths = cols.map((col) => Math.round(col.getBoundingClientRect().width));
      window.localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch (_error) {
      // Column resizing remains usable for this page load when storage is unavailable.
    }
  };

  const setColumnWidth = (index, width) => {
    const col = cols[index];
    if (!col) {
      return;
    }

    const nextWidth = Math.max(minimumWidths[index] || 56, Math.round(width));
    col.style.width = `${nextWidth}px`;
  };

  getSavedWidths().forEach((width, index) => {
    if (Number.isFinite(width) && width > 0) {
      setColumnWidth(index, width);
    }
  });

  getLeafHeaders().forEach((header, index) => {
    if (index >= cols.length || header.querySelector('.mpesa-column-resizer')) {
      return;
    }

    header.classList.add('mpesa-resizable-header');
    const grip = document.createElement('span');
    grip.className = 'mpesa-column-resizer';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', `Resize ${header.textContent?.trim() || 'column'} column`);
    header.appendChild(grip);

    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = cols[index].getBoundingClientRect().width || header.getBoundingClientRect().width;
      grip.setPointerCapture(event.pointerId);
      table.classList.add('mpesa-grid-resizing');
      header.classList.add('mpesa-column-resizing');

      const handlePointerMove = (moveEvent) => {
        setColumnWidth(index, startWidth + moveEvent.clientX - startX);
      };

      const handlePointerUp = (upEvent) => {
        saveWidths();
        table.classList.remove('mpesa-grid-resizing');
        header.classList.remove('mpesa-column-resizing');
        grip.releasePointerCapture(upEvent.pointerId);
        grip.removeEventListener('pointermove', handlePointerMove);
        grip.removeEventListener('pointerup', handlePointerUp);
        grip.removeEventListener('pointercancel', handlePointerUp);
      };

      grip.addEventListener('pointermove', handlePointerMove);
      grip.addEventListener('pointerup', handlePointerUp);
      grip.addEventListener('pointercancel', handlePointerUp);
    });
  });
}

function setupWindowControlsOverlay() {
  const titlebar = document.querySelector('[data-window-titlebar]');
  const controlsOverlay = 'windowControlsOverlay' in navigator ? navigator.windowControlsOverlay : null;

  if (!(titlebar instanceof HTMLElement)) {
    return;
  }

  const syncTitlebar = () => {
    const isVisible = Boolean(controlsOverlay && controlsOverlay.visible);
    document.documentElement.classList.toggle('has-window-controls-overlay', isVisible);
    titlebar.setAttribute('aria-hidden', String(!isVisible));
  };

  if (!controlsOverlay) {
    syncTitlebar();
    return;
  }

  controlsOverlay.addEventListener('geometrychange', syncTitlebar);
  syncTitlebar();
}

let deferredPwaInstallPrompt = null;

function isAppInstalledDisplayMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true
  );
}

async function requestCoreAppPermissions() {
  if ('Notification' in window && Notification.permission === 'default' && typeof Notification.requestPermission === 'function') {
    await Notification.requestPermission().catch(() => null);
  }

  await refreshAppPermissionsPrompt();
}

function setupPwaInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPwaInstallPrompt = event;
    refreshAppPermissionsPrompt();
  });

  window.addEventListener('appinstalled', () => {
    deferredPwaInstallPrompt = null;
    window.localStorage.removeItem('app-permissions-dismissed-until');
    window.setTimeout(() => {
      refreshAppPermissionsPrompt();
      setupAppPermissionsPrompt();
    }, 300);
  });
}

function getPermissionState(name) {
  if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
    return Promise.resolve('prompt');
  }

  return navigator.permissions.query({ name }).then((status) => status.state).catch(() => 'prompt');
}

async function getAppPermissionSnapshot() {
  const notificationState = 'Notification' in window ? Notification.permission : 'unsupported';

  return {
    notifications: notificationState,
    installed: isAppInstalledDisplayMode(),
  };
}

function permissionLabel(state) {
  if (state === 'granted') return 'Allowed';
  if (state === 'denied') return 'Blocked';
  if (state === 'unsupported') return 'Not supported';
  return 'Needs permission';
}

function permissionClass(state) {
  if (state === 'granted') return 'is-granted';
  if (state === 'denied' || state === 'unsupported') return 'is-blocked';
  return 'is-needed';
}

function dismissAppPermissionsPrompt(days) {
  const prompt = document.querySelector('[data-app-permissions-prompt]');
  if (prompt instanceof HTMLElement) {
    prompt.remove();
  }
  document.body.classList.remove('app-permissions-gate-active');
  window.localStorage.setItem('app-permissions-dismissed-until', String(Date.now() + days * 24 * 60 * 60 * 1000));
}

function setAppPermissionsGateActive(active) {
  document.body.classList.toggle('app-permissions-gate-active', active);
}

async function refreshAppPermissionsPrompt() {
  const prompt = document.querySelector('[data-app-permissions-prompt]');
  if (!(prompt instanceof HTMLElement)) {
    setAppPermissionsGateActive(false);
    return;
  }

  const snapshot = await getAppPermissionSnapshot();
  const notificationBadge = prompt.querySelector('[data-permission-state="notifications"]');
  const installBadge = prompt.querySelector('[data-permission-state="install"]');
  const installButton = prompt.querySelector('[data-request-install]');
  const notifyButton = prompt.querySelector('[data-request-notifications]');
  const closeButton = prompt.querySelector('[data-close-permissions]');

  if (notificationBadge instanceof HTMLElement) {
    notificationBadge.textContent = permissionLabel(snapshot.notifications);
    notificationBadge.className = `app-permission-status ${permissionClass(snapshot.notifications)}`;
  }

  if (installBadge instanceof HTMLElement) {
    installBadge.textContent = snapshot.installed ? 'Installed' : 'Install app';
    installBadge.className = `app-permission-status ${snapshot.installed ? 'is-granted' : 'is-needed'}`;
  }

  if (installButton instanceof HTMLButtonElement) {
    installButton.disabled = snapshot.installed;
  }

  if (notifyButton instanceof HTMLButtonElement) {
    notifyButton.disabled = snapshot.notifications === 'granted' || snapshot.notifications === 'denied' || snapshot.notifications === 'unsupported';
  }

  if (closeButton instanceof HTMLButtonElement) {
    closeButton.disabled = false;
    closeButton.setAttribute('aria-disabled', 'false');
    closeButton.textContent = 'Close';
    closeButton.title = 'Remind me later';
  }

  const ready = snapshot.notifications === 'granted' && snapshot.installed;
  setAppPermissionsGateActive(false);
  if (ready) {
    dismissAppPermissionsPrompt(90);
  }
}

function setupAppPermissionsPrompt() {
  if (document.querySelector('[data-app-permissions-prompt]')) {
    return;
  }

  window.setTimeout(async () => {
    const dismissedUntil = Number(window.localStorage.getItem('app-permissions-dismissed-until') || '0');
    if (dismissedUntil > Date.now()) {
      setAppPermissionsGateActive(false);
      return;
    }

    const snapshot = await getAppPermissionSnapshot();
    if (snapshot.notifications === 'granted' && snapshot.installed) {
      setAppPermissionsGateActive(false);
      return;
    }

    const prompt = document.createElement('aside');
    prompt.className = 'app-permissions-prompt';
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-label', 'App permissions');
    prompt.setAttribute('data-app-permissions-prompt', 'true');
    prompt.innerHTML = `
      <div class="app-permissions-panel app-card">
        <div class="app-permissions-header">
          <div>
            <strong>Get the app</strong>
            <span>Optional: install it or enable notifications for quicker access.</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary app-permissions-close" data-close-permissions title="Remind me later">Close</button>
        </div>
        <div class="app-permissions-grid">
          <div class="app-permission-row">
            <div>
              <strong>Install app</strong>
              <span>Add Urban Vibe Reconcile to your phone or desktop.</span>
            </div>
            <span class="app-permission-status" data-permission-state="install">Checking</span>
            <button type="button" class="btn btn-sm btn-primary" data-request-install>Install</button>
          </div>
          <div class="app-permission-row">
            <div>
              <strong>Notifications</strong>
              <span>Receive alerts and reminders from the app.</span>
            </div>
            <span class="app-permission-status" data-permission-state="notifications">Checking</span>
            <button type="button" class="btn btn-sm btn-primary" data-request-notifications>Allow</button>
          </div>
        </div>
        <div class="app-permissions-note">
          You can continue using the website without installing the app or enabling notifications.
        </div>
      </div>
    `;

    document.body.appendChild(prompt);
    setAppPermissionsGateActive(false);
    refreshAppPermissionsPrompt();
  }, 8000);

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('[data-request-install]')) {
      if (deferredPwaInstallPrompt && typeof deferredPwaInstallPrompt.prompt === 'function') {
        deferredPwaInstallPrompt.prompt();
        const choice = await deferredPwaInstallPrompt.userChoice.catch(() => null);
        deferredPwaInstallPrompt = null;
        if (choice && choice.outcome === 'accepted') {
          window.localStorage.removeItem('app-permissions-dismissed-until');
          await refreshAppPermissionsPrompt();
          await requestCoreAppPermissions();
        }
        await refreshAppPermissionsPrompt();
      } else {
        window.alert('Use your browser menu to install this app.');
      }
      return;
    }

    if (target.closest('[data-request-notifications]')) {
      if ('Notification' in window && typeof Notification.requestPermission === 'function') {
        await Notification.requestPermission().catch(() => null);
      }
      await refreshAppPermissionsPrompt();
      return;
    }

    if (target.closest('[data-close-permissions]')) {
      dismissAppPermissionsPrompt(30);
      return;
    }
  });
}

function formatMpesaReviewCount(count) {
  return count > 99 ? '99+' : String(count);
}

function setMpesaReviewCount(count) {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  document.querySelectorAll('[data-mpesa-review-badge]').forEach((badge) => {
    if (!(badge instanceof HTMLElement)) {
      return;
    }

    badge.textContent = formatMpesaReviewCount(safeCount);
    badge.hidden = safeCount <= 0;
    badge.setAttribute('aria-label', `${safeCount} M-Pesa statement(s) need review`);
  });
}

async function syncPwaAppBadge(nextCount) {
  const marker = document.querySelector('[data-pwa-badge-count]');
  const count = Number.isFinite(nextCount)
    ? nextCount
    : marker instanceof HTMLElement
      ? Number(marker.getAttribute('data-pwa-badge-count') || '0')
      : 0;
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

  try {
    if (safeCount > 0 && 'setAppBadge' in navigator) {
      await navigator.setAppBadge(safeCount);
      return;
    }

    if ('clearAppBadge' in navigator) {
      await navigator.clearAppBadge();
    }
  } catch (_error) {
    // App badge support depends on the installed PWA browser and OS shell.
  }
}

function setPwaBadgeCount(count) {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const marker = document.querySelector('[data-pwa-badge-count]');
  if (marker instanceof HTMLElement) {
    marker.setAttribute('data-pwa-badge-count', String(safeCount));
  }

  return safeCount;
}

function setupPwaBadgeRefresh() {
  if (!document.querySelector('[data-pwa-badge-count]')) {
    return;
  }

  let inFlight = false;
  const refreshCount = async () => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    try {
      const response = await fetch('/notifications/due-tasks-count', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const totalCount = Number(payload && payload.totalCount);
      const mpesaCount = Number(payload && payload.mpesaCount);
      const safeTotalCount = setPwaBadgeCount(totalCount);
      setMpesaReviewCount(mpesaCount);
      await syncPwaAppBadge(safeTotalCount);
    } catch (_error) {
      // The next poll or page refresh will sync the count again.
    } finally {
      inFlight = false;
    }
  };

  refreshCount();
  window.setInterval(refreshCount, 30000);
  window.addEventListener('focus', refreshCount);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshCount();
    }
  });
}

function getSeenExpectedBoardAlerts() {
  try {
    const raw = window.localStorage.getItem('seen-expected-board-alerts') || '[]';
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (_error) {
    return new Set();
  }
}

function saveSeenExpectedBoardAlerts(seen) {
  try {
    window.localStorage.setItem('seen-expected-board-alerts', JSON.stringify(Array.from(seen).slice(-300)));
  } catch (_error) {
    // Notifications still work for the current page even if local storage is blocked.
  }
}

async function showExpectedBoardNotification(alert, totalNew) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const title = totalNew > 1
    ? `${totalNew} expected board alerts`
    : 'Expected boards need logging';
  const body = alert && alert.message
    ? `${alert.message} ${alert.moName || ''}`.trim()
    : 'New boards are expected. Count first, then key in incoming boards.';
  const options = {
    body,
    icon: '/public/icons/urban-vibe-pwa-dark.png',
    badge: '/public/icons/urban-vibe-favicon.png',
    tag: alert && alert.id ? `expected-board:${alert.id}` : 'expected-board-alert',
    renotify: true,
    data: { url: '/shop-floor?refresh=true' },
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, options);
        return;
      }
    }

    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.location.href = '/shop-floor?refresh=true';
    };
  } catch (_error) {
    // Browsers can reject notifications depending on device policy or focus state.
  }
}

function setupExpectedBoardAlertNotifications() {
  if (!('Notification' in window)) {
    return;
  }

  let inFlight = false;
  const poll = async () => {
    if (inFlight || Notification.permission !== 'granted') {
      return;
    }

    inFlight = true;
    try {
      const response = await fetch('/shop-floor/stock-alerts/notifications', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const alerts = Array.isArray(payload && payload.alerts) ? payload.alerts : [];
      if (!alerts.length) {
        return;
      }

      const seen = getSeenExpectedBoardAlerts();
      const newAlerts = alerts.filter((alert) => alert && alert.id && !seen.has(String(alert.id)));
      alerts.forEach((alert) => {
        if (alert && alert.id) {
          seen.add(String(alert.id));
        }
      });
      saveSeenExpectedBoardAlerts(seen);

      if (!newAlerts.length) {
        return;
      }

      await showExpectedBoardNotification(newAlerts[0], newAlerts.length);
    } catch (_error) {
      // The next poll will retry.
    } finally {
      inFlight = false;
    }
  };

  window.setTimeout(poll, 5000);
  window.setInterval(poll, 60000);
  window.addEventListener('focus', poll);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      poll();
    }
  });
}

function setupHourlyShopFloorTaskNotifications() {
  if (!('Notification' in window)) return;

  const poll = async () => {
    if (Notification.permission !== 'granted') return;
    try {
      const response = await fetch('/notifications/shop-floor-tasks', {
        headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = await response.json();
      const tasks = Array.isArray(payload && payload.tasks) ? payload.tasks : [];
      if (!tasks.length) return;
      const first = tasks[0];
      const hourKey = new Date().toISOString().slice(0, 13);
      const localDateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const isDailyTask = first.id === 'upload-mpesa-statement';
      const storageKey = isDailyTask ? `daily-task:${first.id}:${localDateKey}` : `shop-floor-hourly-tasks:${hourKey}`;
      if (window.localStorage.getItem(storageKey) === 'shown') return;
      window.localStorage.setItem(storageKey, 'shown');
      const options = {
        body: tasks.length === 1 ? first.detail : `${first.detail} Plus ${tasks.length - 1} more pending task(s).`,
        icon: '/public/icons/urban-vibe-pwa-dark.png',
        badge: '/public/icons/urban-vibe-favicon.png',
        tag: isDailyTask ? `daily-task:${first.id}:${localDateKey}` : `shop-floor-hourly:${hourKey}`,
        renotify: true,
        data: { url: first.url || '/shop-floor?refresh=true' },
      };
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(first.title || 'Shop-floor tasks pending', options);
      } else {
        new Notification(first.title || 'Shop-floor tasks pending', options);
      }
    } catch (_error) {
      // Retry on the next hourly poll.
    }
  };

  window.setTimeout(poll, 8000);
  window.setInterval(poll, 60 * 60 * 1000);
}

document.documentElement.setAttribute('data-theme', 'light');
try {
  window.localStorage.removeItem('app-theme');
} catch (_error) {
  // Light theme remains enforced without local storage.
}
ensureCsrfHiddenFields();
document.querySelectorAll('.mpesa-review-select').forEach((select) => {
  if (select instanceof HTMLSelectElement) {
    applyMpesaReviewSelectColor(select);
  }
});
setupMpesaStatementColumnToggle();
setupMpesaColumnResizing();
setupWindowControlsOverlay();
setupPwaInstallPrompt();
setupAppPermissionsPrompt();
clearSensitiveFieldsOnLoad();
syncPwaAppBadge();
setupPwaBadgeRefresh();
setupExpectedBoardAlertNotifications();
setupHourlyShopFloorTaskNotifications();
setupConfirmDialogs();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // The app remains fully usable without the install/offline shell.
    });
  });
}

// ─── Confirmation Dialog (replaces browser confirm()) ──────────────

function setupConfirmDialogs() {
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-confirm]');
    if (!form) return;

    var message = form.getAttribute('data-confirm');
    if (!message) return;
    var submitter = e.submitter || null;

    e.preventDefault();
    e.stopImmediatePropagation();

    // Remove any existing overlay
    var existing = document.querySelector('.confirm-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML =
      '<div class="confirm-dialog">' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<div class="confirm-dialog-footer">' +
      '<button class="btn btn-outline-secondary btn-sm confirm-cancel">Cancel</button>' +
      '<button class="btn btn-primary btn-sm confirm-ok">Confirm</button>' +
      '</div>' +
      '</div>';

    overlay.querySelector('.confirm-cancel').addEventListener('click', function () {
      overlay.remove();
    });

    overlay.querySelector('.confirm-ok').addEventListener('click', function () {
      overlay.remove();
      form.removeAttribute('data-confirm');
      form.removeAttribute('onsubmit');
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit(submitter);
      } else {
        form.submit();
      }
    });

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }, true);
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
