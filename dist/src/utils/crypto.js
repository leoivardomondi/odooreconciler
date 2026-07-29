"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.maskSecret = maskSecret;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("./env");
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
function deriveKey(secret) {
    if (!secret) {
        throw new Error('APP_ENCRYPTION_KEY is not configured. Set it in your environment before storing Odoo credentials.');
    }
    return crypto_1.default.createHash('sha256').update(secret).digest();
}
function encryptSecret(value) {
    if (!value) {
        return '';
    }
    const iv = crypto_1.default.randomBytes(12);
    const key = deriveKey(env_1.env.APP_ENCRYPTION_KEY);
    const cipher = crypto_1.default.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}
function decryptSecret(payload) {
    if (!payload) {
        return '';
    }
    const [ivB64, authTagB64, cipherB64] = payload.split(':');
    if (!ivB64 || !authTagB64 || !cipherB64) {
        throw new Error('Stored secret has an invalid format.');
    }
    const key = deriveKey(env_1.env.APP_ENCRYPTION_KEY);
    const decipher = crypto_1.default.createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(cipherB64, 'base64')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
}
function maskSecret(value) {
    if (!value) {
        return '';
    }
    if (value.length <= 6) {
        return '******';
    }
    return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}
