'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActionConfirmation } from '@/components/use-action-confirmation';
import type { InvestmentThesis } from '@/lib/investment-thesis';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
type Document = { id: string; title: string; page_count: number };
type Annotation = {
  id: string;
  page: number;
  body: string;
  note: string;
  rectangles: number[][];
  thesis_id: string;
};
async function json(r: Response) {
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || '요청 실패');
  return body;
}
export function PdfResearchReader({ code }: { code: string }) {
  const query = useSearchParams(),
    [documents, setDocuments] = useState<Document[]>([]),
    [id, setId] = useState(query.get('document') ?? ''),
    [page, setPage] = useState(Math.max(1, Number(query.get('page')) || 1)),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [points, setPoints] = useState<InvestmentThesis[]>([]),
    [thesisId, setThesisId] = useState(''),
    [annotations, setAnnotations] = useState<Annotation[]>([]),
    [quote, setQuote] = useState(''),
    [rects, setRects] = useState<number[][]>([]),
    [note, setNote] = useState(''),
    [relation, setRelation] = useState('context'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [width, setWidth] = useState(700),
    [rendered, setRendered] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null),
    paper = useRef<HTMLDivElement>(null),
    container = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const { confirmAction, confirmationDialog } = useActionConfirmation();
  const point = points.find((p) => p.id === thesisId) ?? points[0];
  const refresh = useCallback(async () => {
    const d = await json(
      await fetch(`/api/stocks/${code}/pdf`, { cache: 'no-store' }),
    );
    setDocuments(d.items);
    if (d.items.length) setId((current) => current || d.items[0].id);
  }, [code]);
  useEffect(() => {
    void fetch(`/api/stocks/${code}/pdf`, { cache: 'no-store' })
      .then(json)
      .then((d) => {
        setDocuments(d.items);
        if (d.items.length) setId((current) => current || d.items[0].id);
      })
      .catch((e) => setError(e.message));
    void fetch(`/api/watchlist/${code}/theses`)
      .then(json)
      .then((b) => setPoints(b.items))
      .catch((e) => setError(e.message));
  }, [code]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(280, entries[0].contentRect.width - 32)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!id) return;
    let active = true;
    let task:
      | ReturnType<(typeof import('pdfjs-dist'))['getDocument']>
      | undefined;
    void import('pdfjs-dist')
      .then(async (lib) => {
        if (!active) return;
        setPdf(null);
        setQuote('');
        setRects([]);
        setError('');
        lib.GlobalWorkerOptions.workerSrc = '/api/pdf-worker';
        task = lib.getDocument({
          url: `/api/stocks/${code}/pdf/${id}`,
          disableRange: true,
          cMapUrl: '/api/pdf-assets/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/api/pdf-assets/standard_fonts/',
          wasmUrl: '/api/pdf-assets/wasm/',
        });
        const document = await task.promise;
        if (active) {
          setPdf(document);
          setPage((p) => Math.min(p, document.numPages));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    void fetch(`/api/stocks/${code}/pdf/${id}/annotations`)
      .then(json)
      .then((b) => {
        if (active) setAnnotations(b.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [code, id]);
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current || !paper.current) return;
    let active = true;
    let renderTask: { cancel: () => void } | undefined;
    let textLayer: { cancel: () => void } | undefined;
    void (async () => {
      const pdfPage = await pdf.getPage(page);
      if (!active) return;
      setRendered(false);
      setQuote('');
      setRects([]);
      const natural = pdfPage.getViewport({ scale: 1 }),
        scale = width / natural.width,
        viewport = pdfPage.getViewport({ scale });
      const element = canvas.current!,
        text = layer.current!,
        sheet = paper.current!;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.floor(viewport.width * ratio);
      element.height = Math.floor(viewport.height * ratio);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      sheet.style.width = `${viewport.width}px`;
      sheet.style.height = `${viewport.height}px`;
      sheet.style.setProperty('--scale-factor', String(scale));
      sheet.style.setProperty('--total-scale-factor', String(scale));
      text.replaceChildren();
      const task = pdfPage.render({
        canvas: element,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      renderTask = task;
      await task.promise;
      if (!active) return;
      const lib = await import('pdfjs-dist');
      const tl = new lib.TextLayer({
        textContentSource: await pdfPage.getTextContent(),
        container: text,
        viewport,
      });
      textLayer = tl;
      await tl.render();
      if (active) setRendered(true);
    })().catch((e) => {
      if (active && e.name !== 'RenderingCancelledException')
        setError(e.message);
    });
    return () => {
      active = false;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, page, width]);
  const selectText = useCallback(() => {
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      !paper.current ||
      !paper.current.contains(selection.anchorNode) ||
      !paper.current.contains(selection.focusNode)
    )
      return;
    const text = selection.toString().trim();
    if (!text) return;
    const box = paper.current.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const areas = Array.from(selection.getRangeAt(0).getClientRects())
      .filter((r) => r.width && r.height)
      .slice(0, 100)
      .map((r) => [
        clamp((r.left - box.left) / box.width),
        clamp((r.top - box.top) / box.height),
        clamp(r.width / box.width),
        clamp(r.height / box.height),
      ]);
    setQuote(text.slice(0, 4000));
    setRects(areas);
  }, []);
  useEffect(() => {
    const element = paper.current;
    if (!element) return;
    // Observe selection only. This is not a clickable control; keyboard users
    // can also enter the excerpt in the adjacent labelled textarea.
    element.addEventListener('mouseup', selectText);
    element.addEventListener('touchend', selectText);
    element.addEventListener('keyup', selectText);
    return () => {
      element.removeEventListener('mouseup', selectText);
      element.removeEventListener('touchend', selectText);
      element.removeEventListener('keyup', selectText);
    };
  }, [selectText]);
  async function upload(selected: File) {
    if (
      !(await confirmAction({
        title: 'PDF를 첨부할까요?',
        description:
          '선택한 PDF를 이 PC에 보관합니다. AI 전송이나 모바일 게시는 하지 않습니다.',
        actionLabel: '첨부',
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      const b = await json(
        await fetch(
          `/api/stocks/${code}/pdf?title=${encodeURIComponent(selected.name.replace(/\.pdf$/i, ''))}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body: selected,
          },
        ),
      );
      await refresh();
      setId(b.item.id);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '첨부 실패');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }
  async function save() {
    if (!point || !id) return;
    setBusy(true);
    setError('');
    try {
      await json(
        await fetch(`/api/stocks/${code}/pdf/${id}/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            thesis_id: point.id,
            thesis_revision: point.revision,
            page,
            rectangles: rects,
            quote,
            note,
            relation,
          }),
        }),
      );
      const b = await json(
        await fetch(`/api/stocks/${code}/pdf/${id}/annotations`),
      );
      setAnnotations(b.items);
      setNote('');
      setQuote('');
      setRects([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
      {confirmationDialog}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-3">
        <div className="flex items-center gap-4">
          <Link
            className="text-xs text-primary"
            href={`/stocks/${code}?tab=documents`}
          >
            ← 종목 자료
          </Link>
          <h1 className="text-base font-semibold">PDF 자료</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="PDF 선택"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setPage(1);
            }}
            className="max-w-64 rounded-lg border p-2 text-xs"
          >
            <option value="">자료 선택</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <input
            ref={file}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            PDF 첨부
          </Button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="shrink-0 bg-amber-50 px-5 py-2 text-xs text-amber-900"
        >
          {error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 items-center justify-center gap-3 border-b bg-white py-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!pdf || page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              이전
            </Button>
            <Input
              aria-label="PDF 페이지"
              className="w-16 text-center"
              type="number"
              min={1}
              max={pdf?.numPages ?? 1}
              value={page}
              onChange={(e) =>
                setPage(
                  Math.max(
                    1,
                    Math.min(pdf?.numPages ?? 1, Number(e.target.value) || 1),
                  ),
                )
              }
            />
            <span className="text-xs text-muted-foreground">
              / {pdf?.numPages ?? '—'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!pdf || page >= pdf.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
          <div ref={container} className="min-h-0 flex-1 overflow-auto p-4">
            {!id && (
              <p className="p-12 text-center text-sm text-muted-foreground">
                리포트나 IR PDF를 첨부해 읽고, 필요한 부분만 근거로 연결하세요.
              </p>
            )}
            <div ref={paper} className="relative mx-auto bg-white shadow-sm">
              <canvas ref={canvas} />
              <div ref={layer} className="textLayer" />
              {rendered &&
                annotations
                  .filter((a) => a.page === page)
                  .flatMap((a) =>
                    a.rectangles.map((r, i) => (
                      <div
                        key={`${a.id}-${i}`}
                        className="pointer-events-none absolute bg-yellow-300/30"
                        style={{
                          left: `${r[0] * 100}%`,
                          top: `${r[1] * 100}%`,
                          width: `${r[2] * 100}%`,
                          height: `${r[3] * 100}%`,
                        }}
                      />
                    )),
                  )}
            </div>
          </div>
        </section>
        <aside className="min-h-0 space-y-3 overflow-y-auto border-l bg-white p-4">
          <h2 className="text-sm font-semibold">투자포인트에 연결</h2>
          <p className="text-[11px] text-muted-foreground">
            문장을 드래그하거나, 스캔·표 자료는 현재 페이지를 보며 인용 내용을
            직접 적으세요. 연결된 자료는 검증 질문에서도 선택할 수 있습니다.
          </p>
          <select
            aria-label="연결할 투자포인트"
            value={point?.id ?? ''}
            onChange={(e) => setThesisId(e.target.value)}
            className="w-full rounded-lg border p-2 text-xs"
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.content.title || p.content.body.slice(0, 50)}
              </option>
            ))}
          </select>
          {!points.length && (
            <Link
              href={`/stocks/${code}?tab=thesis`}
              className="block text-xs text-primary underline"
            >
              먼저 투자포인트 작성
            </Link>
          )}
          <label className="block text-xs">
            인용 · {page}페이지
            <textarea
              className="mt-2 min-h-28 w-full rounded-lg border p-2"
              maxLength={4000}
              value={quote}
              onChange={(e) => {
                setQuote(e.target.value);
                setRects([]);
              }}
            />
          </label>
          <label className="block text-xs">
            내 메모
            <textarea
              className="mt-2 min-h-20 w-full rounded-lg border p-2"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <select
            aria-label="근거 관계"
            className="w-full rounded-lg border p-2 text-xs"
            value={relation}
            onChange={(e) => setRelation(e.target.value)}
          >
            <option value="context">미확인</option>
            <option value="supports">뒷받침</option>
            <option value="challenges">약화</option>
          </select>
          <Button
            size="sm"
            disabled={busy || !quote.trim() || !point || !pdf}
            onClick={() => void save()}
          >
            근거 연결
          </Button>
          <div className="space-y-2 border-t pt-4">
            <h3 className="text-xs font-semibold">저장한 위치</h3>
            {annotations.map((a) => (
              <button
                key={a.id}
                className="block w-full rounded-lg border p-3 text-left text-xs"
                onClick={() => setPage(a.page)}
              >
                <strong>p.{a.page}</strong>
                <span className="mt-1 block line-clamp-3 text-muted-foreground">
                  {a.body}
                </span>
                {a.note && <p className="mt-2">{a.note}</p>}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
