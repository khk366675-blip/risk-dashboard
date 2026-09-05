import { localStore } from '@/lib/server/research-store';
import { randomUUID } from 'node:crypto';
import { ResearchSystemStore } from '@/lib/server/research-system-store';
import {
  thesisRequest,
  thesisBody,
  thesisJson,
  thesisFailure,
} from '@/lib/server/thesis-http';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    thesisRequest(request, '000000', true);
    const body = await thesisBody(request);
    const owner = localStore();
    try {
      const id = randomUUID();
      const items = new ResearchSystemStore(owner.db).saveLearning({
        id,
        kind: 'article',
        status: 'to_read',
        title: body.title,
        summary: body.body,
        source_url: body.url,
        tags: ['저장 자료'],
        linked_codes: [],
      });
      return thesisJson({ item: items.find((item) => item.id === id) });
    } finally {
      owner.close();
    }
  } catch (e) {
    return thesisFailure(e);
  }
}
