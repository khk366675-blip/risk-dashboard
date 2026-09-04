import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
} from '@/lib/server/thesis-http';
import { withFinancialEvidence } from '@/lib/server/local-financial-evidence';
import { ThesisError } from '@/lib/investment-thesis';

export const runtime = 'nodejs';
type Context = { params: Promise<{ code: string; id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { code, id } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request);
    onlyKeys(body, ['archived']);
    if (typeof body.archived !== 'boolean')
      throw new ThesisError('연결 자료 상태를 확인해 주세요.');
    return thesisJson(
      withFinancialEvidence((store) => ({
        item: store.archive(code, id, body.archived as boolean),
      })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
