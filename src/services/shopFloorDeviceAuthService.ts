import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { execute, getDatabaseDialect, queryAll, queryOne } from '../models/db';
import { getApprovedAuthUserByEmail } from '../models/repositories';
import { env } from '../utils/env';
import { appDateTimeFromNow } from '../utils/dateTime';
import { isAccountDeactivated } from '../utils/accountStatus';
import { isAllowedAttendanceIp, normalizeIpAddress } from '../utils/siteAttendanceAccess';
import { logEvent } from './logService';
import {
  getRequestContext,
  normalizeEmailAddress,
  requestLoginCode,
  verifyUserCredentialWithoutSession,
} from './authService';

export const SHOP_FLOOR_DEVICE_COOKIE_NAME = 'oj_sf_device';
const DEVICE_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000; // 5 years
const DEVICE_CACHE_TTL_MS = 15 * 1000; // 15 seconds
const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export interface ShopFloorTrustedDevice {
  id: string;
  deviceLabel: string;
  authorizedBy: string;
  ipAddress: string | null;
  lastIpAddress: string | null;
  userAgent: string | null;
  isSiteNetwork: boolean;
  revoked: boolean;
  revokedBy: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
}

type CachedDeviceLookup = {
  device: ShopFloorTrustedDevice | null;
  expiresAt: number;
};

const deviceLookupCache = new Map<string, CachedDeviceLookup>();
const lastSeenTouchCache = new Map<string, number>();
let tableEnsured = false;

function getDeviceSecret(): string {
  const secret = String(env.APP_SESSION_SECRET || '').trim();
  return secret || 'urban-vibe-shop-floor-device-fallback-secret';
}

export function hashShopFloorDeviceToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', getDeviceSecret())
    .update(`sf-device:${rawToken}`)
    .digest('hex');
}

export function parseCookieHeader(headerValue: string | undefined): Record<string, string> {
  if (!headerValue) return {};
  return headerValue.split(';').reduce<Record<string, string>>((acc, chunk) => {
    const [rawKey, ...rawVal] = chunk.split('=');
    const key = rawKey?.trim();
    if (!key) return acc;
    try {
      acc[key] = decodeURIComponent(rawVal.join('=').trim());
    } catch {
      acc[key] = rawVal.join('=').trim();
    }
    return acc;
  }, {});
}

