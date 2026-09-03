import { localStore } from '@/lib/server/research-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const store = localStore();
    try {
      return Response.json(
        { items: store.followups() },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } finally {
      store.close();
    }
  } catch {
    return Response.json(
      {
        error:
          '팔로업 자료를 읽지 못했습니다. 저장소와 확인 기록을 점검해 주세요.',
      },
      { status: 503 },
    );
  }
}
