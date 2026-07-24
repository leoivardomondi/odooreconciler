import crypto from 'crypto';
import { env } from './env';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  if (!secret) {
    throw new Error(
      'APP_ENCRYPTION_KEY is not configured. Set it in your environment before storing Odoo credentials.',
    );
  }

  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string): string {
  if (!value) {
    return '';
  }

  const iv = crypto.randomBytes(12);
  const key = deriveKey(env.APP_ENCRYPTION_KEY);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  if (!payload) {
    return '';
  }

  const [ivB64, authTagB64, cipherB64] = payload.split(':');

  if (!ivB64 || !authTagB64 || !cipherB64) {
    throw new Error('Stored secret has an invalid format.');
  }

  const key = deriveKey(env.APP_ENCRYPTION_KEY);
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64'),
  );

  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherB64, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

export function maskSecret(value: string): string {
  if (!value) {
    return '';
  }

  if (value.length <= 6) {
    return '******';
  }

  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}
