import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
  withTheses,
} from '@/lib/server/thesis-http';
import { ThesisError, validateThesisContent } from '@/lib/investment-thesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string; id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const { code, id } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request);
    onlyKeys(body, ['revision', 'content', 'archived']);
    if (
      typeof body.revision !== 'number' ||
      'content' in body === 'archived' in body ||
      ('archived' in body && typeof body.archived !== 'boolean')
    )
      throw new ThesisError(
        '내용 수정 또는 보관 상태 변경 중 하나를 요청해 주세요.',
      );
    const change =
      'content' in body
        ? { content: validateThesisContent(body.content) }
        : { archived: body.archived as boolean };
    const revision = body.revision;
    return thesisJson(
      withTheses((s) => ({ item: s.update(code, id, revision, change) })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
