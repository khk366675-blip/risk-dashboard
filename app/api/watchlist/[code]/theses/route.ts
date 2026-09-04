import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
  withTheses,
} from '@/lib/server/thesis-http';
import { ThesisError } from '@/lib/investment-thesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    thesisRequest(request, code);
    return thesisJson(withTheses((s) => ({ items: s.list(code) })));
  } catch (error) {
    return thesisFailure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const { code } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request);
    onlyKeys(body, ['id', 'content']);
    if (typeof body.id !== 'string')
      throw new ThesisError('요청 식별자가 필요합니다.');
    const id = body.id;
    return thesisJson(
      withTheses((s) => ({ item: s.create(code, id, body.content) })),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