export function buildShopFloorDeviceCookie(rawToken: string, expiresAtIso?: string): string {
  const expires = expiresAtIso ? new Date(expiresAtIso) : new Date(Date.now() + DEVICE_TTL_MS);
  const parts = [
    `${SHOP_FLOOR_DEVICE_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearShopFloorDeviceCookie(res: Response) {
  res.setHeader(
    'Set-Cookie',
    buildShopFloorDeviceCookie('', new Date(0).toISOString()),
  );
}

export function isRequestOnSiteNetwork(req: Request): boolean {
  const clientIp = req.ip || req.socket?.remoteAddress || '';
  const normalized = normalizeIpAddress(clientIp);
  if (['127.0.0.1', '::1', 'localhost'].includes(normalized)) return true;
  const xForwardedFor = String(req.headers?.['x-forwarded-for'] || '');
  const allIps = [clientIp, ...xForwardedFor.split(',')].map((s) => s.trim()).filter(Boolean);
  for (const ip of allIps) {
    if (isAllowedAttendanceIp(ip, env.ATTENDANCE_ALLOWED_IPS)) return true;
  }
  return false;
}

export function inferFriendlyDeviceLabel(userAgent: string | null | undefined): string {
  const ua = String(userAgent || '');
  let os = 'Device';
  if (/iPad/i.test(ua)) os = 'iPad';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/Android/i.test(ua)) os = /Mobile/i.test(ua) ? 'Android Phone' : 'Android Tablet';
  else if (/Windows/i.test(ua)) os = 'Windows PC';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux Device';

  let browser = '';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  return browser ? `${os} · ${browser}` : os;
}

async function ensureTrustedDevicesTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    if (getDatabaseDialect() === 'mysql') {
      await execute(`
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
    } else {
      await execute(`
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
  } catch {
    // Table may already exist via db.ts init
    tableEnsured = true;
  }
}

function mapDeviceRow(row: any): ShopFloorTrustedDevice {
  const formatDate = (val: unknown): string | null => {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString();
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

export function clearShopFloorDeviceAuthCache() {
  deviceLookupCache.clear();
}

export async function canEmailAuthorizeShopFloorDevice(email: string): Promise<boolean> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return false;
  const localAdmin = normalizeEmailAddress(env.AUTH_LOCAL_ADMIN_EMAIL || '');
  if (localAdmin && normalized === localAdmin) return true;

  const approved = await getApprovedAuthUserByEmail(normalized);
  if (!approved || isAccountDeactivated(approved.active, false)) return false;
  return approved.role === 'admin' || (Array.isArray(approved.apps) && approved.apps.includes('shop-floor-admin'));
}

export async function requestShopFloorDeviceAuthCode(input: {
  email: string;
  ipAddress: string;
}): Promise<void> {
  const email = normalizeEmailAddress(input.email);
  if (!(await canEmailAuthorizeShopFloorDevice(email))) {
    throw new Error('Only an active Administrator or Shop Floor Admin can authorize a new Shop Floor device.');
  }
  await requestLoginCode({
    email,
    redirectPath: '/public/shop-floor',
    ipAddress: input.ipAddress,
  });
}

export async function authorizeShopFloorDevice(input: {
  authorizedBy: string;
  deviceLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  isSiteNetwork?: boolean;
}): Promise<{ device: ShopFloorTrustedDevice; rawToken: string; cookieHeader: string }> {
  await ensureTrustedDevicesTable();
  const id = crypto.randomUUID();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashShopFloorDeviceToken(rawToken);
  const cleanLabel = String(input.deviceLabel || '').trim().slice(0, 120) || inferFriendlyDeviceLabel(input.userAgent);
  const authorizedBy = normalizeEmailAddress(input.authorizedBy);
  const ip = input.ipAddress ? String(input.ipAddress).slice(0, 200) : null;
  const ua = input.userAgent ? String(input.userAgent).slice(0, 1000) : null;
  const siteFlag = input.isSiteNetwork ? 1 : 0;
  const nowIso = appDateTimeFromNow(0);

  await execute(
    `INSERT INTO shop_floor_trusted_devices (
      id, token_hash, device_label, authorized_by, ip_address, last_ip_address,
      user_agent, is_site_network, revoked, last_seen_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, tokenHash, cleanLabel, authorizedBy, ip, ip, ua, siteFlag, nowIso, nowIso],
  );

  const device: ShopFloorTrustedDevice = {
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

  await logEvent('info', 'Shop Floor device authorized', {
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

export async function verifyAndAuthorizeShopFloorDeviceByCredential(input: {
  email: string;
  credential: string;
  deviceLabel?: string | null;
  req: Request;
}): Promise<{ device: ShopFloorTrustedDevice; cookieHeader: string; method: 'otp' | 'password' }> {
  const email = normalizeEmailAddress(input.email);
  const context = getRequestContext(input.req);

  if (!(await canEmailAuthorizeShopFloorDevice(email))) {
    throw new Error('Only an active Administrator or Shop Floor Admin can authorize a new Shop Floor device.');
  }

  const verified = await verifyUserCredentialWithoutSession({
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

export async function validateShopFloorDeviceRequest(req: Request): Promise<ShopFloorTrustedDevice | null> {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const rawToken = String(cookies[SHOP_FLOOR_DEVICE_COOKIE_NAME] || '').trim();
  if (!rawToken || rawToken.length < 32) {
    return null;
  }

  await ensureTrustedDevicesTable();
  const tokenHash = hashShopFloorDeviceToken(rawToken);
  const now = Date.now();
  const cached = deviceLookupCache.get(tokenHash);
  let device: ShopFloorTrustedDevice | null;

  if (cached && cached.expiresAt > now) {
    device = cached.device;
  } else {
    const row = await queryOne<any>(
      `SELECT id, device_label, authorized_by, ip_address, last_ip_address, user_agent,
              is_site_network, revoked, revoked_by, revoked_at, last_seen_at, created_at
       FROM shop_floor_trusted_devices
       WHERE token_hash = ? AND revoked = 0
       LIMIT 1`,
      [tokenHash],
    );
    device = row ? mapDeviceRow(row) : null;
    deviceLookupCache.set(tokenHash, { device, expiresAt: now + DEVICE_CACHE_TTL_MS });
  }

  if (!device || device.revoked) {
    return null;
  }

  const lastTouched = lastSeenTouchCache.get(device.id) || 0;
  if (now - lastTouched >= LAST_SEEN_TOUCH_INTERVAL_MS) {
    lastSeenTouchCache.set(device.id, now);
    const context = getRequestContext(req);
    const siteFlag = isRequestOnSiteNetwork(req) ? 1 : 0;
    const nowIso = appDateTimeFromNow(0);
    void execute(
      `UPDATE shop_floor_trusted_devices
       SET last_seen_at = ?, last_ip_address = ?, is_site_network = ?
       WHERE id = ?`,
      [nowIso, context.ipAddress || null, siteFlag, device.id],
    ).catch(() => undefined);
  }

  return device;
}

export async function listShopFloorTrustedDevices(limit = 50): Promise<ShopFloorTrustedDevice[]> {
  await ensureTrustedDevicesTable();
  const rows = await queryAll<any>(
    `SELECT id, device_label, authorized_by, ip_address, last_ip_address, user_agent,
            is_site_network, revoked, revoked_by, revoked_at, last_seen_at, created_at
     FROM shop_floor_trusted_devices
     ORDER BY revoked ASC, last_seen_at DESC, created_at DESC
     LIMIT ?`,
    [Math.max(1, limit)],
  );
  return rows.map(mapDeviceRow);
}

export async function revokeShopFloorTrustedDevice(id: string, revokedBy: string): Promise<boolean> {
  await ensureTrustedDevicesTable();
  const nowIso = appDateTimeFromNow(0);
  await execute(
    `UPDATE shop_floor_trusted_devices
     SET revoked = 1, revoked_by = ?, revoked_at = ?
     WHERE id = ?`,
    [normalizeEmailAddress(revokedBy), nowIso, id],
  );
  clearShopFloorDeviceAuthCache();
  await logEvent('warn', 'Shop Floor device revoked', { deviceId: id, revokedBy }).catch(() => undefined);
  return true;
}

export async function revokeAllShopFloorTrustedDevices(revokedBy: string): Promise<void> {
  await ensureTrustedDevicesTable();
  const nowIso = appDateTimeFromNow(0);
  await execute(
    `UPDATE shop_floor_trusted_devices
     SET revoked = 1, revoked_by = ?, revoked_at = ?
     WHERE revoked = 0`,
    [normalizeEmailAddress(revokedBy), nowIso],
  );
  clearShopFloorDeviceAuthCache();
  await logEvent('warn', 'All Shop Floor devices revoked', { revokedBy }).catch(() => undefined);
}

function isShopFloorApiOrAssetRequest(req: Request): boolean {
  const path = String(req.path || '');
  if (
    path.endsWith('/data')
    || path.endsWith('/verify-pin')
    || path.includes('/work-order/')
    || path.includes('/avatar')
  ) {
    return true;
  }
  if (req.query?.format === 'json' || req.xhr) return true;
  const accept = String(req.get?.('accept') || '');
  if (accept.includes('application/json') && !accept.includes('text/html')) return true;
  return false;
}

export function renderShopFloorDeviceAuthGate(
  req: Request,
  res: Response,
  options: {
    error?: string | null;
    message?: string | null;
    email?: string;
    deviceLabel?: string;
    codeSent?: boolean;
  } = {},
) {
  const context = getRequestContext(req);
  const canQuickAuthorize = Boolean(
    req.authUser && (req.authUser.role === 'admin' || req.authUser.apps?.includes('shop-floor-admin')),
  );
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
export async function requireAuthorizedShopFloorDevice(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const trustedDevice = await validateShopFloorDeviceRequest(req);
    if (trustedDevice) {
      (req as any).shopFloorTrustedDevice = trustedDevice;
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
  } catch (err) {
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
