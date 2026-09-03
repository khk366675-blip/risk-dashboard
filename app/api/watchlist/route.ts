import { localStore } from '@/lib/server/research-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const store = localStore();
    try {
      return Response.json(
        { items: store.list() },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } finally {
      store.close();
    }
  } catch {
    return Response.json(
      {
        error:
          '관심종목 저장소에 연결하지 못했습니다. 배포 환경에서는 공용 저장소 연결이 필요합니다.',
      },
      { status: 503 },
    );
  }
}
