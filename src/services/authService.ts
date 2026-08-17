import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import {
  consumeAllAuthChallengesForEmail,
  countRecentAuthAttempts,
  getSettings,
  getApprovedAuthUserByEmail,
  getAuthSession,
  getLatestActiveAuthLoginChallenge,
  insertAuthAttempt,
  insertAuthLoginEvent,
  insertAuthLoginChallenge,
  insertAuthSession,
  revokeAuthSession,
  revokeExpiredAuthSessions,
  touchAuthSession,
  updateAuthLoginChallenge,
} from '../models/repositories';
import { AuthRole, AuthSessionUser, MailConfig } from '../models/types';
import { logEvent } from './logService';
import { env } from '../utils/env';
import { appDateTimeFromNow } from '../utils/dateTime';
import { sendMailWithConfig } from './mailTransport';

const AUTH_COOKIE_NAME = 'oj_auth';
const OTP_LENGTH = 6;
const OTP_ATTEMPTS = 5;
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_PREFIX = 'scrypt';
export const APPROVED_USER_PASSWORD_MIN_LENGTH = 8;

export const AUTH_ROLES: AuthRole[] = ['admin', 'user'];

const ROLE_LABELS: Record<AuthRole, string> = {
  admin: 'Admin',
  user: 'Standard User',
};

type RequestLocation = {
  label: string;
  source: string;
};

function getSessionSecret(): string {
  const secret = env.APP_SESSION_SECRET.trim();
  if (!secret) {
    throw new Error('APP_SESSION_SECRET is required for app authentication.');
  }

  return secret;
}

export function normalizeAuthRole(value: string | null | undefined): AuthRole {
  return AUTH_ROLES.includes(value as AuthRole) ? value as AuthRole : 'user';
}

export function getAuthRoleLabel(value: string | null | undefined) {
  return ROLE_LABELS[normalizeAuthRole(value)];
}

function getAllowedDomains(): string[] {
  return env.AUTH_ALLOWED_DOMAINS.split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getOtpTtlMinutes(): number {
  return Math.max(1, Number(env.AUTH_OTP_TTL_MINUTES || 10));
}

function getSessionTtlHours(): number {
  return Math.max(24 * 365 * 5, Number(env.AUTH_SESSION_TTL_HOURS || 0));
}

function getRequestLimitWindowMinutes(): number {
  return Math.max(1, Number(env.AUTH_REQUEST_LIMIT_WINDOW_MINUTES || 15));
}

function getRequestLimitMax(): number {
  return Math.max(1, Number(env.AUTH_REQUEST_LIMIT_MAX || 5));
}

function getVerifyLimitWindowMinutes(): number {
  return Math.max(1, Number(env.AUTH_VERIFY_LIMIT_WINDOW_MINUTES || 15));
}

function getVerifyLimitMax(): number {
  return Math.max(1, Number(env.AUTH_VERIFY_LIMIT_MAX || 10));
}

function getOtpExpiryIso(): string {
  return appDateTimeFromNow(getOtpTtlMinutes() * 60 * 1000);
}

function getSessionExpiryIso(): string {
  return appDateTimeFromNow(getSessionTtlHours() * 60 * 60 * 1000);
}

function isValidEmailFormat(email: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
}

async function getOdooAccess(email: string): Promise<{ allowed: boolean; role: AuthRole; apps?: import('../models/types').AppFeature[] }> {
  // Check access-control table first — shop floor users don't need Odoo user accounts
  const approvedUser = await getApprovedAuthUserByEmail(email);
  if (approvedUser?.active) {
    return { allowed: true, role: normalizeAuthRole(approvedUser.role), apps: approvedUser.apps };
  }

  if (normalizeEmailAddress(env.AUTH_LOCAL_ADMIN_EMAIL || '') === normalizeEmailAddress(email)) {
    return { allowed: true, role: 'admin' };
  }

  // Access-control rows now act as optional role overrides.
  // Odoo user existence is the source of truth for whether the user may sign in.
  return { allowed: false, role: 'user' };
}

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isAllowedEmailDomain(email: string): boolean {
  const normalized = normalizeEmailAddress(email);
  const [, domain = ''] = normalized.split('@');
  return getAllowedDomains().includes(domain);
}

function createOtpCode(): string {
  const minimum = 10 ** (OTP_LENGTH - 1);
  const maximum = 10 ** OTP_LENGTH - 1;
  return String(crypto.randomInt(minimum, maximum + 1));
}

function hashValue(value: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('hex');
}

function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function scryptPassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_HASH_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

export async function hashApprovedUserPassword(password: string): Promise<string> {
  if (password.length < APPROVED_USER_PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${APPROVED_USER_PASSWORD_MIN_LENGTH} characters.`);
  }

  const salt = crypto.randomBytes(16).toString('base64');
  const derivedKey = await scryptPassword(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey.toString('base64')}`;
}

async function verifyApprovedUserPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  const [prefix, salt, hash] = storedHash.split('$');
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !hash) {
    return false;
  }

  try {
    const expected = Buffer.from(hash, 'base64');
    const provided = await scryptPassword(password, salt);
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

function getUserAgentHash(value: string): string {
  return hashValue(value || 'unknown-user-agent');
}

function signCookieValue(sessionId: string): string {
  const signature = hashValue(`session:${sessionId}`);
  return `${sessionId}.${signature}`;
}

function unsignCookieValue(value: string): string | null {
  const [sessionId, signature] = value.split('.');
  if (!sessionId || !signature) {
    return null;
  }

  const expected = hashValue(`session:${sessionId}`);
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer) ? sessionId : null;
}

function parseCookies(headerValue: string | undefined): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  return headerValue.split(';').reduce<Record<string, string>>((accumulator, chunk) => {
    const [rawKey, ...rawValue] = chunk.split('=');
    const key = rawKey?.trim();
    if (!key) {
      return accumulator;
    }

    accumulator[key] = decodeURIComponent(rawValue.join('=').trim());
    return accumulator;
  }, {});
}

