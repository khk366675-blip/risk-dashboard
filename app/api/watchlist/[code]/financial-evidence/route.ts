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
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    thesisRequest(request, code);
    const thesisId =
      new URL(request.url).searchParams.get('thesis') || undefined;
    return thesisJson(
      withFinancialEvidence((store) => ({ items: store.list(code, thesisId) })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request);
    onlyKeys(body, [
      'id',
      'thesis_id',
      'thesis_revision',
      'relation',
      'note',
      'metric',
      'year',
      'quarter',
    ]);
    if (
      typeof body.id !== 'string' ||
      typeof body.thesis_id !== 'string' ||
      typeof body.thesis_revision !== 'number' ||
      typeof body.relation !== 'string' ||
      typeof body.note !== 'string' ||
      typeof body.metric !== 'string' ||
      typeof body.year !== 'number' ||
      typeof body.quarter !== 'string'
    )
      throw new ThesisError('연결할 투자포인트와 재무 관측을 확인해 주세요.');
    return thesisJson(
      withFinancialEvidence((store) => ({
        item: store.create(
          code,
          body as Parameters<typeof store.create>[1],
        ),
      })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
