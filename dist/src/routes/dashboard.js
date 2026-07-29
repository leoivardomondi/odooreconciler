"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const repositories_1 = require("../models/repositories");
const logService_1 = require("../services/logService");
const schedulerService_1 = require("../services/schedulerService");
const router = (0, express_1.Router)();
router.get('/dashboard', async (req, res) => {
    const authUser = req.viewingAsUser || req.authUser;
    if (authUser && authUser.role !== 'admin' && authUser.apps?.includes('shop-floor')) {
        return res.redirect('/shop-floor');
    }
    const settings = await (0, repositories_1.getSettings)();
    const history = await (0, repositories_1.getRecentHistory)(12);
    const logs = await (0, logService_1.fetchRecentLogsAsync)(12);
    const lastRun = history[0] || null;
    const message = typeof req.query.message === 'string' ? req.query.message : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    const scheduler = await (0, schedulerService_1.getSchedulerStatus)();
    res.render('dashboard', {
        pageTitle: 'Dashboard',
        settings,
        history,
        logs,
        scheduler,
        status: message
            ? { type: 'success', message }
            : error
                ? { type: 'danger', message: error }
                : null,
        stats: {
            totalRuns: history.length,
            parsedRuns: history.filter((entry) => ['parsed', 'parsed_empty', 'sent_to_odoo'].includes(entry.status)).length,
            failedRuns: history.filter((entry) => ['failed', 'odoo_update_failed'].includes(entry.status)).length,
            lastRun,
        },
    });
});
exports.default = router;
