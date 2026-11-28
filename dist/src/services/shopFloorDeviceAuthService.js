"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHOP_FLOOR_DEVICE_COOKIE_NAME = void 0;
exports.hashShopFloorDeviceToken = hashShopFloorDeviceToken;
exports.parseCookieHeader = parseCookieHeader;
exports.buildShopFloorDeviceCookie = buildShopFloorDeviceCookie;
exports.clearShopFloorDeviceCookie = clearShopFloorDeviceCookie;
exports.isRequestOnSiteNetwork = isRequestOnSiteNetwork;
exports.inferFriendlyDeviceLabel = inferFriendlyDeviceLabel;
exports.clearShopFloorDeviceAuthCache = clearShopFloorDeviceAuthCache;
exports.canEmailAuthorizeShopFloorDevice = canEmailAuthorizeShopFloorDevice;
exports.requestShopFloorDeviceAuthCode = requestShopFloorDeviceAuthCode;
exports.authorizeShopFloorDevice = authorizeShopFloorDevice;
exports.verifyAndAuthorizeShopFloorDeviceByCredential = verifyAndAuthorizeShopFloorDeviceByCredential;
exports.validateShopFloorDeviceRequest = validateShopFloorDeviceRequest;
exports.listShopFloorTrustedDevices = listShopFloorTrustedDevices;
exports.revokeShopFloorTrustedDevice = revokeShopFloorTrustedDevice;
exports.revokeAllShopFloorTrustedDevices = revokeAllShopFloorTrustedDevices;
exports.renderShopFloorDeviceAuthGate = renderShopFloorDeviceAuthGate;
exports.requireAuthorizedShopFloorDevice = requireAuthorizedShopFloorDevice;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../models/db");
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const dateTime_1 = require("../utils/dateTime");
const accountStatus_1 = require("../utils/accountStatus");
const siteAttendanceAccess_1 = require("../utils/siteAttendanceAccess");
const logService_1 = require("./logService");
const authService_1 = require("./authService");
exports.SHOP_FLOOR_DEVICE_COOKIE_NAME = 'oj_sf_device';
const DEVICE_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000; // 5 years
const DEVICE_CACHE_TTL_MS = 15 * 1000; // 15 seconds
const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const deviceLookupCache = new Map();
const lastSeenTouchCache = new Map();
let tableEnsured = false;
function getDeviceSecret() {
    const secret = String(env_1.env.APP_SESSION_SECRET || '').trim();
    return secret || 'urban-vibe-shop-floor-device-fallback-secret';
}
function hashShopFloorDeviceToken(rawToken) {
    return crypto_1.default
        .createHmac('sha256', getDeviceSecret())
        .update(`sf-device:${rawToken}`)
        .digest('hex');
}
function parseCookieHeader(headerValue) {
    if (!headerValue)
        return {};
    return headerValue.split(';').reduce((acc, chunk) => {
        const [rawKey, ...rawVal] = chunk.split('=');
        const key = rawKey?.trim();
        if (!key)
            return acc;
        try {
            acc[key] = decodeURIComponent(rawVal.join('=').trim());
        }
        catch {
            acc[key] = rawVal.join('=').trim();
        }
        return acc;
    }, {});
}
function buildShopFloorDeviceCookie(rawToken, expiresAtIso) {
    const expires = expiresAtIso ? new Date(expiresAtIso) : new Date(Date.now() + DEVICE_TTL_MS);
    const parts = [
        `${exports.SHOP_FLOOR_DEVICE_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Expires=${expires.toUTCString()}`,
    ];
    if (env_1.env.NODE_ENV === 'production') {
        parts.push('Secure');
    }
    return parts.join('; ');
}
function clearShopFloorDeviceCookie(res) {
    res.setHeader('Set-Cookie', buildShopFloorDeviceCookie('', new Date(0).toISOString()));
}
function isRequestOnSiteNetwork(req) {
    const clientIp = req.ip || req.socket?.remoteAddress || '';
    const normalized = (0, siteAttendanceAccess_1.normalizeIpAddress)(clientIp);
    if (['127.0.0.1', '::1', 'localhost'].includes(normalized))
        return true;
    const xForwardedFor = String(req.headers?.['x-forwarded-for'] || '');
    const allIps = [clientIp, ...xForwardedFor.split(',')].map((s) => s.trim()).filter(Boolean);
    for (const ip of allIps) {
        if ((0, siteAttendanceAccess_1.isAllowedAttendanceIp)(ip, env_1.env.ATTENDANCE_ALLOWED_IPS))
            return true;
    }
    return false;
}
function inferFriendlyDeviceLabel(userAgent) {
    const ua = String(userAgent || '');
    let os = 'Device';
    if (/iPad/i.test(ua))
        os = 'iPad';
    else if (/iPhone/i.test(ua))
        os = 'iPhone';
    else if (/Android/i.test(ua))
        os = /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
    else if (/Windows/i.test(ua))
        os = 'Windows PC';
    else if (/Macintosh|Mac OS X/i.test(ua))
        os = 'Mac';
    else if (/Linux/i.test(ua))
        os = 'Linux Device';
    let browser = '';
    if (/Edg\//i.test(ua))
        browser = 'Edge';
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua))
        browser = 'Chrome';
    else if (/Firefox\//i.test(ua))
        browser = 'Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua))
        browser = 'Safari';
    return browser ? `${os} · ${browser}` : os;
}
async function ensureTrustedDevicesTable() {
    if (tableEnsured)
        return;
    try {
        if ((0, db_1.getDatabaseDialect)() === 'mysql') {
            await (0, db_1.execute)(`
        CREATE TABLE IF NOT EXISTS shop_floor_trusted_devices (
          id VARCHAR(64) PRIMARY KEY,
          token_hash VARCHAR(128) NOT NULL,
          device_label VARCHAR(255) NOT NULL,
          authorized_by VARCHAR(255) NOT NULL,
          ip_address VARCHAR(255) NULL,
          last_ip_address VARCHAR(255) NULL,
          user_agent TEXT NULL,
          is_site_network TINYINT(1) NOT NULL DEFAULT 0,
          revoked TINYINT(1) NOT NULL DEFAULT 0,
          revoked_by VARCHAR(255) NULL,
          revoked_at DATETIME NULL,
          last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_sf_trusted_devices_token (token_hash),
          KEY idx_sf_trusted_devices_revoked (revoked, created_at)
        )
      `);
        }
        else {
            await (0, db_1.execute)(`
        CREATE TABLE IF NOT EXISTS shop_floor_trusted_devices (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          device_label TEXT NOT NULL,
          authorized_by TEXT NOT NULL,
          ip_address TEXT,
          last_ip_address TEXT,
          user_agent TEXT,
          is_site_network INTEGER NOT NULL DEFAULT 0,
          revoked INTEGER NOT NULL DEFAULT 0,
          revoked_by TEXT,
          revoked_at TEXT,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
        }
        tableEnsured = true;
    }
    catch {
        // Table may already exist via db.ts init
        tableEnsured = true;
    }
}
function mapDeviceRow(row) {
    const formatDate = (val) => {
        if (!val)
            return null;
        if (val instanceof Date)
            return val.toISOString();
        return String(val);
    };
    return {
        id: String(row.id),
        deviceLabel: String(row.device_label || 'Shop Floor Device'),
        authorizedBy: String(row.authorized_by || ''),
        ipAddress: row.ip_address ? String(row.ip_address) : null,
        lastIpAddress: row.last_ip_address ? String(row.last_ip_address) : (row.ip_address ? String(row.ip_address) : null),
        userAgent: row.user_agent ? String(row.user_agent) : null,
        isSiteNetwork: Boolean(Number(row.is_site_network)),
        revoked: Boolean(Number(row.revoked)),
        revokedBy: row.revoked_by ? String(row.revoked_by) : null,
        revokedAt: formatDate(row.revoked_at),
        lastSeenAt: formatDate(row.last_seen_at),
        createdAt: formatDate(row.created_at),
    };
}
function clearShopFloorDeviceAuthCache() {
    deviceLookupCache.clear();
}
async function canEmailAuthorizeShopFloorDevice(email) {
    const normalized = (0, authService_1.normalizeEmailAddress)(email);
    if (!normalized)
        return false;
    const localAdmin = (0, authService_1.normalizeEmailAddress)(env_1.env.AUTH_LOCAL_ADMIN_EMAIL || '');
    if (localAdmin && normalized === localAdmin)
        return true;
    const approved = await (0, repositories_1.getApprovedAuthUserByEmail)(normalized);
    if (!approved || (0, accountStatus_1.isAccountDeactivated)(approved.active, false))
        return false;
    return approved.role === 'admin' || (Array.isArray(approved.apps) && approved.apps.includes('shop-floor-admin'));
}
async function requestShopFloorDeviceAuthCode(input) {
    const email = (0, authService_1.normalizeEmailAddress)(input.email);
    if (!(await canEmailAuthorizeShopFloorDevice(email))) {
        throw new Error('Only an active Administrator or Shop Floor Admin can authorize a new Shop Floor device.');
    }
    await (0, authService_1.requestLoginCode)({
        email,
        redirectPath: '/public/shop-floor',
        ipAddress: input.ipAddress,
    });
}
async function authorizeShopFloorDevice(input) {
    await ensureTrustedDevicesTable();
    const id = crypto_1.default.randomUUID();
    const rawToken = crypto_1.default.randomBytes(32).toString('hex');
    const tokenHash = hashShopFloorDeviceToken(rawToken);
    const cleanLabel = String(input.deviceLabel || '').trim().slice(0, 120) || inferFriendlyDeviceLabel(input.userAgent);
    const authorizedBy = (0, authService_1.normalizeEmailAddress)(input.authorizedBy);
    const ip = input.ipAddress ? String(input.ipAddress).slice(0, 200) : null;
    const ua = input.userAgent ? String(input.userAgent).slice(0, 1000) : null;
    const siteFlag = input.isSiteNetwork ? 1 : 0;
    const nowIso = (0, dateTime_1.appDateTimeFromNow)(0);
    await (0, db_1.execute)(`INSERT INTO shop_floor_trusted_devices (
      id, token_hash, device_label, authorized_by, ip_address, last_ip_address,
      user_agent, is_site_network, revoked, last_seen_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, [id, tokenHash, cleanLabel, authorizedBy, ip, ip, ua, siteFlag, nowIso, nowIso]);
    const device = {
        id,
        deviceLabel: cleanLabel,
        authorizedBy,
        ipAddress: ip,
        lastIpAddress: ip,
        userAgent: ua,
        isSiteNetwork: Boolean(siteFlag),
        revoked: false,
        revokedBy: null,
        revokedAt: null,
        lastSeenAt: nowIso,
        createdAt: nowIso,
    };
    deviceLookupCache.set(tokenHash, { device, expiresAt: Date.now() + DEVICE_CACHE_TTL_MS });
    await (0, logService_1.logEvent)('info', 'Shop Floor device authorized', {
        deviceId: id,
        deviceLabel: cleanLabel,
        authorizedBy,
        ipAddress: ip,
        isSiteNetwork: Boolean(siteFlag),
    }).catch(() => undefined);
    return {
        device,
        rawToken,
        cookieHeader: buildShopFloorDeviceCookie(rawToken),
    };
}
async function verifyAndAuthorizeShopFloorDeviceByCredential(input) {
    const email = (0, authService_1.normalizeEmailAddress)(input.email);
    const context = (0, authService_1.getRequestContext)(input.req);
    if (!(await canEmailAuthorizeShopFloorDevice(email))) {
        throw new Error('Only an active Administrator or Shop Floor Admin can authorize a new Shop Floor device.');
    }
    const verified = await (0, authService_1.verifyUserCredentialWithoutSession)({
        email,
        credential: input.credential,
        ipAddress: context.ipAddress,
    });
    if (verified.role !== 'admin' && !verified.apps.includes('shop-floor-admin')) {
        throw new Error('Only an active Administrator or Shop Floor Admin can authorize a new Shop Floor device.');
    }
    const result = await authorizeShopFloorDevice({
        authorizedBy: verified.email,
        deviceLabel: input.deviceLabel,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        isSiteNetwork: isRequestOnSiteNetwork(input.req),
    });
    return {
        device: result.device,
        cookieHeader: result.cookieHeader,
        method: verified.method,
    };
}
async function validateShopFloorDeviceRequest(req) {
    const cookies = parseCookieHeader(req.headers?.cookie);
    const rawToken = String(cookies[exports.SHOP_FLOOR_DEVICE_COOKIE_NAME] || '').trim();
    if (!rawToken || rawToken.length < 32) {
        return null;
    }
    await ensureTrustedDevicesTable();
    const tokenHash = hashShopFloorDeviceToken(rawToken);
    const now = Date.now();
    const cached = deviceLookupCache.get(tokenHash);
    let device;
    if (cached && cached.expiresAt > now) {
        device = cached.device;
    }
    else {
        const row = await (0, db_1.queryOne)(`SELECT id, device_label, authorized_by, ip_address, last_ip_address, user_agent,
              is_site_network, revoked, revoked_by, revoked_at, last_seen_at, created_at
       FROM shop_floor_trusted_devices
       WHERE token_hash = ? AND revoked = 0
       LIMIT 1`, [tokenHash]);
        device = row ? mapDeviceRow(row) : null;
        deviceLookupCache.set(tokenHash, { device, expiresAt: now + DEVICE_CACHE_TTL_MS });
    }
    if (!device || device.revoked) {
        return null;
    }
    const lastTouched = lastSeenTouchCache.get(device.id) || 0;
    if (now - lastTouched >= LAST_SEEN_TOUCH_INTERVAL_MS) {
        lastSeenTouchCache.set(device.id, now);
        const context = (0, authService_1.getRequestContext)(req);
        const siteFlag = isRequestOnSiteNetwork(req) ? 1 : 0;
        const nowIso = (0, dateTime_1.appDateTimeFromNow)(0);
        void (0, db_1.execute)(`UPDATE shop_floor_trusted_devices
       SET last_seen_at = ?, last_ip_address = ?, is_site_network = ?
       WHERE id = ?`, [nowIso, context.ipAddress || null, siteFlag, device.id]).catch(() => undefined);
    }
    return device;
}
async function listShopFloorTrustedDevices(limit = 50) {
    await ensureTrustedDevicesTable();
    const rows = await (0, db_1.queryAll)(`SELECT id, device_label, authorized_by, ip_address, last_ip_address, user_agent,
            is_site_network, revoked, revoked_by, revoked_at, last_seen_at, created_at
     FROM shop_floor_trusted_devices
     ORDER BY revoked ASC, last_seen_at DESC, created_at DESC
     LIMIT ?`, [Math.max(1, limit)]);
    return rows.map(mapDeviceRow);
}
async function revokeShopFloorTrustedDevice(id, revokedBy) {
    await ensureTrustedDevicesTable();
    const nowIso = (0, dateTime_1.appDateTimeFromNow)(0);
    await (0, db_1.execute)(`UPDATE shop_floor_trusted_devices
     SET revoked = 1, revoked_by = ?, revoked_at = ?
     WHERE id = ?`, [(0, authService_1.normalizeEmailAddress)(revokedBy), nowIso, id]);
    clearShopFloorDeviceAuthCache();
    await (0, logService_1.logEvent)('warn', 'Shop Floor device revoked', { deviceId: id, revokedBy }).catch(() => undefined);
    return true;
}
async function revokeAllShopFloorTrustedDevices(revokedBy) {
    await ensureTrustedDevicesTable();
    const nowIso = (0, dateTime_1.appDateTimeFromNow)(0);
    await (0, db_1.execute)(`UPDATE shop_floor_trusted_devices
     SET revoked = 1, revoked_by = ?, revoked_at = ?
     WHERE revoked = 0`, [(0, authService_1.normalizeEmailAddress)(revokedBy), nowIso]);
    clearShopFloorDeviceAuthCache();
    await (0, logService_1.logEvent)('warn', 'All Shop Floor devices revoked', { revokedBy }).catch(() => undefined);
}
function isShopFloorApiOrAssetRequest(req) {
    const path = String(req.path || '');
    if (path.endsWith('/data')
        || path.endsWith('/verify-pin')
        || path.includes('/work-order/')
        || path.includes('/avatar')) {
        return true;
    }
    if (req.query?.format === 'json' || req.xhr)
        return true;
    const accept = String(req.get?.('accept') || '');
    if (accept.includes('application/json') && !accept.includes('text/html'))
        return true;
    return false;
}
function renderShopFloorDeviceAuthGate(req, res, options = {}) {
    const context = (0, authService_1.getRequestContext)(req);
    const canQuickAuthorize = Boolean(req.authUser && (req.authUser.role === 'admin' || req.authUser.apps?.includes('shop-floor-admin')));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.status(200).render('public-shop-floor-device-auth', {
        pageTitle: 'Authorize Shop Floor Device',
        appName: 'SHOP FLOOR',
        pwaManifest: '/public/shop-floor/manifest.webmanifest',
        pwaAppName: 'SHOP FLOOR',
        pwaThemeColor: '#714B67',
        pwaFavicon: '/public/icons/odoo-shop-floor-192.png',
        pwaIcon512: '/public/icons/odoo-shop-floor-512.png',
        pwaSkipRootSw: true,
        isSiteNetwork: isRequestOnSiteNetwork(req),
        clientIp: context.ipAddress || 'Unknown',
        suggestedDeviceLabel: options.deviceLabel || inferFriendlyDeviceLabel(context.userAgent),
        canQuickAuthorize,
        signedInAdminEmail: canQuickAuthorize ? req.authUser?.email : null,
        email: options.email || '',
        codeSent: Boolean(options.codeSent),
        message: options.message || null,
        error: options.error || null,
    });
}
/**
 * Middleware protecting /public/shop-floor and all of its sub-routes.
 * Any unrecognized/new device must first be authorized by an Admin or Shop Floor Admin.
 */
async function requireAuthorizedShopFloorDevice(req, res, next) {
    try {
        const trustedDevice = await validateShopFloorDeviceRequest(req);
        if (trustedDevice) {
            req.shopFloorTrustedDevice = trustedDevice;
            next();
            return;
        }
        if (isShopFloorApiOrAssetRequest(req)) {
            res.status(401).json({
                ok: false,
                code: 'device_not_authorized',
                message: 'This device is not authorized to access Shop Floor. Please ask an administrator to authorize this device.',
            });
            return;
        }
        renderShopFloorDeviceAuthGate(req, res, {
            error: typeof req.query?.error === 'string' ? req.query.error : null,
            message: typeof req.query?.message === 'string' ? req.query.message : null,
        });
    }
    catch (err) {
        console.error('[ShopFloorDeviceAuth] Validation error:', err);
        if (isShopFloorApiOrAssetRequest(req)) {
            res.status(500).json({ ok: false, message: 'Device authorization check failed.' });
            return;
        }
        renderShopFloorDeviceAuthGate(req, res, {
            error: 'Could not verify device authorization. Please try again.',
        });
    }
}
