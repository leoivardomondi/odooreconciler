"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pwaBadgeService_1 = require("../services/pwaBadgeService");
const shopFloorTaskReminderService_1 = require("../services/shopFloorTaskReminderService");
const router = (0, express_1.Router)();
router.get('/notifications/due-tasks-count', async (req, res) => {
    if (!req.authUser) {
        res.status(401).json({
            ok: false,
            message: 'Authentication is required.',
            totalCount: 0,
            mpesaCount: 0,
            shopFloorCount: 0,
        });
        return;
    }
    try {
        const breakdown = await (0, pwaBadgeService_1.getPwaBadgeBreakdown)(req.authUser);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            ok: true,
            ...breakdown,
        });
    }
    catch (error) {
        res.status(500).json({
            ok: false,
            message: error instanceof Error ? error.message : 'Could not load due-task count.',
            totalCount: 0,
            mpesaCount: 0,
            shopFloorCount: 0,
        });
    }
});
router.get('/notifications/shop-floor-tasks', async (req, res) => {
    if (!req.authUser)
        return res.status(401).json({ ok: false, tasks: [] });
    const tasks = await (0, shopFloorTaskReminderService_1.getShopFloorDueTasksForUser)(req.authUser).catch(() => []);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, tasks, checkedAt: new Date().toISOString() });
});
exports.default = router;
