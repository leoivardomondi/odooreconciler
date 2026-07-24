import { Request, Response, Router } from 'express';
import { body, validationResult } from 'express-validator';
import {
  getApprovedAuthUserByEmail,
  getApprovedAuthUsers,
  getAuthUserLastSeenByEmail,
  getRecentAuthLoginEvents,
  upsertApprovedAuthUser,
} from '../models/repositories';
import { AppFeature } from '../models/types';
import {
  APPROVED_USER_PASSWORD_MIN_LENGTH,
  AUTH_ROLES,
  getAuthRoleLabel,
  hashApprovedUserPassword,
  isAllowedEmailDomain,
  normalizeAuthRole,
  normalizeEmailAddress,
} from '../services/authService';
import { logEvent } from '../services/logService';
import { resolveLocalUserDisplayName } from '../services/userIdentityService';
import { syncApprovedUserProfilesFromOdoo } from '../services/userProfileSyncService';

const router = Router();

const validators = [
  body('email').trim().isEmail().withMessage('Enter a valid work email address.'),
  body('role').trim().isIn(AUTH_ROLES).withMessage('Choose a valid role.'),
  body('apps')
    .optional()
    .custom((value) => typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')))
    .withMessage('Choose valid access points.'),
  body('active').optional({ values: 'falsy' }).trim(),
  body('password')
    .optional({ values: 'falsy' })
    .isLength({ min: APPROVED_USER_PASSWORD_MIN_LENGTH })
    .withMessage(`Password must be at least ${APPROVED_USER_PASSWORD_MIN_LENGTH} characters.`),
];

async function renderAccessPage(
  res: Response,
  options: {
    status?: { type: string; message: string } | null;
    validationErrors?: Array<{ msg: string }>;
    form?: { email?: string; role?: string; apps?: AppFeature[]; active?: string; password?: string };
    selectedEmail?: string;
  } = {},
) {
  const [users, loginEvents, lastSeenByEmail] = await Promise.all([
    getApprovedAuthUsers(),
    getRecentAuthLoginEvents(80),
    getAuthUserLastSeenByEmail(),
  ]);
  const identityEmails = [...new Set([...users.map((user) => user.email), ...loginEvents.map((event) => event.email || '')].filter(Boolean))];
  const displayNamesByEmail = Object.fromEntries(await Promise.all(identityEmails.map(async (email) => [email, await resolveLocalUserDisplayName(email)])));
  const selectedEmail = normalizeEmailAddress(options.selectedEmail || options.form?.email || '');
  const selectedUser = users.find((user) => user.email === selectedEmail) || null;
  res.render('access-control', {
    pageTitle: 'Access Control',
    status: options.status || null,
    validationErrors: options.validationErrors || [],
    users,
    selectedUser,
    selectedEmail,
    lastSeenByEmail,
    loginEvents,
    displayNamesByEmail,
    roles: AUTH_ROLES,
    getAuthRoleLabel,
    availableApps: ['mpesa', 'po-automation', 'purchase-orders', 'sales-orders', 'invoice-parser', 'extractions', 'shop-floor', 'shop-floor-admin', 'jobs'],
    form: {
      email: options.form?.email || selectedUser?.email || '',
      role: normalizeAuthRole(options.form?.role || selectedUser?.role || 'user'),
      apps: options.form?.apps || selectedUser?.apps || [],
      active: options.form?.active !== undefined ? options.form.active !== 'off' : selectedUser?.active !== false,
      password: options.form?.password || '',
    },
    passwordMinLength: APPROVED_USER_PASSWORD_MIN_LENGTH,
  });
}

router.get('/settings/access', async (req, res) => {
  await renderAccessPage(res, { selectedEmail: String(req.query.user || '') });
});

router.post('/settings/access/sync-names', async (req, res) => {
  if (req.authUser?.role !== 'admin') { res.status(403).send('Administrator access required.'); return; }
  try {
    const result = await syncApprovedUserProfilesFromOdoo();
    res.redirect('/settings/access?message=' + encodeURIComponent(`Saved ${result.matched} Odoo employee name(s) locally. ${result.unmatched} unmatched; ${result.failed} failed.`));
  } catch (error) {
    res.redirect('/settings/access?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Could not synchronize Odoo names.'));
  }
});

