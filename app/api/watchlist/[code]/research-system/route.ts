import { ThesisError } from '@/lib/investment-thesis';
import { localStore } from '@/lib/server/research-store';
import { ResearchSystemStore } from '@/lib/server/research-system-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };
const failure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : '리서치 기록을 처리하지 못했습니다.',
    },
    { status: error instanceof ThesisError ? error.status : 500 },
  );
const body = async (request: Request) => {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThesisError('요청 내용을 확인해 주세요.');
  return value as Record<string, unknown>;
};

export async function GET(_request: Request, context: Context) {
  const owner = localStore();
  try {
    const { code } = await context.params;
    return Response.json(new ResearchSystemStore(owner.db).snapshot(code));
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
export async function POST(request: Request, context: Context) {
  const owner = localStore();
  try {
    const { code } = await context.params,
      value = await body(request),
      store = new ResearchSystemStore(owner.db);
    if (value.kind === 'kpi')
      return Response.json(store.createKpi(code, value));
    if (value.kind === 'observation')
      return Response.json(store.createObservation(code, value));
    if (value.kind === 'journal')
      return Response.json(
        store.createJournal(code, { ...value, kind: value.journal_kind }),
      );
    throw new ThesisError('지원하지 않는 기록 종류입니다.');
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
export async function PATCH(request: Request, context: Context) {
  const owner = localStore();
  try {
    const { code } = await context.params,
      value = await body(request),
      store = new ResearchSystemStore(owner.db);
    if (
      value.action === 'restore' &&
      typeof value.id === 'string' &&
      (value.kind === 'kpi' || value.kind === 'journal')
    )
      return Response.json(store.restore(code, value.kind, value.id));
    if (value.kind === 'kpi')
      return Response.json(store.updateKpi(code, value));
    if (value.kind === 'observation')
      return Response.json(store.updateObservation(code, value));
    if (value.kind === 'journal')
      return Response.json(
        store.updateJournal(code, { ...value, kind: value.journal_kind }),
      );
    throw new ThesisError('수정할 기록을 확인해 주세요.');
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
export async function DELETE(request: Request, context: Context) {
  const owner = localStore();
  try {
    const { code } = await context.params,
      value = await body(request),
      kind = value.kind;
    if (
      !['kpi', 'observation', 'journal'].includes(String(kind)) ||
      typeof value.id !== 'string'
    )
      throw new ThesisError('보관할 기록을 확인해 주세요.');
    return Response.json(
      new ResearchSystemStore(owner.db).archive(
        code,
        kind as 'kpi' | 'observation' | 'journal',
        value.id,
      ),
    );
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
