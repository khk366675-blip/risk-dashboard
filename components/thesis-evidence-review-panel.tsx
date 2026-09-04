'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  evidenceReviewKinds,
  thesisEvidenceAiConfig,
  type ThesisEvidenceAiRun,
  type ThesisEvidenceAiView,
} from '@/lib/thesis-evidence-ai';
import type { InvestmentThesis } from '@/lib/investment-thesis';

type EvidenceThesis = InvestmentThesis & {
  evidence?: {
    total: number;
    supports: number;
    challenges: number;
    context: number;
  };
};

async function responseJson(response: Response) {
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || 'AI 근거 검토를 처리하지 못했습니다.');
  return result;
}

export function ThesisEvidenceReviewPanel({
  code,
  thesis,
}: {
  code: string;
  thesis: EvidenceThesis | null;
}) {
  const [view, setView] = useState<ThesisEvidenceAiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const requestId = useRef<{ signature: string; id: string } | null>(null);
  const base = thesis
    ? `/api/watchlist/${code}/theses/${thesis.id}/evidence-review`
    : null;
  const relationCounts = {
    supports:
      view?.input.evidence.filter((item) => item.relation === 'supports')
        .length ?? thesis?.evidence?.supports ?? 0,
    challenges:
      view?.input.evidence.filter((item) => item.relation === 'challenges')
        .length ?? thesis?.evidence?.challenges ?? 0,
    context:
      view?.input.evidence.filter((item) => item.relation === 'context')
        .length ?? thesis?.evidence?.context ?? 0,
  };
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!base) return null;
      const result = (await responseJson(
        await fetch(base, { cache: 'no-store', signal }),
      )) as ThesisEvidenceAiView;
      if (!signal?.aborted) {
        setView(result);
        setError(null);
      }
      return result;
    },
    [base],
  );
  useEffect(() => {
    const abort = new AbortController();
    if (base) {
      void fetch(base, { cache: 'no-store', signal: abort.signal })
        .then(responseJson)
        .then((result: ThesisEvidenceAiView) => {
          if (!abort.signal.aborted) {
            setView(result);
            setError(null);
          }
        })
        .catch((failure) => {
          if (!abort.signal.aborted)
            setError(
              failure instanceof Error
                ? failure.message
                : 'AI 검토 상태를 읽지 못했습니다.',
            );
        });
    }
    return () => abort.abort();
  }, [base]);
  useEffect(() => {
    if (view?.run?.state !== 'pending' || busy) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void load(abort.signal).catch(() => {
        if (!abort.signal.aborted)
          setError('AI 요청 상태를 다시 읽지 못했습니다.');
      });
    }, thesisEvidenceAiConfig.poll_interval_ms);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [view?.run?.state, busy, load]);
  if (!thesis)
    return (
      <div className="grid h-full place-items-center p-6 text-center text-xs leading-6 text-muted-foreground">
        투자포인트를 선택하면 연결 자료 기반 AI 검토 범위를 확인할 수 있습니다.
      </div>
    );
  const stale = Boolean(
    view?.run &&
    (view.run.thesis_revision !== view.revision ||
      view.run.evidence_signature !== view.signature),
  );
  const run = view?.run;
  const generate = async () => {
    if (!view || !base || !consent || busy) return;
    setBusy(true);
    setError(null);
    if (requestId.current?.signature !== view.signature)
      requestId.current = {
        signature: view.signature,
        id: crypto.randomUUID(),
      };
    try {
      const result = (await responseJson(
        await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: requestId.current.id,
            revision: view.revision,
            signature: view.signature,
            consent: true,
          }),
        }),
      )) as { run: ThesisEvidenceAiRun };
      setView({ ...view, run: result.run });
      setConsentOpen(false);
      setConsent(false);
      if (['error', 'interrupted'].includes(result.run.state))
        requestId.current = null;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'AI 검토 요청에 실패했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-5">
        <div className="flex items-center gap-2 text-primary">
          <span className="grid size-8 place-items-center rounded-xl bg-primary/10">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">AI 근거 검토</h3>
            <p className="text-[10px] text-muted-foreground">
              연결 자료의 충돌·공백·다음 질문
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs font-semibold">
          {thesis.content.title || '제목 없는 포인트'}
        </p>
        <p className="mt-1 line-clamp-3 text-[11px] leading-5 text-muted-foreground">
          {thesis.content.body}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-lg bg-muted px-2 py-1">
            연결 자료 {view?.evidence_count ?? thesis.evidence?.total ?? 0}개
          </span>
          <span className="rounded-lg bg-sky-50 px-2 py-1 text-sky-700">
            뒷받침 {relationCounts.supports}
          </span>
          <span className="rounded-lg bg-amber-50 px-2 py-1 text-amber-800">
            약화 {relationCounts.challenges}
          </span>
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-600">
            미확인 {relationCounts.context}
          </span>
        </div>
        {!view ? (
          <p className="mt-4 text-[11px] text-muted-foreground">
            전송 범위를 확인하고 있습니다…
          </p>
        ) : (
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={
                busy ||
                !view.configured ||
                !view.evidence_count ||
                run?.state === 'pending' ||
                thesis.archived
              }
              onClick={() => {
                setConsent(false);
                setConsentOpen(true);
              }}
            >
              {busy || run?.state === 'pending' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              {!view.configured ? 'API 연결 후 사용' : '연결 자료 검토 요청'}
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="AI 근거 검토 상태 새로고침"
              disabled={busy}
              onClick={() =>
                void load().catch((failure) =>
                  setError((failure as Error).message),
                )
              }
            >
              <RefreshCw />
            </Button>
          </div>
        )}
        {view && !view.configured && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">
            OpenAI API 키 미설정 · 기능 구조는 준비됐지만 외부 전송은 실행되지
            않습니다.
          </p>
        )}
        {!(view?.evidence_count ?? thesis.evidence?.total ?? 0) && (
          <p className="mt-3 rounded-xl border p-3 text-[10px] leading-5 text-muted-foreground">
            먼저 공시·재무·외부 자료를 이 투자포인트에 연결해 주세요. 자료 없이
            AI가 내용을 채우지 않습니다.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-3 text-[11px] leading-5 text-destructive"
          >
            {error}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!run && (
          <div className="rounded-2xl border border-dashed p-4 text-[11px] leading-6 text-muted-foreground">
            기존의 AI 질문 기능은 투자포인트 글만 읽습니다. 이 화면은 사용자가
            연결한 공시·재무·외부 자료 snapshot까지 함께 보내 충돌 가능성과 논리
            공백을 찾습니다.
          </div>
        )}
        {run?.state === 'pending' && (
          <output className="block rounded-2xl border p-4 text-xs leading-6">
            저장된 입력 범위를 검토하고 있습니다. 자동 재시도하지 않습니다.
          </output>
        )}
        {run?.error && (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[11px] leading-6 text-rose-900">
            {run.error}
          </p>
        )}
        {stale && (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-5 text-amber-900">
            이후 투자포인트나 연결 자료가 바뀌었습니다. 아래 결과는 이전 범위의
            검토입니다.
          </p>
        )}
        {run?.answer?.status === 'insufficient_evidence' && (
          <p className="rounded-2xl border p-4 text-xs leading-6 text-muted-foreground">
            현재 연결 자료만으로는 출처에 근거한 검토 항목을 만들기 어렵습니다.
          </p>
        )}
        <div className="space-y-3">
          {run?.answer?.findings.map((finding, index) => (
            <article key={index} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-primary">
                  {evidenceReviewKinds[finding.kind]}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  근거 {finding.source_ids.length}개
                </span>
              </div>
              <blockquote className="mt-3 border-l-2 pl-3 text-[10px] leading-5 text-muted-foreground">
                내 글: “{finding.point_quote}”
              </blockquote>
              <p className="mt-3 text-[11px] leading-6">
                {finding.explanation}
              </p>
              <p className="mt-3 rounded-xl bg-muted/60 p-3 text-[11px] font-medium leading-6">
                {finding.question}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {finding.source_ids.map((id) => (
                  <span
                    key={id}
                    className="rounded-md bg-primary/5 px-2 py-1 text-[9px] text-primary"
                  >
                    {id.split(':')[0]} · {id.split(':')[1]?.slice(0, 8)}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
        {run?.state === 'completed' && (
          <div className="mt-4 space-y-1 text-[9px] leading-5 text-muted-foreground">
            <p className="flex items-start gap-2">
              {run.answer?.findings.length ? (
                <CheckCircle2 className="mt-1 size-3 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-1 size-3 shrink-0" />
              )}
              AI 결과는 검토 질문이며 사실 판정이나 투자포인트 상태 변경이
              아닙니다. 상태는 사용자가 직접 기록합니다.
            </p>
            <p>
              {run.model} · 입력 {run.usage?.input_tokens ?? '미확인'} / 출력{' '}
              {run.usage?.output_tokens ?? '미확인'} 토큰
            </p>
          </div>
        )}
      </div>
      <Dialog
        open={consentOpen}
        onOpenChange={(open) => !busy && setConsentOpen(open)}
      >
        <DialogContent
          className="max-h-[88dvh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>투자포인트와 연결 자료 전송</DialogTitle>
            <DialogDescription>
              OpenAI 유료 API · {view?.model}. 아래 저장 snapshot만 전송하며
              링크를 따라가거나 다른 자료를 읽지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-2xl border p-4 text-[11px] leading-5">
            <p className="font-semibold">
              {view?.input.company.name} · 저장 버전 {view?.revision}
            </p>
            <p>{view?.input.point.body}</p>
            <div className="border-t pt-3">
              <p className="font-medium">
                연결 자료 {view?.input.evidence.length ?? 0}개
              </p>
              {view?.input.evidence.map((item) => (
                <p key={item.id} className="mt-2 text-muted-foreground">
                  {item.label} · {item.source_name} · {item.source_status}
                </p>
              ))}
            </div>
          </div>
          <p className="text-[10px] leading-5 text-muted-foreground">
            사용자가 입력한 뉴스·리포트·메모는 미검증 자료라는 상태를 포함해
            전송합니다. 결과는 자동으로 가설이나 상태를 수정하지 않습니다.
          </p>
          <label className="flex items-start gap-2 text-xs leading-5">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
            />
            표시된 투자포인트와 연결 자료 snapshot을 OpenAI에 전송하는 데
            동의합니다.
          </label>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConsentOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={!consent || !view?.configured || busy}
              onClick={() => void generate()}
            >
              {busy ? '검토 중…' : '동의하고 검토 요청'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
