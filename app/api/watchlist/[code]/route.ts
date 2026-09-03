import { localStore } from '@/lib/server/research-store';
import {
  readPreview,
  readRadar,
  startResearchWorker,
  validateMutation,
} from '@/lib/server/research-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(_request: Request, context: Context) {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code))
    return reply({ error: '종목코드를 확인해 주세요.' }, 400);
  try {
    const store = localStore();
    try {
      return reply({ record: store.get(code), items: store.list() });
    } finally {
      store.close();
    }
  } catch {
    return reply({ error: '관심종목 자료를 읽지 못했습니다.' }, 503);
  }
}
async function mutate(
  request: Request,
  context: Context,
  action: 'register' | 'refresh' | 'remove',
) {
  const { code } = await context.params;
  if (!/^\d{6}$/.test(code))
    return reply({ error: '종목코드를 확인해 주세요.' }, 400);
  try {
    validateMutation(request);
  } catch {
    return reply({ error: '요청 출처를 확인해 주세요.' }, 403);
  }
  try {
    const store = localStore();
    let jobId: string | null = null;
    try {
      if (action === 'register') {
        const radar = await readRadar();
        const previous = store.get(code);
        const candidate =
          radar.candidates.find((item) => item.code === code) ??
          previous?.stock.radar;
        const preview = (await readPreview(code, radar)) ?? previous?.stock;
        if (!candidate || !preview)
          return reply(
            { error: '후보 자료를 찾을 수 없습니다. Radar를 확인해 주세요.' },
            404,
          );
        jobId = store.register(candidate, radar, preview).jobId;
      } else if (action === 'refresh') {
        const body = await request.json().catch(() => ({}));
        if (body.mode !== 'all' && body.mode !== 'retry')
          return reply({ error: '갱신 범위를 확인해 주세요.' }, 400);
        if (!store.get(code)?.item.active)
          return reply({ error: '관심종목 등록이 필요합니다.' }, 409);
        jobId = store.queue(code, body.mode);
      } else store.remove(code);
    } finally {
      store.close();
    }
    if (jobId) await startResearchWorker(code, jobId);
    const latest = localStore();
    try {
      return reply(
        { record: latest.get(code), items: latest.list() },
        jobId ? 202 : 200,
      );
    } finally {
      latest.close();
    }
  } catch {
    return reply(
      {
        error:
          '관심종목 변경을 완료하지 못했습니다. 저장소와 실행 환경을 확인해 주세요.',
      },
      503,
    );
  }
}
export const PUT = (request: Request, context: Context) =>
  mutate(request, context, 'register');
export const POST = (request: Request, context: Context) =>
  mutate(request, context, 'refresh');
export const DELETE = (request: Request, context: Context) =>
  mutate(request, context, 'remove');
