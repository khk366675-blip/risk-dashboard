import { withDocuments } from '@/lib/server/local-documents';
import {
  thesisRequest,
  thesisJson,
  thesisFailure,
} from '@/lib/server/thesis-http';
import type { DocumentGroup } from '@/lib/filing-documents';

export const runtime = 'nodejs';

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
        store.search(code, {
          query: query.get('q') ?? '',
          group: (query.get('group') || 'all') as DocumentGroup,
          receipt: query.get('receipt') || undefined,
          versions: query.get('versions') === 'all' ? 'all' : 'current',
        }),
      ),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
