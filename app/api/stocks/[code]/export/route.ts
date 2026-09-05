import { localStore } from '@/lib/server/research-store';
import { readPreview, readRadar } from '@/lib/server/research-service';
import { researchMarkdown } from '@/lib/server/research-export';
import { financialCsv } from '@/lib/research-export';
import { thesisRequest, thesisFailure } from '@/lib/server/thesis-http';
import { ThesisError } from '@/lib/investment-thesis';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    thesisRequest(request, code);
    const format = new URL(request.url).searchParams.get('format');
    if (!['csv', 'md'].includes(format ?? ''))
      throw new ThesisError('내보내기 형식을 확인해 주세요.');
    const owner = localStore();
    try {
      const record = owner.get(code);
      const stock =
        record?.stock ?? (await readPreview(code, await readRadar()));
      if (!stock) throw new ThesisError('종목을 찾지 못했습니다.', 404);
      if (format === 'md' && !record?.item.active)
        throw new ThesisError(
          'Research View는 관심종목 등록 후 이용할 수 있습니다.',
        );
      const content =
        format === 'csv'
          ? financialCsv(stock)
          : researchMarkdown(owner.db, stock);
      return new Response(content, {
        headers: {
          'Content-Type':
            format === 'csv'
              ? 'text/csv; charset=utf-8'
              : 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${code}-research.${format}"`,
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      owner.close();
    }
  } catch (e) {
    return thesisFailure(e);
  }
}
