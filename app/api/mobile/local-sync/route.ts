import { NextResponse } from 'next/server';
import {
  publishLocalMobileSnapshot,
  pullRemoteMobileNotes,
} from '@/lib/server/mobile-local-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isLocalRequest = (request: Request) => {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
};

export async function POST(request: Request) {
  if (
    process.env.DASHBOARD_MODE === 'mobile' ||
    Boolean(process.env.VERCEL) ||
    !isLocalRequest(request)
  )
    return NextResponse.json(
      { ok: false, error: '이 기능은 로컬 PC에서만 실행할 수 있습니다.' },
      { status: 404 },
    );

  const body = await request.json().catch(() => ({}));
  const action = body.action;
  if (action !== 'publish' && action !== 'sync')
    return NextResponse.json(
      { ok: false, error: '지원하지 않는 동기화 작업입니다.' },
      { status: 400 },
    );

  try {
    const pulled = action === 'sync' ? await pullRemoteMobileNotes() : null;
    const published = await publishLocalMobileSnapshot();
    return NextResponse.json({ ok: true, action, pulled, published });
  } catch (error) {
    console.error('[mobile-local-sync]', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : '모바일 동기화 중 오류가 발생했습니다.',
      },
      { status: 500 },
    );
  }
}
