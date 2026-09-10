import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
} from '@/lib/server/thesis-http';
import { withManualEvidence } from '@/lib/server/local-manual-evidence';
import { ThesisError } from '@/lib/investment-thesis';
import { richMemoConfig } from '@/lib/rich-memo';

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
      withManualEvidence((store) => ({ items: store.list(code, thesisId) })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request, richMemoConfig.max_request_bytes);
    onlyKeys(body, [
      'id',
      'thesis_id',
      'thesis_revision',
      'relation',
      'source_type',
      'title',
      'url',
      'source_name',
      'published_at',
      'body',
      'document',
      'note',
    ]);
    if (
      typeof body.id !== 'string' ||
      typeof body.thesis_id !== 'string' ||
      typeof body.thesis_revision !== 'number' ||
      typeof body.relation !== 'string' ||
      typeof body.source_type !== 'string' ||
      typeof body.title !== 'string' ||
      typeof body.url !== 'string' ||
      typeof body.source_name !== 'string' ||
      typeof body.published_at !== 'string' ||
      typeof body.body !== 'string' ||
      typeof body.note !== 'string'
    )
      throw new ThesisError('직접 추가할 자료 입력을 확인해 주세요.');
    return thesisJson(
      withManualEvidence((store) => ({
        item: store.create(code, body as Parameters<typeof store.create>[1]),
      })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
