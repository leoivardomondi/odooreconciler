"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTH_ROLES = exports.APPROVED_USER_PASSWORD_MIN_LENGTH = void 0;
exports.normalizeAuthRole = normalizeAuthRole;
exports.getAuthRoleLabel = getAuthRoleLabel;
exports.normalizeEmailAddress = normalizeEmailAddress;
exports.isAllowedEmailDomain = isAllowedEmailDomain;
exports.hashApprovedUserPassword = hashApprovedUserPassword;
exports.clearAuthCookie = clearAuthCookie;
exports.recordAuthLoginEvent = recordAuthLoginEvent;
exports.requestLoginCode = requestLoginCode;
exports.verifyLoginCode = verifyLoginCode;
exports.verifyLocalPasswordLogin = verifyLocalPasswordLogin;
exports.getAuthenticationState = getAuthenticationState;
exports.getAuthenticationStateAsync = getAuthenticationStateAsync;
exports.attachAuthState = attachAuthState;
exports.requireAuthentication = requireAuthentication;
exports.canAccessPath = canAccessPath;
exports.requireAuthorizedAccess = requireAuthorizedAccess;
exports.enforceCsrf = enforceCsrf;
exports.getSafeRedirectPath = getSafeRedirectPath;
exports.getRequestContext = getRequestContext;
exports.logoutAuthenticatedSession = logoutAuthenticatedSession;
const crypto_1 = __importDefault(require("crypto"));
const repositories_1 = require("../models/repositories");
const logService_1 = require("./logService");
const env_1 = require("../utils/env");
const dateTime_1 = require("../utils/dateTime");
const mailTransport_1 = require("./mailTransport");
const AUTH_COOKIE_NAME = 'oj_auth';
const OTP_LENGTH = 6;
const OTP_ATTEMPTS = 5;
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_PREFIX = 'scrypt';
exports.APPROVED_USER_PASSWORD_MIN_LENGTH = 8;
exports.AUTH_ROLES = ['admin', 'user'];
const ROLE_LABELS = {
    admin: 'Admin',
    user: 'Standard User',
};
function getSessionSecret() {
    const secret = env_1.env.APP_SESSION_SECRET.trim();
    if (!secret) {
        throw new Error('APP_SESSION_SECRET is required for app authentication.');
    }
    return secret;
}
function normalizeAuthRole(value) {
    return exports.AUTH_ROLES.includes(value) ? value : 'user';
}
function getAuthRoleLabel(value) {
    return ROLE_LABELS[normalizeAuthRole(value)];
}
function getAllowedDomains() {
    return env_1.env.AUTH_ALLOWED_DOMAINS.split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
}
function getOtpTtlMinutes() {
    return Math.max(1, Number(env_1.env.AUTH_OTP_TTL_MINUTES || 10));
}
function getSessionTtlHours() {
    return Math.max(24 * 365 * 5, Number(env_1.env.AUTH_SESSION_TTL_HOURS || 0));
}
function getRequestLimitWindowMinutes() {
    return Math.max(1, Number(env_1.env.AUTH_REQUEST_LIMIT_WINDOW_MINUTES || 15));
}
function getRequestLimitMax() {
    return Math.max(1, Number(env_1.env.AUTH_REQUEST_LIMIT_MAX || 5));
}
function getVerifyLimitWindowMinutes() {
    return Math.max(1, Number(env_1.env.AUTH_VERIFY_LIMIT_WINDOW_MINUTES || 15));
}
function getVerifyLimitMax() {
    return Math.max(1, Number(env_1.env.AUTH_VERIFY_LIMIT_MAX || 10));
}
function getOtpExpiryIso() {
    return (0, dateTime_1.appDateTimeFromNow)(getOtpTtlMinutes() * 60 * 1000);
}
function getSessionExpiryIso() {
    return (0, dateTime_1.appDateTimeFromNow)(getSessionTtlHours() * 60 * 60 * 1000);
}
function isValidEmailFormat(email) {
    return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
}
async function getOdooAccess(email) {
    // Check access-control table first — shop floor users don't need Odoo user accounts
    const approvedUser = await (0, repositories_1.getApprovedAuthUserByEmail)(email);
    if (approvedUser?.active) {
        return { allowed: true, role: normalizeAuthRole(approvedUser.role), apps: approvedUser.apps };
    }
    if (normalizeEmailAddress(env_1.env.AUTH_LOCAL_ADMIN_EMAIL || '') === normalizeEmailAddress(email)) {
        return { allowed: true, role: 'admin' };
    }
    // Access-control rows now act as optional role overrides.
    // Odoo user existence is the source of truth for whether the user may sign in.
    return { allowed: false, role: 'user' };
}
function normalizeEmailAddress(value) {
    return value.trim().toLowerCase();
}
function isAllowedEmailDomain(email) {
    const normalized = normalizeEmailAddress(email);
    const [, domain = ''] = normalized.split('@');
    return getAllowedDomains().includes(domain);
}
function createOtpCode() {
    const minimum = 10 ** (OTP_LENGTH - 1);
    const maximum = 10 ** OTP_LENGTH - 1;
    return String(crypto_1.default.randomInt(minimum, maximum + 1));
}
function hashValue(value) {
    return crypto_1.default.createHmac('sha256', getSessionSecret()).update(value).digest('hex');
}
function timingSafeEqualStrings(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
}
function scryptPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto_1.default.scrypt(password, salt, PASSWORD_HASH_KEY_LENGTH, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(derivedKey);
        });
    });
}
async function hashApprovedUserPassword(password) {
    if (password.length < exports.APPROVED_USER_PASSWORD_MIN_LENGTH) {
        throw new Error(`Password must be at least ${exports.APPROVED_USER_PASSWORD_MIN_LENGTH} characters.`);
    }
    const salt = crypto_1.default.randomBytes(16).toString('base64');
    const derivedKey = await scryptPassword(password, salt);
    return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey.toString('base64')}`;
}
async function verifyApprovedUserPassword(password, storedHash) {
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
        return expected.length === provided.length && crypto_1.default.timingSafeEqual(expected, provided);
    }
    catch {
        return false;
    }
}
function getUserAgentHash(value) {
    return hashValue(value || 'unknown-user-agent');
}
function signCookieValue(sessionId) {
    const signature = hashValue(`session:${sessionId}`);
    return `${sessionId}.${signature}`;
}
function unsignCookieValue(value) {
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
    return crypto_1.default.timingSafeEqual(signatureBuffer, expectedBuffer) ? sessionId : null;
}
function parseCookies(headerValue) {
    if (!headerValue) {
        return {};
    }
    return headerValue.split(';').reduce((accumulator, chunk) => {
        const [rawKey, ...rawValue] = chunk.split('=');
        const key = rawKey?.trim();
        if (!key) {
            return accumulator;
        }
        accumulator[key] = decodeURIComponent(rawValue.join('=').trim());
        return accumulator;
    }, {});
}
function firstHeaderValue(req, names) {
    for (const name of names) {
        const value = req.get(name);
        if (value) {
            return value.split(',')[0].trim();
        }
    }
    return '';
}
function decodeHeaderValue(value) {
    const normalized = value.replace(/\+/g, ' ').trim();
    try {
        return decodeURIComponent(normalized);
    }
    catch {
        return normalized;
    }
}
function normalizeIpAddress(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return 'unknown';
    }
    return trimmed
        .replace(/^::ffff:/i, '')
        .replace(/^\[/, '')
        .replace(/\]$/, '');
}
function isPrivateOrLocalIpAddress(value) {
    const ipAddress = normalizeIpAddress(value);
    if (ipAddress === 'unknown' ||
        ipAddress === '::1' ||
        ipAddress === '127.0.0.1' ||
        ipAddress === 'localhost' ||
        ipAddress.startsWith('127.') ||
        ipAddress.startsWith('10.') ||
        ipAddress.startsWith('192.168.')) {
        return true;
    }
    const match = ipAddress.match(/^172\.(\d{1,2})\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}
function getClientIpAddress(req) {
    if (Array.isArray(req.ips) && req.ips.length > 0) {
        return normalizeIpAddress(req.ips[0]);
    }
    return normalizeIpAddress(req.ip || req.socket.remoteAddress || 'unknown');
}
function getRequestLocation(req, ipAddress) {
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
function sanitizeRedirectPath(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
        return '/dashboard';
    }
    if (trimmed.startsWith('/auth')) {
        return '/dashboard';
    }
    return trimmed;
}
async function sendOtpEmail(email, otpCode, mailConfig) {
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
    const result = await (0, mailTransport_1.sendMailWithConfig)(mailConfig, options);
    const info = result.info;
    return {
        messageId: info && typeof info === 'object' && 'messageId' in info
            ? String(info.messageId || '')
            : null,
        transport: result.transport,
        username: result.username,
        fromEmail: result.fromEmail,
    };
}
function readErrorField(error, key) {
    return error && typeof error === 'object' && key in error
        ? String(error[key] || '')
        : '';
}
function getOtpEmailFailureMessage(error) {
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
async function createAuthenticatedSession(input) {
    const csrfToken = crypto_1.default.randomBytes(24).toString('hex');
    const expiresAt = getSessionExpiryIso();
    const sessionId = await (0, repositories_1.insertAuthSession)({
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
        },
    };
}
async function isWithinRecentLimit(scope, email, ipAddress) {
    const windowMinutes = scope === 'otp_request' ? getRequestLimitWindowMinutes() : getVerifyLimitWindowMinutes();
    const max = scope === 'otp_request' ? getRequestLimitMax() : getVerifyLimitMax();
    const emailCount = await (0, repositories_1.countRecentAuthAttempts)(scope, windowMinutes, { email });
    const ipCount = await (0, repositories_1.countRecentAuthAttempts)(scope, windowMinutes, { ipAddress });
    return emailCount >= max || ipCount >= max;
}
async function isWithinRecentFailedPasswordLimit(email, ipAddress) {
    const windowMinutes = getVerifyLimitWindowMinutes();
    const max = getVerifyLimitMax();
    const emailCount = await (0, repositories_1.countRecentAuthAttempts)('password_login', windowMinutes, { email, success: false });
    const ipCount = await (0, repositories_1.countRecentAuthAttempts)('password_login', windowMinutes, { ipAddress, success: false });
    return emailCount >= max || ipCount >= max;
}
function buildSessionCookie(value, expiresAt) {
    const attributes = [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Expires=${new Date(expiresAt).toUTCString()}`,
    ];
    if (env_1.env.NODE_ENV === 'production') {
        attributes.push('Secure');
    }
    return attributes.join('; ');
}
function clearAuthCookie(res) {
    res.setHeader('Set-Cookie', buildSessionCookie('', new Date(0).toISOString()));
}
async function recordAuthLoginEvent(input) {
    try {
        await (0, repositories_1.insertAuthLoginEvent)({
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
    }
    catch (error) {
        await (0, logService_1.logEvent)('error', 'Could not save authentication history event', {
            email: input.email,
            eventType: input.eventType,
            authMethod: input.authMethod,
            ipAddress: input.ipAddress,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
    }
}
async function requestLoginCode(input) {
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
    await (0, repositories_1.consumeAllAuthChallengesForEmail)(email);
    await (0, repositories_1.insertAuthLoginChallenge)({
        email,
        codeHash: hashValue(`${email}:${otpCode}`),
        redirectPath: sanitizeRedirectPath(input.redirectPath || '/dashboard'),
        expiresAt: getOtpExpiryIso(),
        attemptsRemaining: OTP_ATTEMPTS,
        requestedIp: input.ipAddress,
    });
    const mailConfig = (await (0, repositories_1.getSettings)()).mail;
    let mailResult = null;
    try {
        mailResult = await sendOtpEmail(email, otpCode, mailConfig);
    }
    catch (error) {
        await (0, repositories_1.consumeAllAuthChallengesForEmail)(email).catch(() => undefined);
        await (0, repositories_1.insertAuthAttempt)({
            scope: 'otp_request',
            email,
            ipAddress: input.ipAddress,
            success: false,
        }).catch(() => undefined);
        await (0, logService_1.logEvent)('error', 'Login code email failed', {
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
    await (0, repositories_1.insertAuthAttempt)({
        scope: 'otp_request',
        email,
        ipAddress: input.ipAddress,
        success: true,
    });
    await (0, logService_1.logEvent)('info', 'Login code sent', {
        email,
        ipAddress: input.ipAddress,
        messageId: mailResult?.messageId || null,
        mailTransport: mailResult?.transport || null,
        smtpUsername: mailResult?.username || null,
        mailFromEmail: mailResult?.fromEmail || null,
    });
}
async function verifyLoginCode(input) {
    const email = normalizeEmailAddress(input.email);
    const otpCode = input.otpCode.trim();
    if (!isValidEmailFormat(email) || !/^\d{6}$/.test(otpCode)) {
        throw new Error('Enter a valid email address and 6-digit code.');
    }
    if (await isWithinRecentLimit('otp_verify', email, input.ipAddress)) {
        throw new Error('Too many verification attempts. Please request a new code in a few minutes.');
    }
    const challenge = await (0, repositories_1.getLatestActiveAuthLoginChallenge)(email);
    if (!challenge) {
        await (0, repositories_1.insertAuthAttempt)({ scope: 'otp_verify', email, ipAddress: input.ipAddress, success: false });
        throw new Error('The login code is missing or expired. Request a new code.');
    }
    const providedHash = hashValue(`${email}:${otpCode}`);
    const providedBuffer = Buffer.from(providedHash, 'hex');
    const storedBuffer = Buffer.from(challenge.codeHash, 'hex');
    const isMatch = providedBuffer.length === storedBuffer.length &&
        crypto_1.default.timingSafeEqual(providedBuffer, storedBuffer);
    if (!isMatch) {
        await (0, repositories_1.updateAuthLoginChallenge)(challenge.id, {
            attemptsRemaining: Math.max(0, challenge.attemptsRemaining - 1),
            consumed: challenge.attemptsRemaining - 1 <= 0,
        });
        await (0, repositories_1.insertAuthAttempt)({ scope: 'otp_verify', email, ipAddress: input.ipAddress, success: false });
        throw new Error('The login code is invalid. Check the email and try again.');
    }
    const approvedAccess = await getOdooAccess(email);
    if (!approvedAccess.allowed) {
        await (0, repositories_1.updateAuthLoginChallenge)(challenge.id, { consumed: true });
        throw new Error('This email address is not an active approved app user.');
    }
    await (0, repositories_1.updateAuthLoginChallenge)(challenge.id, { consumed: true });
    await (0, repositories_1.insertAuthAttempt)({ scope: 'otp_verify', email, ipAddress: input.ipAddress, success: true });
    await (0, logService_1.logEvent)('info', 'Login succeeded', {
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
async function verifyLocalPasswordLogin(input) {
    const email = normalizeEmailAddress(input.email);
    const configuredEmail = normalizeEmailAddress(env_1.env.AUTH_LOCAL_ADMIN_EMAIL || '');
    const configuredPassword = env_1.env.AUTH_LOCAL_ADMIN_PASSWORD || '';
    if (!isValidEmailFormat(email) || !input.password) {
        throw new Error('Enter a valid email address and password.');
    }
    const approvedUser = await (0, repositories_1.getApprovedAuthUserByEmail)(email);
    if (approvedUser?.active &&
        approvedUser?.passwordHash &&
        await verifyApprovedUserPassword(input.password, approvedUser.passwordHash)) {
        await (0, repositories_1.insertAuthAttempt)({ scope: 'password_login', email, ipAddress: input.ipAddress, success: true });
        await (0, logService_1.logEvent)('info', 'Approved user password login succeeded', {
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
            await (0, repositories_1.insertAuthAttempt)({ scope: 'password_login', email, ipAddress: input.ipAddress, success: true });
            await (0, logService_1.logEvent)('info', 'Local admin password login succeeded', {
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
    await (0, repositories_1.insertAuthAttempt)({ scope: 'password_login', email, ipAddress: input.ipAddress, success: false });
    throw new Error('The email or password is invalid.');
}
function getAuthenticationState(req) {
    // Storage is async now, so auth state is attached through attachAuthState.
    return { user: null, csrfToken: null, sessionId: null };
}
async function getAuthenticationStateAsync(req) {
    const cookies = parseCookies(req.headers.cookie);
    const signedCookie = cookies[AUTH_COOKIE_NAME];
    if (!signedCookie) {
        return { user: null, csrfToken: null, sessionId: null };
    }
    const sessionId = unsignCookieValue(signedCookie);
    if (!sessionId) {
        return { user: null, csrfToken: null, sessionId: null };
    }
    const session = await (0, repositories_1.getAuthSession)(sessionId);
    if (!session || session.revokedAt) {
        return { user: null, csrfToken: null, sessionId: null };
    }
    await (0, repositories_1.touchAuthSession)(sessionId, getSessionExpiryIso());
    const currentAccess = await (0, repositories_1.getApprovedAuthUserByEmail)(session.user.email);
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
async function attachAuthState(req, res, next) {
    const state = await getAuthenticationStateAsync(req);
    req.authUser = state.user;
    req.authSessionId = state.sessionId;
    req.csrfToken = state.csrfToken;
    res.locals.authUser = state.user;
    res.locals.csrfToken = state.csrfToken;
    res.locals.isAuthenticated = Boolean(state.user);
    // ── Impersonation: admin can "Login As" another user ──
    const cookies = parseCookies(req.get('cookie'));
    if ((state.user?.role === 'admin' || state.user?.apps?.includes('shop-floor-admin')) && cookies.oj_impersonate) {
        try {
            const imp = JSON.parse(cookies.oj_impersonate);
            if (imp.email) {
                const currentImpersonatedAccess = await (0, repositories_1.getApprovedAuthUserByEmail)(String(imp.email));
                const impersonatedUser = {
                    email: imp.email,
                    role: currentImpersonatedAccess?.active ? currentImpersonatedAccess.role : (imp.role || 'user'),
                    apps: currentImpersonatedAccess?.active ? (currentImpersonatedAccess.apps || []) : imp.apps,
                };
                req.impersonatedBy = state.user;
                req.viewingAsUser = impersonatedUser;
                res.locals.viewingAsUser = impersonatedUser;
                res.locals.impersonatedBy = state.user;
                res.locals.isImpersonating = true;
            }
        }
        catch {
            // Invalid cookie, ignore
        }
    }
    // Set canAccess helper for EJS templates based on current authUser
    const currentUser = req.viewingAsUser || req.authUser;
    res.locals.canAccess = (method, path) => canAccessPath(currentUser, method, path);
    next();
}
function requireAuthentication(req, res, next) {
    if (req.authUser) {
        next();
        return;
    }
    const nextPath = sanitizeRedirectPath(req.originalUrl || '/dashboard');
    res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
function canAccessPath(user, method, requestPath) {
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
        if (apps.includes('shop-floor-admin'))
            return true;
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
    if (requestPath.startsWith('/mpesa-reconciliation') && apps.includes('mpesa'))
        return true;
    if (requestPath.startsWith('/po-bill-automation') && apps.includes('po-automation'))
        return true;
    if (requestPath.startsWith('/purchase-orders') && apps.includes('purchase-orders'))
        return true;
    if (requestPath.startsWith('/sales-orders') && apps.includes('sales-orders'))
        return true;
    if ((requestPath.startsWith('/invoice-parser') || requestPath.startsWith('/api/invoices')) && apps.includes('invoice-parser'))
        return true;
    if (requestPath.startsWith('/extractions') && apps.includes('extractions'))
        return true;
    if (requestPath.startsWith('/shop-floor/operators') && apps.includes('shop-floor-admin'))
        return true;
    if (requestPath.startsWith('/shop-floor') && apps.includes('shop-floor'))
        return true;
    if (requestPath.startsWith('/jobs') && apps.includes('jobs'))
        return true;
    return false;
}
function requireAuthorizedAccess(req, res, next) {
    const effectiveUser = req.viewingAsUser || req.authUser;
    if (canAccessPath(effectiveUser, req.method, req.path)) {
        next();
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
function enforceCsrf(req, res, next) {
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
        res.status(403).render('error', {
            pageTitle: 'Security Check Failed',
            errorMessage: 'The security token for this form is missing or invalid.',
            details: [],
        });
        return;
    }
    next();
}
function getSafeRedirectPath(req) {
    return sanitizeRedirectPath(String(req.query.next || req.body?.next || '/dashboard'));
}
function getRequestContext(req) {
    const ipAddress = getClientIpAddress(req);
    return {
        ipAddress,
        userAgent: req.get('user-agent') || '',
        location: getRequestLocation(req, ipAddress),
    };
}
async function logoutAuthenticatedSession(req) {
    if (req.authSessionId) {
        await (0, repositories_1.revokeAuthSession)(req.authSessionId);
    }
    if (req.authUser) {
        const requestContext = getRequestContext(req);
        await (0, logService_1.logEvent)('info', 'Logout completed', {
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
