import { Response, Router } from 'express';
import { getApprovedAuthUserByEmail, upsertApprovedAuthUser } from '../models/repositories';
import {
  clearAuthCookie,
  getRequestContext,
  getSafeRedirectPath,
  hashApprovedUserPassword,
  logoutAuthenticatedSession,
  recordAuthLoginEvent,
  requestLoginCode,
  verifyLocalPasswordLogin,
  verifyLoginCode,
} from '../services/authService';

const router = Router();
const IMPERSONATE_COOKIE = 'oj_impersonate';

function clearImpersonation(res: Response) {
  res.clearCookie(IMPERSONATE_COOKIE, { path: '/' });
}

function renderForgotPasswordPage(res: Response, options: {
  status?: { type: string; message: string } | null;
  email?: string;
  codeSent?: boolean;
} = {}) {
  res.render('forgot-password', {
    pageTitle: 'Reset Password',
    status: options.status || null,
    validationErrors: [],
    form: { email: options.email || '', codeSent: Boolean(options.codeSent) },
  });
}

function appendQueryMessage(targetPath: string, message: string): string {
  const baseUrl = new URL(targetPath, 'http://reconciler.local');
  baseUrl.searchParams.set('message', message);
  return `${baseUrl.pathname}${baseUrl.search}${baseUrl.hash}`;
}

function renderLoginPage(
  res: Response,
  options: {
    status?: { type: string; message: string } | null;
    email?: string;
    next?: string;
    verificationReady?: boolean;
  } = {},
) {
  res.render('login', {
    pageTitle: 'Sign In',
    status: options.status || null,
    validationErrors: [],
    form: {
      email: options.email || '',
      next: options.next || '/dashboard',
      verificationReady: Boolean(options.verificationReady),
    },
  });
}

router.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '');
  const credential = String(req.body.credential || '').trim();
  const nextPath = getSafeRedirectPath(req);
  const requestContext = getRequestContext(req);

  try {
    if (!credential) {
      await requestLoginCode({
        email,
        redirectPath: nextPath,
        ipAddress: requestContext.ipAddress,
      });

      return renderLoginPage(res, {
        status: {
          type: 'success',
          message: `A login code was sent to ${email.trim().toLowerCase()}.`,
        },
        email,
        next: nextPath,
        verificationReady: true,
      });
    }
    const verified = /^\d{6}$/.test(credential)
      ? await verifyLoginCode({
          email,
          otpCode: credential,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
        })
      : await verifyLocalPasswordLogin({
          email,
          password: credential,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
        });

    await recordAuthLoginEvent({
      email: verified.user.email,
      role: verified.user.role || null,
      eventType: 'login',
      authMethod: /^\d{6}$/.test(credential) ? 'otp' : 'password',
      success: true,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: 'Sign-in completed.',
    });

    clearImpersonation(res);
    res.setHeader('Set-Cookie', verified.sessionCookie);
    return res.redirect(appendQueryMessage(verified.redirectPath || nextPath, 'Signed in successfully.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not sign in.';
    await recordAuthLoginEvent({
      email,
      eventType: 'login',
      authMethod: credential && /^\d{6}$/.test(credential) ? 'otp' : 'password',
      success: false,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: message,
    });
    return renderLoginPage(res.status(400), {
      status: {
        type: 'danger',
        message,
      },
      email,
      next: nextPath,
      verificationReady: true,
    });
  }
});

router.get('/login', (req, res) => {
  if (req.authUser) {
    return res.redirect(getSafeRedirectPath(req));
  }

  return renderLoginPage(res, {
    status:
      typeof req.query.message === 'string'
        ? { type: 'success', message: req.query.message }
        : null,
    next: getSafeRedirectPath(req),
  });
});

router.get('/forgot-password', (req, res) => {
  if (req.authUser) return res.redirect('/dashboard');
  return renderForgotPasswordPage(res, { email: String(req.query.email || '') });
});

router.post('/auth/request-password-reset', async (req, res) => {
  const email = String(req.body.email || '');
  try {
    const context = getRequestContext(req);
    await requestLoginCode({ email, redirectPath: '/forgot-password', ipAddress: context.ipAddress });
    return renderForgotPasswordPage(res, {
      email,
      codeSent: true,
      status: { type: 'success', message: `A password-reset code was sent to ${email.trim().toLowerCase()}.` },
    });
  } catch (error) {
    return renderForgotPasswordPage(res.status(400), {
      email,
      status: { type: 'danger', message: error instanceof Error ? error.message : 'Could not send reset code.' },
    });
  }
});

