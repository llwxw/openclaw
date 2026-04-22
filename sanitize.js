/**
 * Sanitize utility - 敏感信息脱敏
 * 
 * 使用方式:
 *   import { sanitize } from './sanitize.js';
 *   sanitize({ token: 'sk-xxx', password: 'secret' });
 *   // → { token: '***', password: '***' }
 */

const SENSITIVE_KEYS = [
  'password', 'passwd', 'pwd',
  'token', 'api_token', 'apiKey', 'api_key', 'apikey',
  'secret', 'secretKey', 'secret_key',
  'access_token', 'refresh_token', 'accessToken',
  'authorization', 'auth', 'credentials',
  'private_key', 'privateKey', 'private_key'
];

export function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      result[key] = '***';
    } else if (value && typeof value === 'object') {
      result[key] = sanitize(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export default { sanitize };
