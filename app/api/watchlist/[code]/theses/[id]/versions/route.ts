import {
  thesisRequest,
  thesisJson,
  thesisFailure,
  withTheses,
} from '@/lib/server/thesis-http';
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
      withTheses((store) => {
        store.active(code);
        return {
          versions: store.db
            .prepare(
              'SELECT r.revision,r.saved_at,r.content_json FROM investment_thesis_revisions r JOIN investment_theses t ON t.id=r.thesis_id WHERE t.code=? AND t.id=? ORDER BY r.revision DESC',
            )
            .all(code, id)
            .map((r) => ({
              revision: Number(r.revision),
              saved_at: String(r.saved_at),
              content: JSON.parse(String(r.content_json)),
            })),
        };
      }),
    );
  } catch (error) {
    return thesisFailure(error);
  }
}
