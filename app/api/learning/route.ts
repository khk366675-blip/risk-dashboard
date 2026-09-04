import { ThesisError } from '@/lib/investment-thesis';
import { localStore } from '@/lib/server/research-store';
import { ResearchSystemStore } from '@/lib/server/research-system-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const failure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : '학습 기록을 처리하지 못했습니다.',
    },
    { status: error instanceof ThesisError ? error.status : 500 },
  );
export async function GET() {
  const owner = localStore();
  try {
    return Response.json({
      items: new ResearchSystemStore(owner.db).learning(),
      archived_items: new ResearchSystemStore(owner.db).learning(true),
      stocks: owner.list().map(({ code, name }) => ({ code, name })),
    });
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
export async function PATCH(request: Request) {
  const owner = localStore();
  try {
    const value = (await request.json().catch(() => null)) as {
      id?: unknown;
      action?: unknown;
    } | null;
    if (typeof value?.id !== 'string' || value.action !== 'restore')
      throw new ThesisError('복구할 기록을 확인해 주세요.');
    const store = new ResearchSystemStore(owner.db);
    return Response.json({
      items: store.restoreLearning(value.id),
      archived_items: store.learning(true),
    });
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
export async function POST(request: Request) {
  const owner = localStore();
  try {
    const value = await request.json().catch(() => null);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ThesisError('요청 내용을 확인해 주세요.');
    const store = new ResearchSystemStore(owner.db);
    return Response.json({
      items: store.saveLearning(value as Record<string, unknown>),
      archived_items: store.learning(true),
    });
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
export async function DELETE(request: Request) {
  const owner = localStore();
  try {
    const value = (await request.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (typeof value?.id !== 'string')
      throw new ThesisError('보관할 기록을 확인해 주세요.');
    return Response.json({
      items: new ResearchSystemStore(owner.db).archiveLearning(value.id),
      archived_items: new ResearchSystemStore(owner.db).learning(true),
    });
  } catch (error) {
    return failure(error);
  } finally {
    owner.close();
  }
}
