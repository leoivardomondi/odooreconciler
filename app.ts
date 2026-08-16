import compression from 'compression';
import { randomUUID } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import http from 'http';
import https from 'https';
import morgan from 'morgan';
import { getSettings } from './src/models/repositories';
import routes from './src/routes';
import {
  attachAuthState,
  canAccessPath,
  enforceCsrf,
  getAuthRoleLabel,
  getRequestContext,
  recordAuthLoginEvent,
  requireAuthentication,
  requireAuthorizedAccess,
} from './src/services/authService';
import { env } from './src/utils/env';
import {
  formatDateTime,
  formatFileSize,
  getPreferredAppBaseUrl,
  getRelationLabel,
  hasOdooConfiguration,
  toBoolean,
} from './src/utils/helpers';
import { publicPath, viewsPath } from './src/utils/paths';
import { getStartupState, markStartupFailedIfStale } from './src/services/startupState';
import { resolveLocalUserDisplayName } from './src/services/userIdentityService';
import { logEvent } from './src/services/logService';

const app = express();

app.set('view engine', 'ejs');
app.set('views', viewsPath);

app.disable('x-powered-by');

if (toBoolean(env.TRUST_PROXY)) {
  app.set('trust proxy', 1);
}

app.use('/odoo-payroll', proxyPayrollBridge);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: '10mb', parameterLimit: 50000 }));
app.use(express.json({ limit: '10mb' }));
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = String(req.get('x-request-id') || randomUUID()).slice(0, 80);
  res.setHeader('X-Request-ID', requestId);
  res.locals.requestId = requestId;
  next();
});
app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs < 1000 || req.path === '/health' || req.path.startsWith('/public/')) {
      return;
    }
    void logEvent('warn', 'Slow HTTP request', {
      requestId: res.locals.requestId || null,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
      userEmail: req.authUser?.email || null,
    }).catch(() => undefined);
  });
  next();
});
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/public', express.static(publicPath));

function proxyPayrollBridge(req: Request, res: Response, next: NextFunction) {
  if (!env.PAYROLL_BRIDGE_PROXY_URL) {
    next();
    return;
  }

  let upstreamBase: URL;
  try {
    upstreamBase = new URL(env.PAYROLL_BRIDGE_PROXY_URL);
  } catch (_error) {
    next();
    return;
  }

  const incomingUrl = new URL(req.originalUrl, 'http://reconciler.local');
  const strippedPath = incomingUrl.pathname.replace(/^\/odoo-payroll\/?/, '');
  const upstreamPath = [
    upstreamBase.pathname.replace(/\/$/, ''),
    strippedPath.replace(/^\//, ''),
  ]
    .filter(Boolean)
    .join('/');
  const upstreamUrl = new URL(upstreamBase.toString());
  upstreamUrl.pathname = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  upstreamUrl.search = incomingUrl.search;

  const transport = upstreamUrl.protocol === 'https:' ? https : http;
  const proxyRequest = transport.request(
    upstreamUrl,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: upstreamUrl.host,
      },
    },
    (proxyResponse) => {
      res.statusCode = proxyResponse.statusCode || 502;
      Object.entries(proxyResponse.headers).forEach(([key, value]) => {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      });
      proxyResponse.pipe(res);
    },
  );

  proxyRequest.on('error', (error) => {
    res.status(502).json({
      ok: false,
      message: 'Payroll bridge is not reachable.',
      detail: error.message,
    });
  });

  req.pipe(proxyRequest);
}

app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
  res.type('application/manifest+json');
  res.sendFile('manifest.webmanifest', { root: publicPath });
});

app.get('/service-worker.js', (_req: Request, res: Response) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile('sw.js', { root: publicPath });
});

app.locals.formatDateTime = formatDateTime;
app.locals.formatFileSize = formatFileSize;
app.locals.getRelationLabel = getRelationLabel;
app.locals.stringify = (value: unknown) => JSON.stringify(value, null, 2);

app.get('/health', (_req: Request, res: Response) => {
  const startupState = getStartupState();
  const isDevelopment = env.NODE_ENV !== 'production';
  res.json({
    ok: true,
    service: env.APP_NAME,
    timestamp: new Date().toISOString(),
    startupStatus: startupState.status,
    ...(isDevelopment
      ? {
          startupStep: startupState.step,
          startupStartedAt: startupState.startedAt,
          startupUpdatedAt: startupState.updatedAt,
          startupStepStartedAt: startupState.stepStartedAt,
          startupError: startupState.errorMessage,
        }
      : {}),
  });
});

