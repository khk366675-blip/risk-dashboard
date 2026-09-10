import {
  thesisRequest,
  thesisBody,
  thesisJson,
  thesisFailure,
} from '@/lib/server/thesis-http';
import { localStore } from '@/lib/server/research-store';
import { ManualEvidenceStore } from '@/lib/server/manual-evidence-store';
import { ThesisError, uuidPattern } from '@/lib/investment-thesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string; id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { code, id } = await params;
    thesisRequest(request, code);
    const store = localStore();
    try {
      return thesisJson({
        items: store.db
          .prepare(
            'SELECT a.*,m.body,m.note,m.thesis_id,m.relation FROM pdf_annotations a JOIN pdf_documents d ON d.id=a.document_id JOIN research_manual_evidence m ON m.id=a.manual_id WHERE d.code=? AND d.id=? AND m.archived_at IS NULL ORDER BY a.page,a.created_at',
          )
          .all(code, id)
          .map((row) => ({
            ...row,
            rectangles: JSON.parse(String(row.rectangles_json)),
          })),
      });
    } finally {
      store.close();
    }
  } catch (e) {
    return thesisFailure(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { code, id } = await params;
    thesisRequest(request, code, true);
    const body = await thesisBody(request),
      store = localStore();
    try {
      const doc = store.db
        .prepare(
          'SELECT * FROM pdf_documents WHERE code=? AND id=? AND archived_at IS NULL',
        )
        .get(code, id);
      if (!doc) throw new ThesisError('PDF를 찾지 못했습니다.', 404);
      if (
        typeof body.quote !== 'string' ||
        typeof body.id !== 'string' ||
        typeof body.thesis_id !== 'string' ||
        (body.note !== undefined && typeof body.note !== 'string')
      )
        throw new ThesisError('인용과 연결할 투자포인트를 확인해 주세요.');
      const page = Number(body.page),
        rects = body.rectangles,
        quote = body.quote,
        note = body.note ?? '',
        annotationId = body.id;
      if (
        !uuidPattern.test(annotationId) ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > Number(doc.page_count) ||
        !quote.trim() ||
        quote.length > 4000 ||
        note.length > 500 ||
        !Array.isArray(rects) ||
        rects.length > 100 ||
        rects.some(
          (r) =>
            !Array.isArray(r) ||
            r.length !== 4 ||
            r.some(
              (v) =>
                typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1,
            ),
        )
      )
        throw new ThesisError('선택한 페이지·영역·메모를 확인해 주세요.');
      const origin = request.headers.get('origin')!;
      const item = new ManualEvidenceStore(store.db).create(
        code,
        {
          id: annotationId,
          thesis_id: body.thesis_id,
          thesis_revision: Number(body.thesis_revision),
          relation: body.relation as 'supports' | 'challenges' | 'context',
          source_type: 'other',
          title: `${String(doc.title).slice(0, 130)} · p.${page}`,
          url: `${origin}/stocks/${code}/pdf?document=${id}&page=${page}`,
          source_name: '사용자 첨부 PDF',
          published_at: '',
          body: quote,
          note,
        },
        (manualId) => {
          const prior = store.db
            .prepare('SELECT * FROM pdf_annotations WHERE id=?')
            .get(annotationId);
          if (
            prior &&
            (prior.document_id !== id ||
              prior.page !== page ||
              prior.rectangles_json !== JSON.stringify(rects))
          )
            throw new ThesisError(
              '같은 저장 요청의 선택 영역이 변경되었습니다. 다시 저장해 주세요.',
              409,
            );
          store.db
            .prepare(
              'INSERT INTO pdf_annotations(id,document_id,manual_id,page,rectangles_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
            )
            .run(
              annotationId,
              id,
              manualId,
              page,
              JSON.stringify(rects),
              new Date().toISOString(),
            );
        },
      );
      return thesisJson({ item }, 201);
    } finally {
      store.close();
    }
  } catch (e) {
    return thesisFailure(e);
  }
}
