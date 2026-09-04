import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { mobileSessionCookie } from '@/lib/server/mobile-session';

export async function POST() {
  const store = await cookies();
  store.delete(mobileSessionCookie);
  return NextResponse.json({ ok: true });
}
