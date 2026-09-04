import { searchListedStocks } from '@/lib/server/listing-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!query || query.length > 80)
    return Response.json(
      { error: '종목명 또는 6자리 종목코드를 입력해 주세요.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    return Response.json(
      { items: searchListedStocks(query) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      {
        error:
          '최신 상장종목 목록을 읽지 못했습니다. Radar 데이터 상태를 확인해 주세요.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
