import { localStore } from '@/lib/server/research-store';
import { searchResearch } from '@/lib/server/research-search';
import {
  thesisRequest,
  thesisJson,
  thesisFailure,
} from '@/lib/server/thesis-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    thesisRequest(request, '000000');
    const owner = localStore();
    try {
      return thesisJson({
        items: searchResearch(
          owner.db,
          new URL(request.url).searchParams.get('q') ?? '',
        ),
      });
    } finally {
      owner.close();
    }
  } catch (e) {
    return thesisFailure(e);
  }
}
