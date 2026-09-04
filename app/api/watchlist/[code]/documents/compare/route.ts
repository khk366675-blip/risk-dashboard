import { withDocuments } from '@/lib/server/local-documents';
import {
  thesisFailure,
  thesisJson,
  thesisRequest,
} from '@/lib/server/thesis-http';
import type { DocumentGroup } from '@/lib/filing-documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    thesisRequest(request, code);
    const query = new URL(request.url).searchParams;
    return thesisJson(
      withDocuments((store) =>
        store.compare(code, {
          fromReceipt: query.get('from') ?? '',
          toReceipt: query.get('to') ?? '',
          group: (query.get('group') || 'all') as DocumentGroup,
          query: query.get('q') ?? '',
        }),
      ),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
