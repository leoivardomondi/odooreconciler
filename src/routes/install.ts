import { Request, Response, Router } from 'express';
import { body, validationResult } from 'express-validator';
import { upsertApprovedAuthUser } from '../models/repositories';
import {
  ensureDatabase,
  getRuntimeDatabaseConfig,
  isDatabaseInstallerEnabled,
  saveRuntimeDatabaseConfig,
} from '../models/db';
import { RuntimeDatabaseConfig } from '../models/types';
import { normalizeEmailAddress, isAllowedEmailDomain } from '../services/authService';
import { logEvent } from '../services/logService';

const router = Router();

const validators = [
  body('mysqlHost').optional({ values: 'falsy' }).trim(),
  body('mysqlPort').optional({ values: 'falsy' }).trim(),
  body('mysqlUser').optional({ values: 'falsy' }).trim(),
  body('mysqlPassword').optional({ values: 'falsy' }),
  body('mysqlDatabase').optional({ values: 'falsy' }).trim(),
  body('adminEmail').trim().isEmail().withMessage('Enter a valid admin email address.'),
];

function installerAvailable() {
  return isDatabaseInstallerEnabled();
}

function buildFormValues(source: Record<string, string> = {}) {
  const current = getRuntimeDatabaseConfig();
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

function renderInstallPage(
  res: Response,
  options: {
    status?: { type: string; message: string } | null;
    validationErrors?: Array<{ msg: string }>;
    form?: Record<string, string>;
  } = {},
) {
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

router.post('/install', validators, async (req: Request, res: Response) => {
  if (!installerAvailable()) {
    return res.redirect('/login');
  }

  const errors = validationResult(req);
  const formBody = Object.fromEntries(
    Object.entries(req.body as Record<string, unknown>).map(([key, value]) => [key, String(value || '')]),
  );

  if (!errors.isEmpty()) {
    return renderInstallPage(res.status(422), {
      status: { type: 'danger', message: 'Please fix the installer form errors.' },
      validationErrors: errors.array(),
      form: formBody,
    });
  }

  const normalizedAdminEmail = normalizeEmailAddress(String(req.body.adminEmail || ''));

  if (!isAllowedEmailDomain(normalizedAdminEmail)) {
    return renderInstallPage(res.status(422), {
      status: { type: 'danger', message: 'The first admin must use an approved work email domain.' },
      validationErrors: [],
      form: formBody,
    });
  }

  if (
    !String(req.body.mysqlHost || '').trim() ||
    !String(req.body.mysqlUser || '').trim() ||
    !String(req.body.mysqlDatabase || '').trim()
  ) {
    return renderInstallPage(res.status(422), {
      status: { type: 'danger', message: 'MySQL host, user, and database are required.' },
      validationErrors: [],
      form: formBody,
    });
  }

  try {
    const config: RuntimeDatabaseConfig = {
      driver: 'mysql',
      sqlitePath: '',
      mysqlHost: String(req.body.mysqlHost || '').trim(),
      mysqlPort: String(req.body.mysqlPort || '3306').trim() || '3306',
      mysqlUser: String(req.body.mysqlUser || '').trim(),
      mysqlPassword: String(req.body.mysqlPassword || ''),
      mysqlDatabase: String(req.body.mysqlDatabase || '').trim(),
      mysqlConnectionLimit: String(req.body.mysqlConnectionLimit || '10').trim() || '10',
    };

    saveRuntimeDatabaseConfig(config);
    await ensureDatabase();
    await upsertApprovedAuthUser(normalizedAdminEmail, 'admin', [], true);

    await logEvent('info', 'Database installer completed', {
      driver: config.driver,
      mysqlHost: config.mysqlHost,
      mysqlDatabase: config.mysqlDatabase,
      adminEmail: normalizedAdminEmail,
    });

    return res.redirect('/login?message=' + encodeURIComponent('Installer completed. Sign in with the admin email to continue.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not complete the installer.';
    return renderInstallPage(res.status(500), {
      status: { type: 'danger', message },
      validationErrors: [],
      form: formBody,
    });
  }
});

export default router;