app.get('/api/usage', (req: Request, res: Response) => {
  if (req.authUser?.role !== 'admin') {
    res.status(403).json({
      ok: false,
      message: 'Admin access is required to view usage.',
    });
    return;
  }

  const memoryUsage = process.memoryUsage();
  const resourceUsage = typeof process.resourceUsage === 'function' ? process.resourceUsage() : null;
  const uptimeSeconds = Math.round(process.uptime());

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    runtime: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds,
      memory: {
        rssBytes: memoryUsage.rss,
        heapTotalBytes: memoryUsage.heapTotal,
        heapUsedBytes: memoryUsage.heapUsed,
        externalBytes: memoryUsage.external,
        arrayBuffersBytes: memoryUsage.arrayBuffers,
      },
      resourceUsage,
    },
    note:
      'This shows the current Node process usage. cPanel account limits can still be lower than these values.',
  });
});

function wantsStartupJson(req: Request) {
  if (
    req.path === '/health' ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/jobs/') ||
    req.xhr
  ) {
    return true;
  }

  const accepted = req.accepts(['html', 'json']);
  return accepted === 'json';
}

function setStartupLocals(req: Request, res: Response) {
  res.locals.appName = env.APP_NAME;
  res.locals.appBaseUrl = getPreferredAppBaseUrl(req);
  res.locals.currentPath = req.path;
  res.locals.csrfToken = null;
  res.locals.isAuthenticated = false;
  res.locals.authUser = null;
  res.locals.authRoleLabel = '';
  res.locals.canAccess = () => false;
  res.locals.activeOdooCompanyName = env.ODOO_TARGET_COMPANY_NAME;
  res.locals.allowedAuthDomains = env.AUTH_ALLOWED_DOMAINS;
  res.locals.mpesaOpenReviewStatementCount = 0;
  res.locals.pwaDueTaskCount = 0;
  res.locals.pwaBadgeBreakdown = null;
  res.locals.connection = {
    status: 'unknown',
    checkedAt: null,
    message: null,
    version: null,
  };
}

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') {
    next();
    return;
  }

  markStartupFailedIfStale(Number(env.STARTUP_STEP_TIMEOUT_MS || 30000));
  const startupState = getStartupState();
  if (startupState.status === 'ready') {
    next();
    return;
  }

  const payload = {
    ok: false,
    message:
      startupState.status === 'failed'
        ? 'Application startup failed.'
        : 'Application is still starting.',
    startupStatus: startupState.status,
    startupStep: startupState.step,
    startupStartedAt: startupState.startedAt,
    startupUpdatedAt: startupState.updatedAt,
    startupStepStartedAt: startupState.stepStartedAt,
    startupError: startupState.errorMessage,
  };

  res.setHeader('Retry-After', '5');
  res.setHeader('Cache-Control', 'no-store');

  if (wantsStartupJson(req)) {
    res.status(503).json(payload);
    return;
  }

  setStartupLocals(req, res);

  if (startupState.status === 'failed') {
    res.locals.connection = {
      ...res.locals.connection,
      status: 'error',
      message: startupState.errorMessage,
    };
    res.status(503).render('error', {
      pageTitle: 'Application Startup Failed',
      errorMessage: startupState.errorMessage || payload.message,
      details: [
        `Startup status: ${startupState.status}`,
        `Startup step: ${startupState.step}`,
        `Started at: ${startupState.startedAt}`,
        `Step started at: ${startupState.stepStartedAt}`,
      ],
    });
    return;
  }

  res.status(503).render('startup', {
    pageTitle: 'Application Starting',
    startupMessage: payload.message,
    startupStep: startupState.step,
    retrySeconds: 5,
  });
});

app.use(attachAuthState);

