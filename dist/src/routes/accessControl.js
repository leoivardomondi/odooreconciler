"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const repositories_1 = require("../models/repositories");
const authService_1 = require("../services/authService");
const logService_1 = require("../services/logService");
const userIdentityService_1 = require("../services/userIdentityService");
const userProfileSyncService_1 = require("../services/userProfileSyncService");
const router = (0, express_1.Router)();
const validators = [
    (0, express_validator_1.body)('email').trim().isEmail().withMessage('Enter a valid work email address.'),
    (0, express_validator_1.body)('role').trim().isIn(authService_1.AUTH_ROLES).withMessage('Choose a valid role.'),
    (0, express_validator_1.body)('apps')
        .optional()
        .custom((value) => typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')))
        .withMessage('Choose valid access points.'),
    (0, express_validator_1.body)('active').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('password')
        .optional({ values: 'falsy' })
        .isLength({ min: authService_1.APPROVED_USER_PASSWORD_MIN_LENGTH })
        .withMessage(`Password must be at least ${authService_1.APPROVED_USER_PASSWORD_MIN_LENGTH} characters.`),
];
async function renderAccessPage(res, options = {}) {
    const [users, loginEvents, lastSeenByEmail] = await Promise.all([
        (0, repositories_1.getApprovedAuthUsers)(),
        (0, repositories_1.getRecentAuthLoginEvents)(80),
        (0, repositories_1.getAuthUserLastSeenByEmail)(),
    ]);
    const identityEmails = [...new Set([...users.map((user) => user.email), ...loginEvents.map((event) => event.email || '')].filter(Boolean))];
    const displayNamesByEmail = Object.fromEntries(await Promise.all(identityEmails.map(async (email) => [email, await (0, userIdentityService_1.resolveLocalUserDisplayName)(email)])));
    const selectedEmail = (0, authService_1.normalizeEmailAddress)(options.selectedEmail || options.form?.email || '');
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
        roles: authService_1.AUTH_ROLES,
        getAuthRoleLabel: authService_1.getAuthRoleLabel,
        availableApps: ['mpesa', 'po-automation', 'purchase-orders', 'sales-orders', 'invoice-parser', 'extractions', 'shop-floor', 'shop-floor-admin', 'jobs'],
        form: {
            email: options.form?.email || selectedUser?.email || '',
            role: (0, authService_1.normalizeAuthRole)(options.form?.role || selectedUser?.role || 'user'),
            apps: options.form?.apps || selectedUser?.apps || [],
            active: options.form?.active !== undefined ? options.form.active !== 'off' : selectedUser?.active !== false,
            password: options.form?.password || '',
        },
        passwordMinLength: authService_1.APPROVED_USER_PASSWORD_MIN_LENGTH,
    });
}
router.get('/settings/access', async (req, res) => {
    await renderAccessPage(res, { selectedEmail: String(req.query.user || '') });
});
router.post('/settings/access/sync-names', async (req, res) => {
    if (req.authUser?.role !== 'admin') {
        res.status(403).send('Administrator access required.');
        return;
    }
    try {
        const result = await (0, userProfileSyncService_1.syncApprovedUserProfilesFromOdoo)();
        res.redirect('/settings/access?message=' + encodeURIComponent(`Saved ${result.matched} Odoo employee name(s) locally. ${result.unmatched} unmatched; ${result.failed} failed.`));
    }
    catch (error) {
        res.redirect('/settings/access?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Could not synchronize Odoo names.'));
    }
});
router.post('/settings/access', validators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const email = (0, authService_1.normalizeEmailAddress)(String(req.body.email || ''));
    const role = (0, authService_1.normalizeAuthRole)(String(req.body.role || 'user'));
    let apps = [];
    if (typeof req.body.apps === 'string') {
        apps = [req.body.apps];
    }
    else if (Array.isArray(req.body.apps)) {
        apps = req.body.apps.filter((a) => typeof a === 'string');
    }
    const active = req.body.active === 'on';
    const password = String(req.body.password || '');
    if (!errors.isEmpty()) {
        return renderAccessPage(res.status(422), {
            status: { type: 'danger', message: 'Please fix the access control form.' },
            validationErrors: errors.array().map((error) => ({
                msg: error.msg === 'Invalid value' ? `Invalid ${String(error.path || 'form field')}.` : error.msg,
            })),
            form: { email, role, apps, active: active ? 'on' : 'off', password: '' },
        });
    }
    if (!(0, authService_1.isAllowedEmailDomain)(email) && role !== 'admin' && role !== 'user' && !apps.includes('shop-floor')) {
        return renderAccessPage(res.status(422), {
            status: { type: 'danger', message: 'Gmail and other personal addresses are allowed only for Shop Operator access.' },
            validationErrors: [],
            form: { email, role, apps, active: active ? 'on' : 'off', password: '' },
        });
    }
    const passwordHash = password ? await (0, authService_1.hashApprovedUserPassword)(password) : null;
    await (0, repositories_1.upsertApprovedAuthUser)(email, role, apps, active, passwordHash);
    await (0, logService_1.logEvent)('info', 'Access control user saved', {
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
router.post('/settings/access/login-as', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!isAdmin && !isShopFloorAdmin) {
        res.status(403).redirect('/dashboard');
        return;
    }
    const redirectOnError = isAdmin ? '/settings/access' : '/shop-floor/operators';
    const targetEmail = (0, authService_1.normalizeEmailAddress)(String(req.body.email || ''));
    if (!targetEmail || !targetEmail.includes('@')) {
        res.redirect(redirectOnError + '?error=' + encodeURIComponent('Invalid email.'));
        return;
    }
    const targetUser = await (0, repositories_1.getApprovedAuthUserByEmail)(targetEmail);
    const role = (0, authService_1.normalizeAuthRole)(req.body.role || targetUser?.role || 'user');
    const apps = targetUser?.apps || [];
    // Store impersonation in a plain cookie
    res.cookie(IMPERSONATE_COOKIE, JSON.stringify({ email: targetEmail, role, apps }), {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });
    void (0, logService_1.logEvent)('info', 'Admin logged in as user', {
        adminEmail: req.authUser?.email || '',
        targetEmail,
    });
    res.redirect('/dashboard?message=' + encodeURIComponent(`Now previewing the app as ${targetEmail}.`));
});
router.get('/auth/return-to-admin', async (_req, res) => {
    res.clearCookie(IMPERSONATE_COOKIE, { path: '/' });
    res.redirect('/dashboard');
});
exports.default = router;
