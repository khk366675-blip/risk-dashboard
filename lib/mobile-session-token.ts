import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const mobileSessionCookie = 'value_mobile_session';
const sessionDays = 30;

const digest = (value: string) => createHash('sha256').update(value).digest();
export const safeSecretEqual = (left: string, right: string) =>
  timingSafeEqual(digest(left), digest(right));

function signature(expires: string, secret: string) {
  return createHmac('sha256', secret)
    .update(`value-mobile-v1.${expires}`)
    .digest('base64url');
}

export function createMobileSession(secret: string) {
  const expires = String(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  return `${expires}.${signature(expires, secret)}`;
}

export function verifyMobileSession(value: string | undefined, secret: string) {
  if (!value) return false;
  const [expires, supplied, extra] = value.split('.');
  if (extra || !/^\d+$/.test(expires) || Number(expires) <= Date.now())
    return false;
  return safeSecretEqual(supplied ?? '', signature(expires, secret));
}
