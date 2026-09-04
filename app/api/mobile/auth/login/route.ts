import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  createMobileSession,
  mobileSessionCookie,
  safeSecretEqual,
} from '@/lib/server/mobile-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const expected = process.env.MOBILE_ACCESS_PASSWORD;
  const secret = process.env.MOBILE_SESSION_SECRET;
  if (!expected || !secret)
    return NextResponse.json(
      { error: '모바일 접속 설정이 완료되지 않았습니다.' },
      { status: 503 },
    );
  const body = await request.json().catch(() => ({}));
  const supplied = typeof body.password === 'string' ? body.password : '';
  if (!safeSecretEqual(supplied, expected))
    return NextResponse.json(
      { error: '비밀번호가 일치하지 않습니다.' },
      { status: 401 },
    );
  const store = await cookies();
  store.set(mobileSessionCookie, createMobileSession(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return NextResponse.json({ ok: true });
}
