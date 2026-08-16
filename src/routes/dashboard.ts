import { Router } from 'express';
import { getExtractionQueueHealth, getRecentHistory, getSettings } from '../models/repositories';
import { HistoryEntry } from '../models/types';
import { fetchRecentLogsAsync } from '../services/logService';
import { getSchedulerStatus } from '../services/schedulerService';

const router = Router();

router.get('/dashboard', async (req, res) => {
  const authUser = req.viewingAsUser || req.authUser;
  if (authUser && authUser.role !== 'admin' && authUser.apps?.includes('shop-floor')) {
    return res.redirect('/shop-floor');
  }

  const settings = await getSettings();
  const history = await getRecentHistory(12);
  const logs = await fetchRecentLogsAsync(12);
  const lastRun = history[0] || null;
  const message = typeof req.query.message === 'string' ? req.query.message : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';
  const scheduler = await getSchedulerStatus();
  const queueHealth = authUser?.role === 'admin' ? await getExtractionQueueHealth() : null;

  res.render('dashboard', {
    pageTitle: 'Dashboard',
    settings,
    history,
    logs,
    scheduler,
    queueHealth,
    status: message
      ? { type: 'success', message }
      : error
        ? { type: 'danger', message: error }
        : null,
    stats: {
      totalRuns: history.length,
      parsedRuns: history.filter((entry: HistoryEntry) =>
        ['parsed', 'parsed_empty', 'sent_to_odoo'].includes(entry.status),
      ).length,
      failedRuns: history.filter((entry: HistoryEntry) =>
        ['failed', 'odoo_update_failed'].includes(entry.status),
      ).length,
      lastRun,
    },
  });
});

export default router;