app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await getSettings();

    if (req.authUser) {
      req.authUser.displayName = await resolveLocalUserDisplayName(req.authUser.email);
      res.locals.authUser = req.authUser;
    }
    if (req.viewingAsUser) {
      req.viewingAsUser.displayName = await resolveLocalUserDisplayName(req.viewingAsUser.email);
      res.locals.viewingAsUser = req.viewingAsUser;
    }

    res.locals.appName = env.APP_NAME;
    res.locals.appBaseUrl = getPreferredAppBaseUrl(req);
    res.locals.activeOdooCompanyName = env.ODOO_TARGET_COMPANY_NAME;
    res.locals.currentPath = req.path;
    res.locals.connection = settings.connection;
    res.locals.isConfigured = hasOdooConfiguration(settings);
    res.locals.allowedAuthDomains = env.AUTH_ALLOWED_DOMAINS;
    res.locals.maskedOdoo = {
      baseUrl: settings.odoo.baseUrl,
      database: settings.odoo.database,
      username: settings.odoo.username,
      hasApiKey: Boolean(settings.odoo.apiKey),
    };
    res.locals.authRoleLabel = getAuthRoleLabel(req.authUser?.role);
    res.locals.canAccess = (method: string, requestPath: string) =>
      canAccessPath(req.viewingAsUser || req.authUser, method, requestPath);
    // Due-task counts are refreshed asynchronously by main.js. Do not make every
    // navigation wait for Odoo and M-Pesa queries before rendering the page.
    res.locals.mpesaOpenReviewStatementCount = 0;
    res.locals.pwaDueTaskCount = 0;
    res.locals.pwaBadgeBreakdown = null;

    next();
  } catch (error) {
    next(error);
  }
});

const recentUserActivity = new Map<string, number>();
app.use((req: Request, _res: Response, next: NextFunction) => {
  const user = req.authUser;
  if (user && !req.path.startsWith('/public') && !req.path.startsWith('/notifications/')) {
    const isAction = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const activityKey = `${user.email}:${req.method}:${req.path}`;
    const lastRecordedAt = recentUserActivity.get(activityKey) || 0;
    if (isAction || Date.now() - lastRecordedAt >= 5 * 60 * 1000) {
      recentUserActivity.set(activityKey, Date.now());
      const context = getRequestContext(req);
      void recordAuthLoginEvent({
        email: user.email,
        role: user.role,
        eventType: 'activity',
        authMethod: 'session',
        success: true,
        ipAddress: context.ipAddress,
        location: context.location,
        userAgent: context.userAgent,
        detail: `${req.method} ${req.path}`,
      });
    }
  }
  next();
});

app.use(enforceCsrf);

app.use((req: Request, res: Response, next: NextFunction) => {
  const publicPathPrefixes = ['/public', '/auth/', '/staff-onboarding'];
  const publicExactPaths = [
    '/health',
    '/login',
    '/forgot-password',
    '/install',
    '/jobs/attachment-uploaded',
    '/jobs/attachment-uploaded/test',
    '/jobs/run-scheduler',
    '/jobs/run-po-bill-scheduler',
    '/jobs/send-mpesa-review-notification',
    '/jobs/send-shop-floor-task-reminders',
  ];

  if (publicExactPaths.includes(req.path) || publicPathPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    next();
    return;
  }

  requireAuthentication(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }

    requireAuthorizedAccess(req, res, next);
  });
});

app.use(routes);

app.use((req: Request, res: Response) => {
  res.status(404).render('error', {
    pageTitle: 'Page Not Found',
    errorMessage: `The requested page "${req.path}" does not exist.`,
    details: [],
  });
});

app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  const isDevelopment = env.NODE_ENV !== 'production';
  const requestId = String(res.getHeader('X-Request-ID') || randomUUID());
  const message = error?.message || 'Something went wrong.';

  void logEvent('error', 'Unhandled HTTP request error', {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    statusCode: 500,
    userEmail: req.authUser?.email || null,
    errorName: error?.name || 'Error',
    errorMessage: message,
    stack: error?.stack || null,
  }).catch((loggingError) => {
    console.error('[http-error] Could not persist unhandled request error:', loggingError);
  });

  console.error('[http-error]', {
    requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    error,
  });

  const acceptsJson = Boolean(
    req.get('accept')?.includes('application/json') && !req.get('accept')?.includes('text/html'),
  );

  if (req.path.startsWith('/api/') || req.path.startsWith('/jobs/') || req.xhr || acceptsJson) {
    res.status(500).json({
      ok: false,
      error: isDevelopment ? message : 'Internal server error.',
      requestId,
    });
    return;
  }

  res.status(500).render('error', {
    pageTitle: 'Application Error',
    errorMessage: isDevelopment ? message : `An unexpected error occurred. Please provide support with request ID ${requestId}.`,
    details: [
      `Request ID: ${requestId}`,
      `Path: ${req.method} ${req.originalUrl || req.path}`,
      ...(isDevelopment && error.stack ? error.stack.split('\n') : []),
    ],
    csrfToken: null,
  });
});

export default app;