function firstHeaderValue(req: Request, names: string[]): string {
  for (const name of names) {
    const value = req.get(name);
    if (value) {
      return value.split(',')[0].trim();
    }
  }

  return '';
}

function decodeHeaderValue(value: string): string {
  const normalized = value.replace(/\+/g, ' ').trim();
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function normalizeIpAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'unknown';
  }

  return trimmed
    .replace(/^::ffff:/i, '')
    .replace(/^\[/, '')
    .replace(/\]$/, '');
}

function isPrivateOrLocalIpAddress(value: string): boolean {
  const ipAddress = normalizeIpAddress(value);
  if (
    ipAddress === 'unknown' ||
    ipAddress === '::1' ||
    ipAddress === '127.0.0.1' ||
    ipAddress === 'localhost' ||
    ipAddress.startsWith('127.') ||
    ipAddress.startsWith('10.') ||
    ipAddress.startsWith('192.168.')
  ) {
    return true;
  }

  const match = ipAddress.match(/^172\.(\d{1,2})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function getClientIpAddress(req: Request): string {
  if (Array.isArray(req.ips) && req.ips.length > 0) {
    return normalizeIpAddress(req.ips[0]);
  }

  return normalizeIpAddress(req.ip || req.socket.remoteAddress || 'unknown');
}

function getRequestLocation(req: Request, ipAddress: string): RequestLocation {
  const city = decodeHeaderValue(firstHeaderValue(req, [
    'cf-ipcity',
    'x-vercel-ip-city',
    'x-appengine-city',
    'x-city',
  ]));
  const region = decodeHeaderValue(firstHeaderValue(req, [
    'cf-region',
    'x-vercel-ip-country-region',
    'x-appengine-region',
    'x-region',
  ]));
  const country = decodeHeaderValue(firstHeaderValue(req, [
    'cf-ipcountry',
    'x-vercel-ip-country',
    'x-appengine-country',
    'x-country-code',
    'x-forwarded-country',
  ]));
  const timezone = decodeHeaderValue(firstHeaderValue(req, [
    'cf-timezone',
    'x-vercel-ip-timezone',
    'x-timezone',
  ]));
  const parts = [city, region, country].filter(Boolean);

  if (parts.length) {
    return {
      label: timezone ? `${parts.join(', ')} (${timezone})` : parts.join(', '),
      source: 'proxy_headers',
    };
  }

  if (isPrivateOrLocalIpAddress(ipAddress)) {
    return {
      label: 'Local network',
      source: 'private_ip',
    };
  }

  return {
    label: 'Unknown',
    source: 'unavailable',
  };
}

function sanitizeRedirectPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/dashboard';
  }

  if (trimmed.startsWith('/auth')) {
    return '/dashboard';
  }

  return trimmed;
}

