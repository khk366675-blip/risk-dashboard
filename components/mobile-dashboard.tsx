'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ExternalLink,
  FileText,
  Gauge,
  MessageSquareText,
  Plus,
  RefreshCw,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  mobileReviewStateLabels,
  type MobileEvidenceItem,
  type MobileNote,
  type MobileSnapshot,
  type MobileStock,
} from '@/lib/mobile-dashboard';
import { learningKindLabels, learningStatusLabels } from '@/lib/research-system';
import { formatMultiple, formatPercent, formatWon } from '@/lib/stock-detail';

type MobileTab = 'market' | 'watchlist' | 'learning' | 'notes';
const relationLabels = {
  supports: '뒷받침',
  challenges: '약화',
  context: '미확인',
};

const formatAsset = (value: number | null, unit: string) => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === '%') return `${value.toLocaleString('ko-KR')}%`;
  if (unit === 'KRW') return `₩${value.toLocaleString('ko-KR')}`;
  if (unit === 'USD') return `$${value.toLocaleString('ko-KR')}`;
  return value.toLocaleString('ko-KR');
};
const change = (value: number | null) =>
  value === null
    ? '—'
    : `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
const dateTime = (value: string) =>
  new Date(value).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function EvidenceRow({ item }: { item: MobileEvidenceItem }) {
  return (
    <article className="rounded-2xl border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-[9px]">
          {relationLabels[item.relation]}
        </Badge>
        <span className="text-[9px] text-slate-400">{item.source}</span>
      </div>
      <h4 className="mt-2 text-xs font-semibold leading-5">{item.label}</h4>
      {item.summary && (
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
          {item.summary}
        </p>
      )}
      {item.note && (
        <p className="mt-2 rounded-xl bg-slate-50 p-2 text-[10px] leading-5 text-slate-600">
          {item.note}
        </p>
      )}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary"
        >
          원문 열기 <ExternalLink className="size-3" />
        </a>
      )}
    </article>
  );
}

function StockView({ stock, onBack }: { stock: MobileStock; onBack: () => void }) {
  const metrics = [
    ['PER', formatMultiple(stock.valuation.per)],
    ['PBR', formatMultiple(stock.valuation.pbr)],
    ['ROE', formatPercent(stock.valuation.ttm_roe_pct)],
    ['TTM 영업이익', formatWon(stock.valuation.ttm_operating_profit, true)],
  ];
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-slate-500"
      >
        <ChevronLeft className="size-4" /> 관심종목
      </button>
      <section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 text-slate-950 shadow-[0_12px_32px_rgba(37,99,235,0.10)]">
        <p className="text-[10px] text-slate-500">
          {stock.market} · {stock.sector}
        </p>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{stock.name}</h2>
            <p className="mt-1 text-xs text-slate-500">{stock.code}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold">
              {formatWon(stock.summary.latest_price)}
            </p>
            <p className={`mt-1 text-xs ${(stock.summary.change_1d_pct ?? 0) >= 0 ? 'text-rose-500' : 'text-blue-600'}`}>
              {change(stock.summary.change_1d_pct)} · {stock.summary.price_as_of}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
              <p className="text-[9px] text-slate-500">{label}</p>
              <p className="mt-1 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>
      {stock.theses.map((thesis) => (
        <section key={thesis.id} className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium text-primary">투자포인트</p>
            <Badge variant="secondary" className="text-[9px]">
              {mobileReviewStateLabels[thesis.review.state]}
            </Badge>
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-6">{thesis.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-700">
            {thesis.body}
          </p>
          {(thesis.timing || thesis.weakens) && (
            <div className="mt-3 grid gap-2 text-[10px] leading-5 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-slate-400">확인 시기</p>
                <p>{thesis.timing || '미정'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-slate-400">약화 조건</p>
                <p>{thesis.weakens || '미작성'}</p>
              </div>
            </div>
          )}
          {thesis.checks.length > 0 && (
            <details className="mt-3 rounded-2xl border p-3">
              <summary className="cursor-pointer text-[11px] font-semibold">
                검증 항목 {thesis.checks.length}개
              </summary>
              <ol className="mt-3 list-decimal space-y-2 pl-4 text-[11px] leading-5 text-slate-600">
                {thesis.checks.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </details>
          )}
          <details className="mt-3" open={thesis.evidence.length <= 4}>
            <summary className="cursor-pointer text-[11px] font-semibold">
              연결 자료 {thesis.evidence.length}개
            </summary>
            <div className="mt-2 space-y-2">
              {thesis.evidence.map((item) => (
                <EvidenceRow key={`${item.kind}:${item.id}`} item={item} />
              ))}
              {!thesis.evidence.length && (
                <p className="rounded-xl bg-slate-50 p-3 text-[10px] text-slate-500">
                  연결 자료가 없습니다.
                </p>
              )}
            </div>
          </details>
        </section>
      ))}
      {stock.kpis.length > 0 && (
        <section className="rounded-3xl border bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold">사업 KPI</h3>
          <div className="mt-3 space-y-2">
            {stock.kpis.map((kpi) => {
              const latest = kpi.observations.at(-1);
              return (
                <div key={kpi.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                  <div>
                    <p className="text-[11px] font-medium">{kpi.name}</p>
                    <p className="mt-1 text-[9px] text-slate-400">{latest?.period ?? '관측 전'}</p>
                  </div>
                  <p className="text-sm font-semibold">
                    {latest?.actual ?? '—'} {kpi.unit}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {stock.journal.length > 0 && (
        <section className="rounded-3xl border bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold">최근 리서치 로그</h3>
          <div className="mt-3 space-y-3">
            {stock.journal.slice(0, 5).map((item) => (
              <article key={item.id} className="border-l-2 border-primary/30 pl-3">
                <p className="text-[9px] text-slate-400">{item.occurred_at}</p>
                <p className="mt-1 text-[11px] font-semibold">{item.title}</p>
                <p className="mt-1 text-[10px] leading-5 text-slate-600">{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function MobileDashboard({
  snapshot,
  initialNotes,
  notesEnabled,
}: {
  snapshot: MobileSnapshot;
  initialNotes: MobileNote[];
  notesEnabled: boolean;
}) {
  const [tab, setTab] = useState<MobileTab>('market');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [notes, setNotes] = useState(initialNotes);
  const [noteCode, setNoteCode] = useState(snapshot.stocks[0]?.code ?? '');
  const [noteBody, setNoteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(
    () => snapshot.stocks.find((stock) => stock.code === selectedCode) ?? null,
    [snapshot.stocks, selectedCode],
  );
  const submitNote = async () => {
    if (!notesEnabled || !noteCode || !noteBody.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/mobile/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: noteCode, body: noteBody }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '메모를 저장하지 못했습니다.');
      setNotes((prior) => [result.note, ...prior]);
      setNoteBody('');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-[#f6f7fb] pb-24 text-slate-950">
      <header className="sticky top-0 z-20 border-b bg-white/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[.18em] text-primary">Value Dashboard</p>
            <h1 className="mt-0.5 text-base font-semibold">Research Mobile</h1>
          </div>
          <div className="text-right text-[9px] text-slate-400">
            <p>동기화 {dateTime(snapshot.generated_at)}</p>
            <p>{snapshot.stocks.length}개 관심종목</p>
          </div>
        </div>
      </header>
      <div className="p-3">
        {tab === 'market' && (
          <div className="space-y-3">
            <section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 text-slate-950 shadow-[0_12px_32px_rgba(37,99,235,0.10)]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-500">시장 기준 {snapshot.market.as_of}</p>
                <Badge variant="outline" className="border-blue-200 bg-white/75 text-[9px] text-primary">{snapshot.market.status}</Badge>
              </div>
              <h2 className="mt-3 text-xl font-semibold">{snapshot.market.summary.global_risk_label ?? '시장 상태'}</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
                  <p className="text-[9px] text-slate-500">한국 시장</p>
                  <p className="mt-1 font-semibold">{snapshot.market.summary.korea_label ?? '—'}</p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/75 p-3 shadow-sm">
                  <p className="text-[9px] text-slate-500">환율·금리</p>
                  <p className="mt-1 font-semibold">{snapshot.market.summary.fx_pressure_label ?? '—'}</p>
                </div>
              </div>
            </section>
            <section className="rounded-3xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold"><BarChart3 className="size-4 text-primary" /> 주요 지표</h2>
                <span className="text-[9px] text-slate-400">실제 수치</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {snapshot.market.assets.map((asset) => (
                  <article key={asset.key} className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-[9px] text-slate-500">{asset.label}</p>
                    <p className="mt-1 text-sm font-semibold">{formatAsset(asset.value, asset.unit)}</p>
                    <p className={`mt-1 text-[10px] ${(asset.change_1d_pct ?? 0) >= 0 ? 'text-rose-500' : 'text-blue-600'}`}>
                      {change(asset.change_1d_pct)} · 1D
                    </p>
                  </article>
                ))}
              </div>
            </section>
            <section className="rounded-3xl border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2"><Gauge className="size-4 text-primary" /><h2 className="text-xs font-semibold">Radar 최근 실행</h2></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[9px] text-slate-400">기준일</p><p className="mt-1 text-xs font-semibold">{snapshot.radar.as_of}</p></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[9px] text-slate-400">평가</p><p className="mt-1 text-xs font-semibold">{snapshot.radar.universe_count.toLocaleString()}개</p></div>
                <div className="rounded-2xl bg-slate-50 p-3"><p className="text-[9px] text-slate-400">후보</p><p className="mt-1 text-xs font-semibold">{snapshot.radar.candidate_count}개</p></div>
              </div>
              <p className="mt-3 text-[9px] leading-4 text-slate-400">모바일은 마지막 동기화 결과만 표시합니다. Radar 실행은 로컬 PC에서 진행합니다.</p>
            </section>
          </div>
        )}
        {tab === 'watchlist' && (selected ? (
          <StockView stock={selected} onBack={() => setSelectedCode(null)} />
        ) : (
          <div className="space-y-2">
            <div className="px-1 py-2"><h2 className="text-lg font-semibold">관심종목</h2><p className="mt-1 text-[10px] text-slate-500">투자포인트와 연결 자료 열람</p></div>
            {snapshot.stocks.map((stock) => (
              <button key={stock.code} type="button" onClick={() => setSelectedCode(stock.code)} className="w-full rounded-3xl border bg-white p-4 text-left shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-sm font-semibold">{stock.name}</p><p className="mt-1 text-[10px] text-slate-400">{stock.code} · {stock.sector}</p></div>
                  <div className="text-right"><p className="text-sm font-semibold">{formatWon(stock.summary.latest_price)}</p><p className="mt-1 text-[10px] text-slate-500">{change(stock.summary.change_1d_pct)}</p></div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500"><Star className="size-3 text-primary" /> 투자포인트 {stock.theses.length} · KPI {stock.kpis.length} · 로그 {stock.journal.length}</div>
              </button>
            ))}
          </div>
        ))}
        {tab === 'learning' && (
          <div className="space-y-2">
            <div className="px-1 py-2"><h2 className="text-lg font-semibold">Learning</h2><p className="mt-1 text-[10px] text-slate-500">독서·특강 기록 열람</p></div>
            {snapshot.learning.map((item) => (
              <article key={item.id} className="rounded-3xl border bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between"><Badge variant="secondary" className="text-[9px]">{learningKindLabels[item.kind]}</Badge><span className="text-[9px] text-slate-400">{learningStatusLabels[item.status]}</span></div>
                <h3 className="mt-3 text-sm font-semibold">{item.title}</h3><p className="mt-1 text-[10px] text-slate-400">{item.author}</p>
                {item.summary && <p className="mt-3 text-[11px] leading-5 text-slate-700">{item.summary}</p>}
                {item.lessons && <div className="mt-3 rounded-2xl bg-slate-50 p-3"><p className="text-[9px] text-slate-400">배운 점</p><p className="mt-1 text-[10px] leading-5">{item.lessons}</p></div>}
              </article>
            ))}
            {!snapshot.learning.length && <p className="rounded-3xl border bg-white p-5 text-xs text-slate-500">저장된 학습 기록이 없습니다.</p>}
          </div>
        )}
        {tab === 'notes' && (
          <div className="space-y-3">
            <section className="rounded-3xl border bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="size-4 text-primary" /> 종목 메모</h2>
              <p className="mt-1 text-[10px] leading-5 text-slate-500">모바일에서 남긴 메모는 다음 PC 동기화 때 해당 종목의 리서치 로그로 들어갑니다.</p>
              <select value={noteCode} onChange={(event) => setNoteCode(event.target.value)} className="mt-4 h-10 w-full rounded-xl border bg-white px-3 text-xs">
                {snapshot.stocks.map((stock) => <option key={stock.code} value={stock.code}>{stock.name} · {stock.code}</option>)}
              </select>
              <Textarea value={noteBody} maxLength={2000} onChange={(event) => setNoteBody(event.target.value)} className="mt-2 min-h-28" placeholder="이후 확인할 내용이나 새로 든 생각" />
              <Button className="mt-2 w-full" disabled={!notesEnabled || busy || !noteCode || !noteBody.trim()} onClick={() => void submitNote()}>{busy ? <RefreshCw className="animate-spin" /> : <Plus />} 메모 저장</Button>
              {!notesEnabled && <p className="mt-2 text-[9px] text-slate-400">로컬 미리보기에서는 원격 메모 저장을 사용하지 않습니다.</p>}
              {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
            </section>
            <section className="space-y-2">
              {notes.map((note) => {
                const stock = snapshot.stocks.find((item) => item.code === note.code);
                return <article key={note.id} className="rounded-2xl border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-semibold">{stock?.name ?? note.code}</p><span className="text-[9px] text-slate-400">{dateTime(note.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-700">{note.body}</p>{note.consumed_at && <p className="mt-2 text-[9px] text-emerald-600">PC 리서치 로그 반영 완료</p>}</article>;
              })}
              {!notes.length && <p className="rounded-2xl border bg-white p-4 text-[11px] text-slate-500">아직 모바일 메모가 없습니다.</p>}
            </section>
          </div>
        )}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg grid-cols-4 border-t bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),.5rem)] pt-2 backdrop-blur">
        {([
          ['market', 'Markets', BarChart3],
          ['watchlist', '관심종목', Star],
          ['learning', 'Learning', BookOpen],
          ['notes', '메모', FileText],
        ] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" onClick={() => { setTab(value); if (value !== 'watchlist') setSelectedCode(null); }} className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[9px] ${tab === value ? 'font-semibold text-primary' : 'text-slate-400'}`}><Icon className="size-4" />{label}</button>
        ))}
      </nav>
    </main>
  );
}
