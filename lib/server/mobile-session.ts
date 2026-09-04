import { cookies } from 'next/headers';
import {
  mobileSessionCookie,
  verifyMobileSession,
} from '../mobile-session-token';

export {
  createMobileSession,
  mobileSessionCookie,
  safeSecretEqual,
  verifyMobileSession,
} from '../mobile-session-token';

export async function isMobileAuthenticated() {
  const secret = process.env.MOBILE_SESSION_SECRET;
  if (!secret) return false;
  const store = await cookies();
  return verifyMobileSession(store.get(mobileSessionCookie)?.value, secret);
}
