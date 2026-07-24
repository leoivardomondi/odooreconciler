import { Request, Response, Router } from 'express';
import { body, validationResult } from 'express-validator';
import { getSettings, saveSettings, updateConnectionStatus } from '../models/repositories';
import { logEvent } from '../services/logService';
import { OdooClient } from '../services/odooClient';
import { sanitizeBaseUrl } from '../utils/helpers';

const router = Router();

const baseValidators = [
  body('baseUrl').trim().notEmpty().withMessage('Odoo Base URL is required.').isURL({
    require_protocol: true,
  }),
  body('database').optional({ values: 'falsy' }).trim(),
  body('username').trim().notEmpty().withMessage('Username is required.'),
  body('apiKey').optional({ values: 'falsy' }).trim(),
  body('clearStoredApiKey').optional({ values: 'falsy' }).trim(),
];

async function buildFormValues(
  source: Record<string, string>,
  existing?: Awaited<ReturnType<typeof getSettings>>,
) {
  const resolvedExisting = existing || (await getSettings());
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
  const settings = await getSettings();

  res.render('setup', {
    pageTitle: 'Setup',
    form: await buildFormValues({}),
    status: null,
    validationErrors: [],
    connection: settings.connection,
  });
});

router.post('/setup', baseValidators, async (req: Request, res: Response) => {
  const errors = validationResult(req);
  const currentSettings = await getSettings();
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
    const saved = await saveSettings({
      baseUrl: sanitizeBaseUrl(req.body.baseUrl),
      database: req.body.database?.trim() || '',
      username: req.body.username?.trim() || '',
      apiKey: req.body.apiKey?.trim() || '',
      keepExistingApiKey: true,
      clearStoredApiKey: req.body.clearStoredApiKey === 'on',
    });

    await logEvent('info', 'Setup settings saved', {
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
  } catch (error) {
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

router.post('/setup/test-connection', baseValidators, async (req: Request, res: Response) => {
  const errors = validationResult(req);
  const currentSettings = await getSettings();
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
    const client = new OdooClient({
      baseUrl: sanitizeBaseUrl(req.body.baseUrl),
      database: req.body.database?.trim() || '',
      username: req.body.username?.trim() || '',
      apiKey,
    });
    const result = await client.testConnection();
    await updateConnectionStatus(
      'success',
      `Connected as ${result.user?.name || req.body.username}.`,
      result.version,
    );

    await logEvent('info', 'Odoo connection test succeeded', {
      baseUrl: sanitizeBaseUrl(req.body.baseUrl),
      username: req.body.username?.trim() || '',
      version: result.version,
    });

    const refreshedSettings = await getSettings();

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Odoo connection test failed.';
    await updateConnectionStatus('error', message, null);
    await logEvent('error', 'Odoo connection test failed', {
      baseUrl: sanitizeBaseUrl(req.body.baseUrl),
      username: req.body.username?.trim() || '',
      error: message,
    });

    res.status(502).render('setup', {
      pageTitle: 'Setup',
      form,
      status: { type: 'danger', message },
      validationErrors: [],
      connection: (await getSettings()).connection,
    });
  }
});

export default router;
