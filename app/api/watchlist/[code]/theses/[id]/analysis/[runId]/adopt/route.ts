import { withThesisAi } from '@/lib/server/local-thesis-ai';
import {
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
  onlyKeys,
} from '@/lib/server/thesis-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string; id: string; runId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const { code, id, runId } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request);
    onlyKeys(body, ['revision', 'questions']);
    return thesisJson(
      await withThesisAi((ai) =>
        ai.adopt(
          code,
          id,
          runId,
          body.revision as number,
          body.questions as { suggestion_index: number; text: string }[],
        ),
      ),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
