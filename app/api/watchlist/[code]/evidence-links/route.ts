import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
} from '@/lib/server/thesis-http';
import { withResearchEvidence } from '@/lib/server/local-research-evidence';
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
      withResearchEvidence((store) => ({ items: store.list(code, thesisId) })),
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
      'receipt',
      'document_version',
      'section_id',
      'block_id',
    ]);
    if (
      typeof body.id !== 'string' ||
      typeof body.thesis_id !== 'string' ||
      typeof body.thesis_revision !== 'number' ||
      typeof body.relation !== 'string' ||
      typeof body.note !== 'string' ||
      typeof body.receipt !== 'string' ||
      typeof body.document_version !== 'string' ||
      typeof body.section_id !== 'string' ||
      typeof body.block_id !== 'string'
    )
      throw new ThesisError('연결할 투자포인트와 원문 정보를 확인해 주세요.');
    return thesisJson(
      withResearchEvidence((store) => ({
        item: store.create(code, body as Parameters<typeof store.create>[1]),
      })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
