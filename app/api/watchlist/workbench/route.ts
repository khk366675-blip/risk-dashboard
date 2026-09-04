import { localStore } from '@/lib/server/research-store';
import { ResearchWorkbenchStore } from '@/lib/server/research-workbench-store';
import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
} from '@/lib/server/thesis-http';
import { ThesisError } from '@/lib/investment-thesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const owner = localStore();
    try {
      const followups = owner.followups();
      return thesisJson(
        new ResearchWorkbenchStore(owner.db).snapshot(followups),
      );
    } finally {
      owner.close();
    }
  } catch (error) {
    return thesisFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await thesisBody(request);
    if (body.kind === 'update') {
      onlyKeys(body, ['kind', 'item_key', 'status', 'note']);
      if (
        typeof body.item_key !== 'string' ||
        typeof body.status !== 'string' ||
        typeof body.note !== 'string'
      )
        throw new ThesisError('업데이트 상태 입력을 확인해 주세요.');
      const owner = localStore();
      try {
        const item = new ResearchWorkbenchStore(owner.db).setUpdate(
          owner.followups(),
          body as {
            item_key: string;
            status: string;
            note: string;
          },
        );
        return thesisJson({ item });
      } finally {
        owner.close();
      }
    }
    if (body.kind === 'thesis_status') {
      onlyKeys(body, ['kind', 'code', 'thesis_id', 'state', 'note']);
      if (
        typeof body.code !== 'string' ||
        typeof body.thesis_id !== 'string' ||
        typeof body.state !== 'string' ||
        typeof body.note !== 'string'
      )
        throw new ThesisError('투자포인트 상태 입력을 확인해 주세요.');
      const owner = localStore();
      try {
        const status = new ResearchWorkbenchStore(owner.db).setThesisStatus(
          body as {
            code: string;
            thesis_id: string;
            state: string;
            note: string;
          },
        );
        return thesisJson({ status });
      } finally {
        owner.close();
      }
    }
    throw new ThesisError('지원하지 않는 검토 작업입니다.');
  } catch (error) {
    return thesisFailure(error);
  }
}
