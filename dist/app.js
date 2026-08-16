"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const compression_1 = __importDefault(require("compression"));
const crypto_1 = require("crypto");
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const morgan_1 = __importDefault(require("morgan"));
const repositories_1 = require("./src/models/repositories");
const routes_1 = __importDefault(require("./src/routes"));
const authService_1 = require("./src/services/authService");
const env_1 = require("./src/utils/env");
const helpers_1 = require("./src/utils/helpers");
const paths_1 = require("./src/utils/paths");
const startupState_1 = require("./src/services/startupState");
const invoiceExtractionJobService_1 = require("./src/services/invoiceExtractionJobService");
const mpesaExtractionJobService_1 = require("./src/services/mpesaExtractionJobService");
const poBillManualJobService_1 = require("./src/services/poBillManualJobService");
const userIdentityService_1 = require("./src/services/userIdentityService");
const logService_1 = require("./src/services/logService");
const app = (0, express_1.default)();
app.set('view engine', 'ejs');
app.set('views', paths_1.viewsPath);
app.disable('x-powered-by');
if ((0, helpers_1.toBoolean)(env_1.env.TRUST_PROXY)) {
    app.set('trust proxy', 1);
}
app.use('/odoo-payroll', proxyPayrollBridge);
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));
app.use((0, compression_1.default)());
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb', parameterLimit: 50000 }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use((req, res, next) => {
    const requestId = String(req.get('x-request-id') || (0, crypto_1.randomUUID)()).slice(0, 80);
    res.setHeader('X-Request-ID', requestId);
    res.locals.requestId = requestId;
    next();
});
app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        if (durationMs < 1000 || req.path === '/health' || req.path.startsWith('/public/')) {
            return;
        }
        void (0, logService_1.logEvent)('warn', 'Slow HTTP request', {
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
app.use((0, morgan_1.default)(env_1.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/public', express_1.default.static(paths_1.publicPath, {
    etag: true,
    lastModified: true,
    maxAge: '1h',
}));
function proxyPayrollBridge(req, res, next) {
    if (!env_1.env.PAYROLL_BRIDGE_PROXY_URL) {
        next();
        return;
    }
    let upstreamBase;
    try {
        upstreamBase = new URL(env_1.env.PAYROLL_BRIDGE_PROXY_URL);
    }
    catch (_error) {
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
    const transport = upstreamUrl.protocol === 'https:' ? https_1.default : http_1.default;
    const proxyRequest = transport.request(upstreamUrl, {
        method: req.method,
        headers: {
            ...req.headers,
            host: upstreamUrl.host,
        },
    }, (proxyResponse) => {
        res.statusCode = proxyResponse.statusCode || 502;
        Object.entries(proxyResponse.headers).forEach(([key, value]) => {
            if (value !== undefined) {
                res.setHeader(key, value);
            }
        });
        proxyResponse.pipe(res);
    });
    proxyRequest.on('error', (error) => {
        res.status(502).json({
            ok: false,
            message: 'Payroll bridge is not reachable.',
            detail: error.message,
        });
    });
    req.pipe(proxyRequest);
}
app.get('/manifest.webmanifest', (_req, res) => {
    res.type('application/manifest+json');
    res.sendFile('manifest.webmanifest', { root: paths_1.publicPath });
});
app.get('/service-worker.js', (_req, res) => {
    res.setHeader('Service-Worker-Allowed', '/');
    res.type('application/javascript');
    res.sendFile('sw.js', { root: paths_1.publicPath });
});
app.locals.formatDateTime = helpers_1.formatDateTime;
app.locals.formatFileSize = helpers_1.formatFileSize;
app.locals.getRelationLabel = helpers_1.getRelationLabel;
app.locals.stringify = (value) => JSON.stringify(value, null, 2);
app.get('/health', (_req, res) => {
    const startupState = (0, startupState_1.getStartupState)();
    const isDevelopment = env_1.env.NODE_ENV !== 'production';
    const ready = startupState.status === 'ready';
    const workers = {
        mpesaExtraction: (0, mpesaExtractionJobService_1.getMpesaExtractionJobWorkerStatus)(),
        invoiceExtraction: (0, invoiceExtractionJobService_1.getInvoiceExtractionJobWorkerStatus)(),
        poBillManual: (0, poBillManualJobService_1.getPoBillManualJobWorkerStatus)(),
    };
    const workersReady = Object.values(workers).every((worker) => worker.healthy);
    res.status(ready && workersReady ? 200 : 503);
    res.json({
        ok: ready && workersReady,
        service: env_1.env.APP_NAME,
        timestamp: new Date().toISOString(),
        startupStatus: startupState.status,
        workers,
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
app.get('/api/usage', (req, res) => {
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
        note: 'This shows the current Node process usage. cPanel account limits can still be lower than these values.',
    });
});
function wantsStartupJson(req) {
    if (req.path === '/health' ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/jobs/') ||
        req.xhr) {
        return true;
    }
    const accepted = req.accepts(['html', 'json']);
    return accepted === 'json';
}
function setStartupLocals(req, res) {
    res.locals.appName = env_1.env.APP_NAME;
    res.locals.appBaseUrl = (0, helpers_1.getPreferredAppBaseUrl)(req);
    res.locals.currentPath = req.path;
    res.locals.csrfToken = null;
    res.locals.isAuthenticated = false;
    res.locals.authUser = null;
    res.locals.authRoleLabel = '';
    res.locals.canAccess = () => false;
    res.locals.activeOdooCompanyName = env_1.env.ODOO_TARGET_COMPANY_NAME;
    res.locals.allowedAuthDomains = env_1.env.AUTH_ALLOWED_DOMAINS;
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
app.use((req, res, next) => {
    if (req.path === '/health') {
        next();
        return;
    }
    (0, startupState_1.markStartupFailedIfStale)(Number(env_1.env.STARTUP_STEP_TIMEOUT_MS || 30000));
    const startupState = (0, startupState_1.getStartupState)();
    if (startupState.status === 'ready') {
        next();
        return;
    }
    const payload = {
        ok: false,
        message: startupState.status === 'failed'
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
app.use(authService_1.attachAuthState);
app.use(async (req, res, next) => {
    try {
        const settings = await (0, repositories_1.getSettings)();
        if (req.authUser) {
            req.authUser.displayName = await (0, userIdentityService_1.resolveLocalUserDisplayName)(req.authUser.email);
            res.locals.authUser = req.authUser;
        }
        if (req.viewingAsUser) {
            req.viewingAsUser.displayName = await (0, userIdentityService_1.resolveLocalUserDisplayName)(req.viewingAsUser.email);
            res.locals.viewingAsUser = req.viewingAsUser;
        }
        res.locals.appName = env_1.env.APP_NAME;
        res.locals.appBaseUrl = (0, helpers_1.getPreferredAppBaseUrl)(req);
        res.locals.activeOdooCompanyName = env_1.env.ODOO_TARGET_COMPANY_NAME;
        res.locals.currentPath = req.path;
        res.locals.connection = settings.connection;
        res.locals.isConfigured = (0, helpers_1.hasOdooConfiguration)(settings);
        res.locals.allowedAuthDomains = env_1.env.AUTH_ALLOWED_DOMAINS;
        res.locals.maskedOdoo = {
            baseUrl: settings.odoo.baseUrl,
            database: settings.odoo.database,
            username: settings.odoo.username,
            hasApiKey: Boolean(settings.odoo.apiKey),
        };
        res.locals.authRoleLabel = (0, authService_1.getAuthRoleLabel)(req.authUser?.role);
        res.locals.canAccess = (method, requestPath) => (0, authService_1.canAccessPath)(req.viewingAsUser || req.authUser, method, requestPath);
        // Due-task counts are refreshed asynchronously by main.js. Do not make every
        // navigation wait for Odoo and M-Pesa queries before rendering the page.
        res.locals.mpesaOpenReviewStatementCount = 0;
        res.locals.pwaDueTaskCount = 0;
        res.locals.pwaBadgeBreakdown = null;
        next();
    }
    catch (error) {
        next(error);
    }
});
const recentUserActivity = new Map();
app.use((req, _res, next) => {
    const user = req.authUser;
    if (user && !req.path.startsWith('/public') && !req.path.startsWith('/notifications/')) {
        const isAction = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        const activityKey = `${user.email}:${req.method}:${req.path}`;
        const lastRecordedAt = recentUserActivity.get(activityKey) || 0;
        if (isAction || Date.now() - lastRecordedAt >= 5 * 60 * 1000) {
            recentUserActivity.set(activityKey, Date.now());
            const context = (0, authService_1.getRequestContext)(req);
            void (0, authService_1.recordAuthLoginEvent)({
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
app.use(authService_1.enforceCsrf);
app.use((req, res, next) => {
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
    (0, authService_1.requireAuthentication)(req, res, (error) => {
        if (error) {
            next(error);
            return;
        }
        (0, authService_1.requireAuthorizedAccess)(req, res, next);
    });
});
app.use(routes_1.default);
app.use((req, res) => {
    res.status(404).render('error', {
        pageTitle: 'Page Not Found',
        errorMessage: `The requested page "${req.path}" does not exist.`,
        details: [],
    });
});
app.use((error, req, res, _next) => {
    const isDevelopment = env_1.env.NODE_ENV !== 'production';
    const requestId = String(res.getHeader('X-Request-ID') || (0, crypto_1.randomUUID)());
    const message = error?.message || 'Something went wrong.';
    void (0, logService_1.logEvent)('error', 'Unhandled HTTP request error', {
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
    const acceptsJson = Boolean(req.get('accept')?.includes('application/json') && !req.get('accept')?.includes('text/html'));
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
exports.default = app;