async function sendOtpEmail(email: string, otpCode: string, mailConfig: MailConfig) {
  const options = {
    to: email,
    subject: 'Your Urban Vibe app login code',
    text: [
      `Your one-time login code is: ${otpCode}`,
      '',
      `This code expires in ${getOtpTtlMinutes()} minute(s).`,
      'If you did not request this code, you can ignore this email.',
    ].join('\n'),
  };

  const result = await sendMailWithConfig(mailConfig, options);
  const info = result.info;

  return {
    messageId: info && typeof info === 'object' && 'messageId' in info
      ? String((info as { messageId?: unknown }).messageId || '')
      : null,
    transport: result.transport,
    username: result.username,
    fromEmail: result.fromEmail,
  };
}

function readErrorField(error: unknown, key: string) {
  return error && typeof error === 'object' && key in error
    ? String((error as Record<string, unknown>)[key] || '')
    : '';
}

function getOtpEmailFailureMessage(error: unknown) {
  const code = readErrorField(error, 'code');
  const response = readErrorField(error, 'response');
  const message = error instanceof Error ? error.message : String(error || '');
  const detail = `${code} ${response} ${message}`;

  if (/535|EAUTH|invalid login|incorrect authentication|auth/i.test(detail)) {
    return 'Email service login failed. Check the outgoing mail username and password in Settings.';
  }

  if (/timeout|ETIMEDOUT|ESOCKET|ECONNECTION/i.test(detail)) {
    return 'Email service connection timed out. Check the outgoing mail host, port, TLS mode, and hosting firewall access in Settings.';
  }

  return 'Could not send the login code email. Check outgoing mail settings and try again.';
}

async function createAuthenticatedSession(input: {
  email: string;
  role: AuthRole;
  apps?: import('../models/types').AppFeature[];
  ipAddress: string;
  userAgent: string;
}) {
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = getSessionExpiryIso();
  const sessionId = await insertAuthSession({
    email: input.email,
    role: normalizeAuthRole(input.role),
    apps: input.apps,
    csrfToken,
    userAgentHash: getUserAgentHash(input.userAgent),
    ipAddress: input.ipAddress,
    expiresAt,
  });

  return {
    sessionCookie: buildSessionCookie(signCookieValue(sessionId), expiresAt),
    user: {
      email: input.email,
      role: normalizeAuthRole(input.role),
      apps: input.apps,
    } satisfies AuthSessionUser,
  };
}

async function isWithinRecentLimit(scope: string, email: string, ipAddress: string): Promise<boolean> {
  const windowMinutes =
    scope === 'otp_request' ? getRequestLimitWindowMinutes() : getVerifyLimitWindowMinutes();
  const max =
    scope === 'otp_request' ? getRequestLimitMax() : getVerifyLimitMax();

  const emailCount = await countRecentAuthAttempts(scope, windowMinutes, { email });
  const ipCount = await countRecentAuthAttempts(scope, windowMinutes, { ipAddress });
  return emailCount >= max || ipCount >= max;
}

async function isWithinRecentFailedPasswordLimit(email: string, ipAddress: string): Promise<boolean> {
  const windowMinutes = getVerifyLimitWindowMinutes();
  const max = getVerifyLimitMax();
  const emailCount = await countRecentAuthAttempts('password_login', windowMinutes, { email, success: false });
  const ipCount = await countRecentAuthAttempts('password_login', windowMinutes, { ipAddress, success: false });
  return emailCount >= max || ipCount >= max;
}

