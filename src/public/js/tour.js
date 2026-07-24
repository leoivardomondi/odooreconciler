/**
 * Onboarding Tour — Highlights key navigation items for new users.
 * Shown once per user (stored in localStorage).
 */

(function () {
  const TOUR_KEY = 'oj_tour_finance_v1';

  // Only show for finance / first-time users, not admins
  if (localStorage.getItem(TOUR_KEY)) return;

  var steps = [];
  var currentStep = 0;
  var overlay = null;
  var tooltip = null;

  function buildSteps() {
    steps = [];

    // Step 1: Operations dropdown
    var opsLink = document.querySelector('.nav-link.dropdown-toggle');
    if (opsLink && opsLink.textContent.includes('Operations')) {
      steps.push({
        target: opsLink.closest('.nav-item'),
        title: 'Operations Menu',
        text: 'Click the "Operations" menu to access M-Pesa Reconciliation — where you import M-Pesa statements and match transactions.',
        position: 'bottom',
      });
    }

    // Step 2: After they see the dropdown, explain M-Pesa
    steps.push({
      target: document.querySelector('.nav-link.dropdown-toggle')?.closest('.nav-item') || null,
      title: 'M-Pesa Reconciliation',
      text: 'Inside the Operations dropdown, select "M-Pesa Reconciliation" to upload M-Pesa PDF statements. The app automatically extracts all transactions and matches them to purchase orders and invoices.',
      position: 'bottom',
    });

    // Step 3: Only if already on the reconciliation page, show upload area
    if (window.location.pathname.startsWith('/mpesa-reconciliation')) {
      var uploadArea = document.querySelector('.mpesa-upload-form');
      if (uploadArea) {
        steps.push({
          target: uploadArea,
          title: 'Upload M-Pesa Statement',
          text: 'Upload your M-Pesa PDF statement here. The app reads every row, extracts Paid In and Withdrawn amounts, and matches transactions to POs automatically.',
          position: 'bottom',
        });
      }
    }
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,0.45);transition:opacity 0.3s;';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) nextStep();
    });
    document.body.appendChild(overlay);
  }

  function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'tour-tooltip';
    tooltip.style.cssText =
      'position:fixed;z-index:9999;max-width:340px;padding:1.25rem;border-radius:0.75rem;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,0.25);font-size:0.9rem;line-height:1.5;color:#1e293b;';
    tooltip.innerHTML =
      '<div class="tour-tooltip-title" style="font-weight:700;font-size:1rem;margin-bottom:0.5rem;color:#0f172a;"></div>' +
      '<div class="tour-tooltip-text" style="margin-bottom:1rem;"></div>' +
      '<div class="tour-tooltip-footer" style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">' +
      '<div class="tour-dots" style="display:flex;gap:0.3rem;"></div>' +
      '<div style="display:flex;gap:0.4rem;">' +
      '<button class="tour-skip btn btn-sm btn-link text-muted" style="font-size:0.8rem;">Skip</button>' +
      '<button class="tour-next btn btn-sm btn-primary" style="font-size:0.8rem;">Next →</button>' +
      '</div></div>';
    document.body.appendChild(tooltip);

    tooltip.querySelector('.tour-skip').addEventListener('click', finishTour);
    tooltip.querySelector('.tour-next').addEventListener('click', nextStep);
  }

  function positionTooltip(step) {
    if (!tooltip) return;

    var target = step.target;
    if (step.highlight) {
      target = document.querySelector(step.highlight) || target;
    }

    var rect = target ? target.getBoundingClientRect() : null;
    var top, left;

    if (rect) {
      // Highlight target
      target.style.position = 'relative';
      target.style.zIndex = '9995';
      target.style.boxShadow = '0 0 0 4px #2563eb, 0 0 0 8px rgba(37,99,235,0.25)';
      target.style.borderRadius = '8px';

      if (step.position === 'bottom') {
        top = rect.bottom + 12;
        left = Math.max(12, Math.min(rect.left + rect.width / 2 - 170, window.innerWidth - 352));
      } else {
        top = Math.max(12, rect.top - 12 - tooltip.offsetHeight);
        left = Math.max(12, Math.min(rect.left + rect.width / 2 - 170, window.innerWidth - 352));
      }
    } else {
      top = window.innerHeight / 2 - 80;
      left = window.innerWidth / 2 - 170;
    }

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  function clearHighlights() {
    document.querySelectorAll('[style*="z-index: 9995"]').forEach(function (el) {
      el.style.position = '';
      el.style.zIndex = '';
      el.style.boxShadow = '';
      el.style.borderRadius = '';
    });
  }

  function showStep(index) {
    if (index >= steps.length) {
      finishTour();
      return;
    }

    clearHighlights();
    var step = steps[index];
    tooltip.querySelector('.tour-tooltip-title').textContent = step.title;
    tooltip.querySelector('.tour-tooltip-text').textContent = step.text;

    // Update dots
    var dotsHtml = '';
    for (var i = 0; i < steps.length; i++) {
      dotsHtml +=
        '<span style="width:8px;height:8px;border-radius:50%;background:' +
        (i === index ? '#2563eb' : '#cbd5e1') +
        ';"></span>';
    }
    tooltip.querySelector('.tour-dots').innerHTML = dotsHtml;

    // Update next button
    var nextBtn = tooltip.querySelector('.tour-next');
    nextBtn.textContent = index === steps.length - 1 ? 'Got it!' : 'Next →';

    // Show/hide skip
    tooltip.querySelector('.tour-skip').style.display = index === 0 ? '' : 'none';

    positionTooltip(step);
    currentStep = index;
  }

  function nextStep() {
    showStep(currentStep + 1);
  }

  function finishTour() {
    clearHighlights();
    if (overlay) { overlay.remove(); overlay = null; }
    if (tooltip) { tooltip.remove(); tooltip = null; }
    localStorage.setItem(TOUR_KEY, '1');
  }

  // Initialize
  buildSteps();

  if (steps.length > 0) {
    createOverlay();
    createTooltip();
    showStep(0);
  }
})();
