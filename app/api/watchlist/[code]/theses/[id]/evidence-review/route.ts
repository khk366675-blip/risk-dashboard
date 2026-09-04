import { withThesisEvidenceAi } from '@/lib/server/local-thesis-evidence-ai';
import {
  onlyKeys,
  thesisBody,
  thesisFailure,
  thesisJson,
  thesisRequest,
} from '@/lib/server/thesis-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string; id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { code, id } = await context.params;
    thesisRequest(request, code);
    return thesisJson(await withThesisEvidenceAi((ai) => ai.view(code, id)));
  } catch (error) {
    return thesisFailure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { code, id } = await context.params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request);
    onlyKeys(body, ['id', 'revision', 'signature', 'consent']);
    const run = await withThesisEvidenceAi((ai) =>
      ai.generate(
        code,
        id,
        body as {
          id: string;
          revision: number;
          signature: string;
          consent: boolean;
        },
      ),
    );
    return thesisJson({ run });
  } catch (error) {
    return thesisFailure(error);
  }
}
