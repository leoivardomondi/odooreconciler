"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const repositories_1 = require("../models/repositories");
const logService_1 = require("../services/logService");
const odooClient_1 = require("../services/odooClient");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
const baseValidators = [
    (0, express_validator_1.body)('baseUrl').trim().notEmpty().withMessage('Odoo Base URL is required.').isURL({
        require_protocol: true,
    }),
    (0, express_validator_1.body)('database').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('username').trim().notEmpty().withMessage('Username is required.'),
    (0, express_validator_1.body)('apiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('clearStoredApiKey').optional({ values: 'falsy' }).trim(),
];
async function buildFormValues(source, existing) {
    const resolvedExisting = existing || (await (0, repositories_1.getSettings)());
    return {
        baseUrl: source.baseUrl ?? resolvedExisting.odoo.baseUrl,
        database: source.database ?? resolvedExisting.odoo.database,
        username: source.username ?? resolvedExisting.odoo.username,
        apiKey: '',
        clearStoredApiKey: source.clearStoredApiKey === 'on',
        hasStoredApiKey: Boolean(resolvedExisting.odoo.apiKey),
    };
}
router.get('/setup', async (_req, res) => {
    const settings = await (0, repositories_1.getSettings)();
    res.render('setup', {
        pageTitle: 'Setup',
        form: await buildFormValues({}),
        status: null,
        validationErrors: [],
        connection: settings.connection,
    });
});
router.post('/setup', baseValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    const form = await buildFormValues(req.body, currentSettings);
    if (!errors.isEmpty()) {
        return res.status(422).render('setup', {
            pageTitle: 'Setup',
            form,
            status: { type: 'danger', message: 'Please fix the highlighted setup fields.' },
            validationErrors: errors.array(),
            connection: currentSettings.connection,
        });
    }
    try {
        const saved = await (0, repositories_1.saveSettings)({
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            database: req.body.database?.trim() || '',
            username: req.body.username?.trim() || '',
            apiKey: req.body.apiKey?.trim() || '',
            keepExistingApiKey: true,
            clearStoredApiKey: req.body.clearStoredApiKey === 'on',
        });
        await (0, logService_1.logEvent)('info', 'Setup settings saved', {
            baseUrl: saved.odoo.baseUrl,
            database: saved.odoo.database,
            username: saved.odoo.username,
        });
        res.render('setup', {
            pageTitle: 'Setup',
            form: await buildFormValues({}, saved),
            status: { type: 'success', message: 'Odoo setup saved securely.' },
            validationErrors: [],
            connection: saved.connection,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save setup.';
        res.status(500).render('setup', {
            pageTitle: 'Setup',
            form,
            status: { type: 'danger', message },
            validationErrors: [],
            connection: currentSettings.connection,
        });
    }
});
router.post('/setup/test-connection', baseValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    const form = await buildFormValues(req.body, currentSettings);
    if (!errors.isEmpty()) {
        return res.status(422).render('setup', {
            pageTitle: 'Setup',
            form,
            status: { type: 'danger', message: 'Please fix the setup fields before testing.' },
            validationErrors: errors.array(),
            connection: currentSettings.connection,
        });
    }
    const clearStoredApiKey = req.body.clearStoredApiKey === 'on';
    const apiKey = req.body.apiKey?.trim() || (clearStoredApiKey ? '' : currentSettings.odoo.apiKey);
    if (!apiKey) {
        return res.status(422).render('setup', {
            pageTitle: 'Setup',
            form,
            status: {
                type: 'danger',
                message: 'Provide an API key or save one first before testing the Odoo connection.',
            },
            validationErrors: [],
            connection: currentSettings.connection,
        });
    }
    try {
        const client = new odooClient_1.OdooClient({
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            database: req.body.database?.trim() || '',
            username: req.body.username?.trim() || '',
            apiKey,
        });
        const result = await client.testConnection();
        await (0, repositories_1.updateConnectionStatus)('success', `Connected as ${result.user?.name || req.body.username}.`, result.version);
        await (0, logService_1.logEvent)('info', 'Odoo connection test succeeded', {
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            username: req.body.username?.trim() || '',
            version: result.version,
        });
        const refreshedSettings = await (0, repositories_1.getSettings)();
        res.render('setup', {
            pageTitle: 'Setup',
            form,
            status: {
                type: 'success',
                message: `Connection successful. Odoo version ${result.version}.`,
            },
            validationErrors: [],
            connection: refreshedSettings.connection,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Odoo connection test failed.';
        await (0, repositories_1.updateConnectionStatus)('error', message, null);
        await (0, logService_1.logEvent)('error', 'Odoo connection test failed', {
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            username: req.body.username?.trim() || '',
            error: message,
        });
        res.status(502).render('setup', {
            pageTitle: 'Setup',
            form,
            status: { type: 'danger', message },
            validationErrors: [],
            connection: (await (0, repositories_1.getSettings)()).connection,
        });
    }
});
exports.default = router;
