import {
  thesisRequest,
  thesisJson,
  thesisFailure,
} from '@/lib/server/thesis-http';
import { localStore } from '@/lib/server/research-store';
import { uploadPdf } from '@/lib/server/pdf-store';
import { operationsConfig } from '@/lib/server/dashboard-jobs';
import { ThesisError } from '@/lib/investment-thesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { code } = await params;
    thesisRequest(request, code);
    const store = localStore();
    try {
      return thesisJson({
        items: store.db
          .prepare(
            'SELECT id,code,title,page_count,created_at FROM pdf_documents WHERE code=? AND archived_at IS NULL ORDER BY created_at DESC',
          )
          .all(code),
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
    const { code } = await params;
    thesisRequest(request, code, true);
    if (!request.headers.get('content-type')?.startsWith('application/pdf'))
      throw new ThesisError('PDF 파일이 필요합니다.');
    const reader = request.body?.getReader();
    if (!reader) throw new ThesisError('PDF가 비어 있습니다.');
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > operationsConfig.pdf_max_bytes) {
          await reader.cancel();
          throw new ThesisError('PDF는 25MB까지 첨부할 수 있습니다.', 413);
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return thesisJson(
      {
        item: await uploadPdf(
          code,
          new URL(request.url).searchParams.get('title') ?? '',
          Buffer.concat(parts),
        ),
      },
      201,
    );
  } catch (e) {
    return thesisFailure(e);
  }
}