function buildSessionCookie(value: string, expiresAt: string): string {
  const attributes = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];

  if (env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

export function clearAuthCookie(res: Response) {
  res.setHeader(
    'Set-Cookie',
    buildSessionCookie('', new Date(0).toISOString()),
  );
}

export async function recordAuthLoginEvent(input: {
  email?: string | null;
  role?: AuthRole | null;
  eventType: 'login' | 'logout' | 'activity' | 'password_reset';
  authMethod?: string | null;
  success: boolean;
  ipAddress?: string | null;
  location?: RequestLocation | null;
  userAgent?: string | null;
  detail?: string | null;
}) {
  try {
    await insertAuthLoginEvent({
      email: input.email ? normalizeEmailAddress(input.email) : null,
      role: input.role ? normalizeAuthRole(input.role) : null,
      eventType: input.eventType,
      authMethod: input.authMethod || null,
      success: input.success,
      ipAddress: input.ipAddress || null,
      locationLabel: input.location?.label || null,
      locationSource: input.location?.source || null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 1200) : null,
      detail: input.detail ? input.detail.slice(0, 700) : null,
    });
  } catch (error) {
    await logEvent('error', 'Could not save authentication history event', {
      email: input.email,
      eventType: input.eventType,
      authMethod: input.authMethod,
      ipAddress: input.ipAddress,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}

export async function requestLoginCode(input: {
  email: string;
  redirectPath?: string;
  ipAddress: string;
}) {
  const email = normalizeEmailAddress(input.email);

  if (!isValidEmailFormat(email)) {
    throw new Error('Enter a valid work email address.');
  }

  if (!(await getOdooAccess(email)).allowed) {
    throw new Error('This email address is not an active approved app user.');
  }

  if (await isWithinRecentLimit('otp_request', email, input.ipAddress)) {
    throw new Error('Too many login code requests. Please wait a few minutes and try again.');
  }

  const otpCode = createOtpCode();
  await consumeAllAuthChallengesForEmail(email);
  await insertAuthLoginChallenge({
    email,
    codeHash: hashValue(`${email}:${otpCode}`),
    redirectPath: sanitizeRedirectPath(input.redirectPath || '/dashboard'),
    expiresAt: getOtpExpiryIso(),
    attemptsRemaining: OTP_ATTEMPTS,
    requestedIp: input.ipAddress,
  });

  const mailConfig = (await getSettings()).mail;
  let mailResult: Awaited<ReturnType<typeof sendOtpEmail>> | null = null;
  try {
    mailResult = await sendOtpEmail(email, otpCode, mailConfig);
  } catch (error) {
    await consumeAllAuthChallengesForEmail(email).catch(() => undefined);
    await insertAuthAttempt({
      scope: 'otp_request',
      email,
      ipAddress: input.ipAddress,
      success: false,
    }).catch(() => undefined);
    await logEvent('error', 'Login code email failed', {
      email,
      ipAddress: input.ipAddress,
      smtpHost: mailConfig.host,
      smtpPort: String(mailConfig.port),
      smtpSecure: String(mailConfig.secure),
      smtpTransport: mailConfig.transport,
      smtpUsername: mailConfig.accounts
        .filter((account) => account.enabled && account.username)
        .map((account) => account.username)
        .join(', '),
      smtpFromEmail: mailConfig.accounts.find((account) => account.enabled && account.fromEmail)?.fromEmail || '',
      errorCode: readErrorField(error, 'code'),
      smtpResponse: readErrorField(error, 'response'),
      errorMessage: error instanceof Error ? error.message : String(error || ''),
    }).catch(() => undefined);

    throw new Error(getOtpEmailFailureMessage(error));
  }

  await insertAuthAttempt({
    scope: 'otp_request',
    email,
    ipAddress: input.ipAddress,
    success: true,
  });
  await logEvent('info', 'Login code sent', {
    email,
    ipAddress: input.ipAddress,
    messageId: mailResult?.messageId || null,
    mailTransport: mailResult?.transport || null,
    smtpUsername: mailResult?.username || null,
    mailFromEmail: mailResult?.fromEmail || null,
  });
}

export async function verifyLoginCode(input: {
  email: string;
  otpCode: string;
  ipAddress: string;
  userAgent: string;
}) {
  const email = normalizeEmailAddress(input.email);
  const otpCode = input.otpCode.trim();

  if (!isValidEmailFormat(email) || !/^\d{6}$/.test(otpCode)) {
    throw new Error('Enter a valid email address and 6-digit code.');
  }

  if (await isWithinRecentLimit('otp_verify', email, input.ipAddress)) {
    throw new Error('Too many verification attempts. Please request a new code in a few minutes.');
  }

  const challenge = await getLatestActiveAuthLoginChallenge(email);
  if (!challenge) {
    await insertAuthAttempt({ scope: 'otp_verify', email, ipAddress: input.ipAddress, success: false });
    throw new Error('The login code is missing or expired. Request a new code.');
  }

  const providedHash = hashValue(`${email}:${otpCode}`);
  const providedBuffer = Buffer.from(providedHash, 'hex');
  const storedBuffer = Buffer.from(challenge.codeHash, 'hex');
  const isMatch =
    providedBuffer.length === storedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, storedBuffer);

  if (!isMatch) {
    await updateAuthLoginChallenge(challenge.id, {
      attemptsRemaining: Math.max(0, challenge.attemptsRemaining - 1),
      consumed: challenge.attemptsRemaining - 1 <= 0,
    });
    await insertAuthAttempt({ scope: 'otp_verify', email, ipAddress: input.ipAddress, success: false });
    throw new Error('The login code is invalid. Check the email and try again.');
  }

  const approvedAccess = await getOdooAccess(email);
  if (!approvedAccess.allowed) {
    await updateAuthLoginChallenge(challenge.id, { consumed: true });
    throw new Error('This email address is not an active approved app user.');
  }

  await updateAuthLoginChallenge(challenge.id, { consumed: true });
  await insertAuthAttempt({ scope: 'otp_verify', email, ipAddress: input.ipAddress, success: true });
  await logEvent('info', 'Login succeeded', {
    email,
    ipAddress: input.ipAddress,
  });

  const authenticatedSession = await createAuthenticatedSession({
    email,
    role: approvedAccess.role,
    apps: approvedAccess.apps,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    sessionCookie: authenticatedSession.sessionCookie,
    redirectPath: approvedAccess.role !== 'admin' && approvedAccess.apps?.includes('shop-floor') ? '/shop-floor' : challenge.redirectPath,
    user: authenticatedSession.user,
  };
}

export async function verifyLocalPasswordLogin(input: {
  email: string;
  password: string;
  ipAddress: string;
  userAgent: string;
}) {
  const email = normalizeEmailAddress(input.email);
  const configuredEmail = normalizeEmailAddress(env.AUTH_LOCAL_ADMIN_EMAIL || '');
  const configuredPassword = env.AUTH_LOCAL_ADMIN_PASSWORD || '';

  if (!isValidEmailFormat(email) || !input.password) {
    throw new Error('Enter a valid email address and password.');
  }

  const approvedUser = await getApprovedAuthUserByEmail(email);
  if (
    approvedUser?.active &&
    approvedUser?.passwordHash &&
    await verifyApprovedUserPassword(input.password, approvedUser.passwordHash)
  ) {
    await insertAuthAttempt({ scope: 'password_login', email, ipAddress: input.ipAddress, success: true });
    await logEvent('info', 'Approved user password login succeeded', {
      email,
      ipAddress: input.ipAddress,
      role: approvedUser.role,
      active: approvedUser.active,
    });

    const authenticatedSession = await createAuthenticatedSession({
      email,
      role: approvedUser.role,
      apps: approvedUser.apps,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      sessionCookie: authenticatedSession.sessionCookie,
      redirectPath: approvedUser.role !== 'admin' && approvedUser.apps?.includes('shop-floor') ? '/shop-floor' : '/dashboard',
      user: authenticatedSession.user,
    };
  }

  if (configuredEmail && configuredPassword) {
    if (timingSafeEqualStrings(email, configuredEmail) && timingSafeEqualStrings(input.password, configuredPassword)) {
      await insertAuthAttempt({ scope: 'password_login', email, ipAddress: input.ipAddress, success: true });
      await logEvent('info', 'Local admin password login succeeded', {
        email,
        ipAddress: input.ipAddress,
      });

      const authenticatedSession = await createAuthenticatedSession({
        email,
        role: 'admin',
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return {
        sessionCookie: authenticatedSession.sessionCookie,
        redirectPath: '/dashboard',
        user: authenticatedSession.user,
      };
    }
  }

  if (await isWithinRecentFailedPasswordLimit(email, input.ipAddress)) {
    throw new Error('Too many failed password sign-in attempts. Please wait a few minutes and try again.');
  }

  await insertAuthAttempt({ scope: 'password_login', email, ipAddress: input.ipAddress, success: false });
  throw new Error('The email or password is invalid.');
}

export function getAuthenticationState(req: Request): {
  user: AuthSessionUser | null;
  csrfToken: string | null;
  sessionId: string | null;
} {
  // Storage is async now, so auth state is attached through attachAuthState.
  return { user: null, csrfToken: null, sessionId: null };
}

export async function getAuthenticationStateAsync(req: Request): Promise<{
  user: AuthSessionUser | null;
  csrfToken: string | null;
  sessionId: string | null;
}> {
  const cookies = parseCookies(req.headers.cookie);
  const signedCookie = cookies[AUTH_COOKIE_NAME];
  if (!signedCookie) {
    return { user: null, csrfToken: null, sessionId: null };
  }

  const sessionId = unsignCookieValue(signedCookie);
  if (!sessionId) {
    return { user: null, csrfToken: null, sessionId: null };
  }

  const session = await getAuthSession(sessionId);
  if (!session || session.revokedAt) {
    return { user: null, csrfToken: null, sessionId: null };
  }

  await touchAuthSession(sessionId, getSessionExpiryIso());
  const currentAccess = await getApprovedAuthUserByEmail(session.user.email);
  const currentUser = currentAccess?.active
    ? {
        ...session.user,
        role: normalizeAuthRole(currentAccess.role),
        apps: currentAccess.apps || [],
      }
    : session.user;

  return {
    user: currentUser,
    csrfToken: session.csrfToken,
    sessionId,
  };
}

export async function attachAuthState(req: Request, res: Response, next: NextFunction) {
  const state = await getAuthenticationStateAsync(req);
  req.authUser = state.user;
  req.authSessionId = state.sessionId;
  req.csrfToken = state.csrfToken;
  res.locals.authUser = state.user;
  res.locals.csrfToken = state.csrfToken;
  res.locals.isAuthenticated = Boolean(state.user);

  // ── Impersonation: admin can "Login As" another user ──
  const cookies = parseCookies(req.get('cookie'));
  const isAdministrativePath = req.path.startsWith('/settings') || req.path.startsWith('/setup');
  if (isAdministrativePath && state.user?.role === 'admin' && cookies.oj_impersonate) {
    res.clearCookie('oj_impersonate', { path: '/' });
  } else if ((state.user?.role === 'admin' || state.user?.apps?.includes('shop-floor-admin')) && cookies.oj_impersonate) {
    try {
      const imp = JSON.parse(cookies.oj_impersonate);
      if (imp.email) {
        const currentImpersonatedAccess = await getApprovedAuthUserByEmail(String(imp.email));
        if (!currentImpersonatedAccess?.active) {
          res.clearCookie('oj_impersonate', { path: '/' });
          return next();
        }
        const impersonatedUser: AuthSessionUser = {
          email: imp.email,
          role: currentImpersonatedAccess.role,
          apps: currentImpersonatedAccess.apps || [],
        };
        req.impersonatedBy = state.user;
        req.viewingAsUser = impersonatedUser;
        res.locals.viewingAsUser = impersonatedUser;
        res.locals.impersonatedBy = state.user;
        res.locals.isImpersonating = true;
      }
    } catch {
      // Invalid cookie, ignore
    }
  }

  // Set canAccess helper for EJS templates based on current authUser
  const currentUser = req.viewingAsUser || req.authUser;
  res.locals.canAccess = (method: string, path: string) => canAccessPath(currentUser, method, path);

  next();
}

export function requireAuthentication(req: Request, res: Response, next: NextFunction) {
  if (req.authUser) {
    next();
    return;
  }

  const nextPath = sanitizeRedirectPath(req.originalUrl || '/dashboard');
  if (req.get('accept')?.includes('application/json') || req.xhr) {
    res.status(401).json({
      ok: false,
      code: 'session_expired',
      message: 'Your session has expired. Sign in again, then retry this job.',
      loginUrl: `/login?next=${encodeURIComponent(nextPath)}`,
    });
    return;
  }
  res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}

export function canAccessPath(
  user: AuthSessionUser | null | undefined,
  method: string,
  requestPath: string,
) {
  if (!user) {
    return false;
  }

  const role = normalizeAuthRole(user.role);
  const normalizedMethod = method.toUpperCase();
  const isGet = normalizedMethod === 'GET' || normalizedMethod === 'HEAD';

  if (role === 'admin') {
    return true;
  }

  if (requestPath === '/logout') {
    return true;
  }

  const apps = user.apps || [];

  if (requestPath === '/settings/access/login-as') {
    if (apps.includes('shop-floor-admin')) return true;
  }

  if (requestPath.startsWith('/settings') || requestPath.startsWith('/setup')) {
    return false;
  }

  if (requestPath.startsWith('/dashboard') || requestPath === '/' || requestPath === '/auth/return-to-admin') {
    return true;
  }

  if (requestPath === '/api/usage' || requestPath === '/usage') {
    return user.role === 'admin';
  }

  if (requestPath.startsWith('/mpesa-reconciliation') && apps.includes('mpesa')) return true;
  if (requestPath.startsWith('/po-bill-automation') && apps.includes('po-automation')) return true;
  if (requestPath.startsWith('/purchase-orders') && apps.includes('purchase-orders')) return true;
  if (requestPath.startsWith('/sales-orders') && apps.includes('sales-orders')) return true;
  if ((requestPath.startsWith('/invoice-parser') || requestPath.startsWith('/api/invoices')) && apps.includes('invoice-parser')) return true;
  if (requestPath.startsWith('/extractions') && apps.includes('extractions')) return true;
  if (requestPath.startsWith('/shop-floor/operators') && apps.includes('shop-floor-admin')) return true;
  if (requestPath.startsWith('/shop-floor') && apps.includes('shop-floor')) return true;
  if (requestPath.startsWith('/jobs') && apps.includes('jobs')) return true;

  return false;
}

export function requireAuthorizedAccess(req: Request, res: Response, next: NextFunction) {
  const effectiveUser = req.viewingAsUser || req.authUser;
  const administratorPreview =
    Boolean(req.viewingAsUser) &&
    normalizeAuthRole(req.authUser?.role) === 'admin';
  if (administratorPreview || canAccessPath(effectiveUser, req.method, req.path)) {
    next();
    return;
  }

  if (req.get('accept')?.includes('application/json') || req.xhr) {
    res.status(403).json({
      ok: false,
      code: 'permission_denied',
      message: 'Your account role does not have access to this area.',
    });
    return;
  }
  res.status(403).render('error', {
    pageTitle: 'Access Denied',
    errorMessage: 'Your account role does not have access to this area.',
    details: effectiveUser
      ? [`Signed in as ${effectiveUser.email}`, `Role: ${getAuthRoleLabel(effectiveUser.role)}`]
      : [],
  });
}

export function enforceCsrf(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/staff-onboarding') {
    next();
    return;
  }
  if (!req.authUser) {
    next();
    return;
  }

  if (req.method !== 'POST') {
    next();
    return;
  }

  if (req.path === '/auth/request-code' || req.path === '/auth/verify-code') {
    next();
    return;
  }

  if (req.path === '/jobs/run-scheduler' && typeof req.query.token === 'string') {
    next();
    return;
  }

  if (req.path === '/jobs/attachment-uploaded') {
    next();
    return;
  }

  if (req.path === '/api/invoices/parse') {
    next();
    return;
  }

  const submittedToken = String(req.body?._csrf || req.get('x-csrf-token') || req.query._csrf || '');
  if (!submittedToken || !req.csrfToken || submittedToken !== req.csrfToken) {
    if (req.get('accept')?.includes('application/json') || req.xhr) {
      res.status(403).json({
        ok: false,
        code: 'csrf_invalid',
        message: 'Your security token has expired. Refresh the page, then try again.',
        refreshUrl: '/shop-floor?refresh=true#manufacturing-orders',
      });
      return;
    }
    res.status(403).render('error', {
      pageTitle: 'Security Check Failed',
      errorMessage: 'The security token for this form is missing or invalid.',
      details: [],
    });
    return;
  }

  next();
}

export function getSafeRedirectPath(req: Request): string {
  return sanitizeRedirectPath(String(req.query.next || req.body?.next || '/dashboard'));
}

export function getRequestContext(req: Request) {
  const ipAddress = getClientIpAddress(req);

  return {
    ipAddress,
    userAgent: req.get('user-agent') || '',
    location: getRequestLocation(req, ipAddress),
  };
}

export async function logoutAuthenticatedSession(req: Request) {
  if (req.authSessionId) {
    await revokeAuthSession(req.authSessionId);
  }

  if (req.authUser) {
    const requestContext = getRequestContext(req);
    await logEvent('info', 'Logout completed', {
      email: req.authUser.email,
      ipAddress: requestContext.ipAddress,
    });
    await recordAuthLoginEvent({
      email: req.authUser.email,
      role: req.authUser.role || null,
      eventType: 'logout',
      authMethod: 'session',
      success: true,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: 'User signed out.',
    });
  }
}
