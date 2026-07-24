import { Router, Request, Response } from 'express';
import { getPwaBadgeBreakdown } from '../services/pwaBadgeService';
import { getShopFloorDueTasksForUser } from '../services/shopFloorTaskReminderService';

const router = Router();

router.get('/notifications/due-tasks-count', async (req: Request, res: Response) => {
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
    const breakdown = await getPwaBadgeBreakdown(req.authUser);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      ...breakdown,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : 'Could not load due-task count.',
      totalCount: 0,
      mpesaCount: 0,
      shopFloorCount: 0,
    });
  }
});

router.get('/notifications/shop-floor-tasks', async (req: Request, res: Response) => {
  if (!req.authUser) return res.status(401).json({ ok: false, tasks: [] });
  const tasks = await getShopFloorDueTasksForUser(req.authUser).catch(() => []);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, tasks, checkedAt: new Date().toISOString() });
});

export default router;
