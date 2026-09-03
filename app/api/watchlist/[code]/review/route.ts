import { localStore } from '@/lib/server/research-store';
import { validateMutation } from '@/lib/server/research-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code))
    return reply({ error: '종목코드를 확인해 주세요.' }, 400);
  try {
    validateMutation(request);
  } catch {
    return reply({ error: '요청 출처를 확인해 주세요.' }, 403);
  }
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.revision)
  )
    return reply({ error: '표시된 자료의 확인 기준이 필요합니다.' }, 400);
  try {
    const store = localStore();
    try {
      if (!store.acknowledge(code, body.revision))
        return reply(
          {
            error:
              '자료가 변경되었거나 수집 중입니다. 목록을 다시 확인한 뒤 기록해 주세요.',
          },
          409,
        );
      return reply({ items: store.followups() });
    } finally {
      store.close();
    }
  } catch {
    return reply(
      { error: '확인 기록을 저장하지 못했습니다. 기존 기록은 유지됩니다.' },
      503,
    );
  }
}