router.post('/auth/reset-password', async (req, res) => {
  const email = String(req.body.email || '');
  const password = String(req.body.password || '');
  const confirmation = String(req.body.passwordConfirmation || '');
  const context = getRequestContext(req);

  try {
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (password !== confirmation) throw new Error('Password confirmation does not match.');
    await verifyLoginCode({
      email,
      otpCode: String(req.body.otpCode || ''),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    const user = await getApprovedAuthUserByEmail(email);
    if (!user || !user.active) throw new Error('This account is not active.');
    await upsertApprovedAuthUser(user.email, user.role, user.apps || [], true, await hashApprovedUserPassword(password));
    await recordAuthLoginEvent({
      email: user.email,
      role: user.role,
      eventType: 'password_reset',
      authMethod: 'email_code',
      success: true,
      ipAddress: context.ipAddress,
      location: context.location,
      userAgent: context.userAgent,
      detail: 'Password reset completed.',
    });
    return res.redirect('/login?message=' + encodeURIComponent('Password changed. Sign in with your new password.'));
  } catch (error) {
    await recordAuthLoginEvent({
      email,
      eventType: 'password_reset',
      authMethod: 'email_code',
      success: false,
      ipAddress: context.ipAddress,
      location: context.location,
      userAgent: context.userAgent,
      detail: error instanceof Error ? error.message : 'Password reset failed.',
    });
    return renderForgotPasswordPage(res.status(400), {
      email,
      codeSent: true,
      status: { type: 'danger', message: error instanceof Error ? error.message : 'Could not reset password.' },
    });
  }
});

router.post('/auth/request-code', async (req, res) => {
  const email = String(req.body.email || '');
  const nextPath = getSafeRedirectPath(req);

  try {
    const requestContext = getRequestContext(req);
    await requestLoginCode({
      email,
      redirectPath: nextPath,
      ipAddress: requestContext.ipAddress,
    });

    return renderLoginPage(res, {
      status: {
        type: 'success',
        message: `A login code was sent to ${email.trim().toLowerCase()}.`,
      },
      email,
      next: nextPath,
      verificationReady: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not send a login code.';
    return renderLoginPage(res.status(400), {
      status: {
        type: 'danger',
        message,
      },
      email,
      next: nextPath,
      verificationReady: true,
    });
  }
});

router.post('/auth/verify-code', async (req, res) => {
  const email = String(req.body.email || '');
  const nextPath = getSafeRedirectPath(req);

  try {
    const requestContext = getRequestContext(req);
    const verified = await verifyLoginCode({
      email,
      otpCode: String(req.body.otpCode || ''),
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    await recordAuthLoginEvent({
      email: verified.user.email,
      role: verified.user.role || null,
      eventType: 'login',
      authMethod: 'otp',
      success: true,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: 'OTP sign-in completed.',
    });

    clearImpersonation(res);
    res.setHeader('Set-Cookie', verified.sessionCookie);
    return res.redirect(appendQueryMessage(verified.redirectPath || nextPath, 'Signed in successfully.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not verify the login code.';
    const requestContext = getRequestContext(req);
    await recordAuthLoginEvent({
      email,
      eventType: 'login',
      authMethod: 'otp',
      success: false,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: message,
    });
    return renderLoginPage(res.status(400), {
      status: {
        type: 'danger',
        message,
      },
      email,
      next: nextPath,
      verificationReady: true,
    });
  }
});

router.post('/auth/password-login', async (req, res) => {
  const email = String(req.body.email || '');
  const nextPath = getSafeRedirectPath(req);

  try {
    const requestContext = getRequestContext(req);
    const verified = await verifyLocalPasswordLogin({
      email,
      password: String(req.body.password || ''),
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    await recordAuthLoginEvent({
      email: verified.user.email,
      role: verified.user.role || null,
      eventType: 'login',
      authMethod: 'password',
      success: true,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: 'Password sign-in completed.',
    });

    clearImpersonation(res);
    res.setHeader('Set-Cookie', verified.sessionCookie);
    return res.redirect(appendQueryMessage(verified.redirectPath || nextPath, 'Signed in successfully.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not sign in with password.';
    const requestContext = getRequestContext(req);
    await recordAuthLoginEvent({
      email,
      eventType: 'login',
      authMethod: 'password',
      success: false,
      ipAddress: requestContext.ipAddress,
      location: requestContext.location,
      userAgent: requestContext.userAgent,
      detail: message,
    });
    return renderLoginPage(res.status(400), {
      status: {
        type: 'danger',
        message,
      },
      email,
      next: nextPath,
      verificationReady: true,
    });
  }
});

router.post('/logout', async (req, res) => {
  await logoutAuthenticatedSession(req);
  clearAuthCookie(res);
  clearImpersonation(res);
  res.redirect(appendQueryMessage('/login', 'Signed out successfully.'));
});

export default router;
