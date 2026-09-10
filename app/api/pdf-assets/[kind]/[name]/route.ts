import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const runtime = 'nodejs';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; name: string }> },
) {
  const { kind, name } = await params;
  const allowed =
    kind === 'cmaps'
      ? /^[a-zA-Z0-9_-]+\.bcmap$/
      : kind === 'standard_fonts'
        ? /^[a-zA-Z0-9_-]+\.(pfb|ttf)$/
        : kind === 'wasm'
          ? /^[a-zA-Z0-9_-]+\.(wasm|js)$/
          : null;
  if (!allowed?.test(name)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(
      path.join(process.cwd(), 'node_modules/pdfjs-dist', kind, name),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': name.endsWith('.wasm')
          ? 'application/wasm'
          : name.endsWith('.js')
            ? 'text/javascript'
            : 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
