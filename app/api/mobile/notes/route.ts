import { NextResponse } from 'next/server';
import { isMobileAuthenticated } from '@/lib/server/mobile-session';
import {
  createRemoteNote,
  mobileCloudEnv,
  readRemoteNotes,
} from '@/lib/server/mobile-cloud-rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unauthorized = () =>
  NextResponse.json({ error: '모바일 로그인이 필요합니다.' }, { status: 401 });

export async function GET() {
  if (!(await isMobileAuthenticated())) return unauthorized();
  const cloud = mobileCloudEnv();
  if (!cloud)
    return NextResponse.json({ error: '원격 저장소 미설정' }, { status: 503 });
  try {
    return NextResponse.json({ notes: await readRemoteNotes(cloud) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await isMobileAuthenticated())) return unauthorized();
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  const cloud = mobileCloudEnv();
  if (!cloud)
    return NextResponse.json({ error: '원격 저장소 미설정' }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!/^\d{6}$/.test(code) || !text || text.length > 2000)
    return NextResponse.json({ error: '종목과 메모 내용을 확인해 주세요.' }, { status: 400 });
  try {
    return NextResponse.json({ note: await createRemoteNote(cloud, { code, body: text }) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