router.post('/settings/access', validators, async (req: Request, res: Response) => {
  const errors = validationResult(req);
  const email = normalizeEmailAddress(String(req.body.email || ''));
  const role = normalizeAuthRole(String(req.body.role || 'user'));
  let apps: AppFeature[] = [];
  if (typeof req.body.apps === 'string') {
    apps = [req.body.apps as AppFeature];
  } else if (Array.isArray(req.body.apps)) {
    apps = req.body.apps.filter((a: any) => typeof a === 'string') as AppFeature[];
  }
  const active = req.body.active === 'on';
  const password = String(req.body.password || '');

  if (!errors.isEmpty()) {
    return renderAccessPage(res.status(422), {
      status: { type: 'danger', message: 'Please fix the access control form.' },
      validationErrors: errors.array().map((error) => ({
        msg: error.msg === 'Invalid value' ? `Invalid ${String((error as { path?: string }).path || 'form field')}.` : error.msg,
      })),
      form: { email, role, apps, active: active ? 'on' : 'off', password: '' },
    });
  }

  if (!isAllowedEmailDomain(email) && role !== 'admin' && role !== 'user' && !apps.includes('shop-floor')) {
    return renderAccessPage(res.status(422), {
      status: { type: 'danger', message: 'Gmail and other personal addresses are allowed only for Shop Operator access.' },
      validationErrors: [],
      form: { email, role, apps, active: active ? 'on' : 'off', password: '' },
    });
  }

  const passwordHash = password ? await hashApprovedUserPassword(password) : null;
  await upsertApprovedAuthUser(email, role, apps, active, passwordHash);
  await logEvent('info', 'Access control user saved', {
    email,
    role,
    apps,
    active,
    passwordChanged: Boolean(passwordHash),
  });

  return renderAccessPage(res, {
    status: {
      type: 'success',
      message: passwordHash
        ? `Access and password saved for ${email}.`
        : `Access saved for ${email}.`,
    },
    selectedEmail: email,
  });
});

// ─── Login As (Admin Impersonation) ─────────────────────────────────

const IMPERSONATE_COOKIE = 'oj_impersonate';

router.post('/settings/access/login-as', async (req: Request, res: Response) => {
  const isAdmin = req.authUser?.role === 'admin';
  const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');

  if (!isAdmin && !isShopFloorAdmin) {
    res.status(403).redirect('/dashboard');
    return;
  }

  const redirectOnError = isAdmin ? '/settings/access' : '/shop-floor/operators';

  const targetEmail = normalizeEmailAddress(String(req.body.email || ''));
  if (!targetEmail || !targetEmail.includes('@')) {
    res.redirect(redirectOnError + '?error=' + encodeURIComponent('Invalid email.'));
    return;
  }

  const targetUser = await getApprovedAuthUserByEmail(targetEmail);
  const role = normalizeAuthRole(req.body.role || targetUser?.role || 'user');
  const apps = targetUser?.apps || [];

  // Store impersonation in a plain cookie
  res.cookie(IMPERSONATE_COOKIE, JSON.stringify({ email: targetEmail, role, apps }), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  });

  void logEvent('info', 'Admin logged in as user', {
    adminEmail: req.authUser?.email || '',
    targetEmail,
  });

  res.redirect('/dashboard?message=' + encodeURIComponent(`Now previewing the app as ${targetEmail}.`));
});

router.get('/auth/return-to-admin', async (_req: Request, res: Response) => {
  res.clearCookie(IMPERSONATE_COOKIE, { path: '/' });
  res.redirect('/dashboard');
});

export default router;
