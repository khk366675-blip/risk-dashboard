import { thesisRequest, thesisFailure } from '@/lib/server/thesis-http';
import { pdfBytes } from '@/lib/server/pdf-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  try {
    const { code, id } = await params;
    thesisRequest(request, code);
    return new Response(new Uint8Array(await pdfBytes(code, id)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline; filename="research.pdf"',
      },
    });
  } catch (e) {
    return thesisFailure(e);
  }
}
