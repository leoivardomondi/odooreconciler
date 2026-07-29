"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const repositories_1 = require("../models/repositories");
const db_1 = require("../models/db");
const authService_1 = require("../services/authService");
const logService_1 = require("../services/logService");
const router = (0, express_1.Router)();
const validators = [
    (0, express_validator_1.body)('mysqlHost').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('mysqlPort').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('mysqlUser').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('mysqlPassword').optional({ values: 'falsy' }),
    (0, express_validator_1.body)('mysqlDatabase').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('adminEmail').trim().isEmail().withMessage('Enter a valid admin email address.'),
];
function installerAvailable() {
    return (0, db_1.isDatabaseInstallerEnabled)();
}
function buildFormValues(source = {}) {
    const current = (0, db_1.getRuntimeDatabaseConfig)();
    return {
        driver: 'mysql',
        sqlitePath: '',
        mysqlHost: source.mysqlHost ?? current.mysqlHost,
        mysqlPort: source.mysqlPort ?? current.mysqlPort,
        mysqlUser: source.mysqlUser ?? current.mysqlUser,
        mysqlPassword: '',
        mysqlDatabase: source.mysqlDatabase ?? current.mysqlDatabase,
        mysqlConnectionLimit: source.mysqlConnectionLimit ?? current.mysqlConnectionLimit,
        adminEmail: source.adminEmail ?? '',
    };
}
function renderInstallPage(res, options = {}) {
    return res.render('install', {
        pageTitle: 'Installer',
        status: options.status || null,
        validationErrors: options.validationErrors || [],
        form: buildFormValues(options.form),
    });
}
router.get('/install', (req, res) => {
    if (!installerAvailable()) {
        return res.redirect('/login');
    }
    return renderInstallPage(res);
});
router.post('/install', validators, async (req, res) => {
    if (!installerAvailable()) {
        return res.redirect('/login');
    }
    const errors = (0, express_validator_1.validationResult)(req);
    const formBody = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [key, String(value || '')]));
    if (!errors.isEmpty()) {
        return renderInstallPage(res.status(422), {
            status: { type: 'danger', message: 'Please fix the installer form errors.' },
            validationErrors: errors.array(),
            form: formBody,
        });
    }
    const normalizedAdminEmail = (0, authService_1.normalizeEmailAddress)(String(req.body.adminEmail || ''));
    if (!(0, authService_1.isAllowedEmailDomain)(normalizedAdminEmail)) {
        return renderInstallPage(res.status(422), {
            status: { type: 'danger', message: 'The first admin must use an approved work email domain.' },
            validationErrors: [],
            form: formBody,
        });
    }
    if (!String(req.body.mysqlHost || '').trim() ||
        !String(req.body.mysqlUser || '').trim() ||
        !String(req.body.mysqlDatabase || '').trim()) {
        return renderInstallPage(res.status(422), {
            status: { type: 'danger', message: 'MySQL host, user, and database are required.' },
            validationErrors: [],
            form: formBody,
        });
    }
    try {
        const config = {
            driver: 'mysql',
            sqlitePath: '',
            mysqlHost: String(req.body.mysqlHost || '').trim(),
            mysqlPort: String(req.body.mysqlPort || '3306').trim() || '3306',
            mysqlUser: String(req.body.mysqlUser || '').trim(),
            mysqlPassword: String(req.body.mysqlPassword || ''),
            mysqlDatabase: String(req.body.mysqlDatabase || '').trim(),
            mysqlConnectionLimit: String(req.body.mysqlConnectionLimit || '10').trim() || '10',
        };
        (0, db_1.saveRuntimeDatabaseConfig)(config);
        await (0, db_1.ensureDatabase)();
        await (0, repositories_1.upsertApprovedAuthUser)(normalizedAdminEmail, 'admin', [], true);
        await (0, logService_1.logEvent)('info', 'Database installer completed', {
            driver: config.driver,
            mysqlHost: config.mysqlHost,
            mysqlDatabase: config.mysqlDatabase,
            adminEmail: normalizedAdminEmail,
        });
        return res.redirect('/login?message=' + encodeURIComponent('Installer completed. Sign in with the admin email to continue.'));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not complete the installer.';
        return renderInstallPage(res.status(500), {
            status: { type: 'danger', message },
            validationErrors: [],
            form: formBody,
        });
    }
});
exports.default = router;
