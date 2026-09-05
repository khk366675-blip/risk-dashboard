import { withThesisEvidenceAi } from '@/lib/server/local-thesis-evidence-ai';
import {
  thesisRequest,
  thesisJson,
  thesisFailure,
} from '@/lib/server/thesis-http';
import { ThesisError } from '@/lib/investment-thesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await params;
    thesisRequest(request, code);
    return thesisJson(
      await withThesisEvidenceAi((ai) => {
        if (!ai.theses.list(code).some((point) => point.id === id))
          throw new ThesisError('투자포인트를 찾지 못했습니다.', 404);
        return { items: ai.evidence(id, undefined, true) };
      }),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
