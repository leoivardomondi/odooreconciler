import crypto from 'crypto';
import {
  getGeminiOAuthClientConfig,
  getGeminiOAuthCredentials,
  getSettings,
  saveGeminiOAuthCredentials,
  updateGeminiOAuthAccessToken,
} from '../models/repositories';
import { env } from '../utils/env';

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever';
const OPENID_SCOPES = ['openid', 'email', GEMINI_SCOPE];
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function oauthSecret(): string {
  const secret = env.APP_SESSION_SECRET.trim();
  if (!secret) {
    throw new Error('APP_SESSION_SECRET or APP_ENCRYPTION_KEY is required for the Gemini OAuth state.');
  }
  return secret;
}

async function requireOAuthClient(): Promise<{ clientId: string; clientSecret: string }> {
  const stored = await getGeminiOAuthClientConfig();
  const clientId = stored?.clientId.trim() || env.GOOGLE_GEMINI_OAUTH_CLIENT_ID.trim();
  const clientSecret = stored?.clientSecret.trim() || env.GOOGLE_GEMINI_OAUTH_CLIENT_SECRET.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'Gemini Google OAuth is not configured. Set GOOGLE_GEMINI_OAUTH_CLIENT_ID and GOOGLE_GEMINI_OAUTH_CLIENT_SECRET first.',
    );
  }
  return { clientId, clientSecret };
}

export function getGeminiOAuthRedirectUri(): string {
  const baseUrl = env.APP_BASE_URL.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('APP_BASE_URL is required for the Gemini Google OAuth callback.');
  }
  return `${baseUrl}/settings/ai/gemini/callback`;
}

export function createGeminiOAuthState(sessionId: string): string {
  if (!sessionId) throw new Error('An authenticated app session is required to connect Gemini.');

  const payload = Buffer.from(JSON.stringify({
    sessionId,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(18).toString('hex'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', oauthSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyGeminiOAuthState(state: string, sessionId: string): boolean {
  if (!state || !sessionId) return false;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;

  const expected = crypto.createHmac('sha256', oauthSecret()).update(payload).digest('base64url');
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sessionId?: string;
      issuedAt?: number;
    };
    return parsed.sessionId === sessionId &&
      typeof parsed.issuedAt === 'number' &&
      Date.now() - parsed.issuedAt >= 0 &&
      Date.now() - parsed.issuedAt <= STATE_TTL_MS;
  } catch {
    return false;
  }
}

export async function buildGeminiOAuthAuthorizationUrl(input: {
  sessionId: string;
  redirectUri?: string;
}): Promise<string> {
  const { clientId } = await requireOAuthClient();
  const redirectUri = input.redirectUri || getGeminiOAuthRedirectUri();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OPENID_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: createGeminiOAuthState(input.sessionId),
  });
  return `${GOOGLE_AUTHORIZATION_URL}?${query.toString()}`;
}

async function parseGoogleTokenResponse(response: Response): Promise<GoogleTokenResponse> {
  const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Google OAuth returned HTTP ${response.status}.`);
  }
  return payload;
}

async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return parseGoogleTokenResponse(response);
}

async function loadGoogleEmail(accessToken: string): Promise<string> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({})) as { email?: string };
    return response.ok ? String(payload.email || '') : '';
  } catch {
    return '';
  }
}

export async function completeGeminiOAuth(input: {
  code: string;
  redirectUri?: string;
  projectId: string;
}): Promise<{ email: string }> {
  const { clientId, clientSecret } = await requireOAuthClient();
  const projectId = input.projectId.trim();
  if (!projectId) {
    throw new Error('Google Cloud project ID is required before connecting Gemini.');
  }

  const token = await exchangeAuthorizationCode({
    code: input.code,
    redirectUri: input.redirectUri || getGeminiOAuthRedirectUri(),
    clientId,
    clientSecret,
  });
  const refreshToken = String(token.refresh_token || '');
  if (!refreshToken) {
    throw new Error('Google did not return a refresh token. Disconnect the app in Google Account permissions and connect again.');
  }
  const email = await loadGoogleEmail(String(token.access_token));
  await saveGeminiOAuthCredentials({
    refreshToken,
    accessToken: String(token.access_token),
    accessTokenExpiresAt: Date.now() + Math.max(1, Number(token.expires_in || 3600)) * 1000,
    email,
    scopes: String(token.scope || GEMINI_SCOPE).split(/\s+/).filter(Boolean),
    projectId,
  });
  return { email };
}

export async function getGeminiOAuthAccessToken(): Promise<{
  accessToken: string;
  projectId: string;
}> {
  const credentials = await getGeminiOAuthCredentials();
  if (!credentials) {
    throw new Error('Google Gemini OAuth is not connected.');
  }

  const settings = await getSettings();
  const projectId = settings.ai.geminiOAuth.projectId.trim() || env.GOOGLE_GEMINI_PROJECT_ID.trim();
  if (!projectId) {
    throw new Error('Google Cloud project ID is missing for the Gemini OAuth connection.');
  }

  if (credentials.accessToken && credentials.accessTokenExpiresAt - Date.now() > TOKEN_REFRESH_SKEW_MS) {
    return { accessToken: credentials.accessToken, projectId };
  }

  const { clientId, clientSecret } = await requireOAuthClient();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await parseGoogleTokenResponse(response);
  const accessToken = String(token.access_token);
  const accessTokenExpiresAt = Date.now() + Math.max(1, Number(token.expires_in || 3600)) * 1000;
  await updateGeminiOAuthAccessToken({ accessToken, accessTokenExpiresAt });
  return { accessToken, projectId };
}
