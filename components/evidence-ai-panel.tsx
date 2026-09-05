'use client';

import { useEffect, useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  LoaderCircle,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActionConfirmation } from '@/components/use-action-confirmation';
import type { Lens } from '@/lib/radar-run';
import type {
  EvidencePacket,
  ExplanationResult,
} from '@/lib/evidence-explanation';

type PanelData = {
  packet: EvidencePacket;
  revision: string;
  configured: boolean;
  model: string;
  result: ExplanationResult | null;
};
export function EvidenceAiPanel({ code, lens }: { code: string; lens: Lens }) {
  const { confirmAction, confirmationDialog } = useActionConfirmation();
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/stocks/${code}/evidence?lens=${lens}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => {
          throw new Error(
            '서버 응답을 읽지 못했습니다. 개발 서버 상태를 확인하고 다시 시도해 주세요.',
          );
        });
        if (!response.ok)
          throw new Error(body.error || '근거를 불러오지 못했습니다.');
        return body as PanelData;
      })
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : '근거를 불러오지 못했습니다.',
          );
      });
    return () => abort.abort();
  }, [code, lens, retry]);
  function reload() {
    setData(null);
    setError(null);
    setRetry(retry + 1);
  }
  async function generate() {
    if (!data || busy) return;
    if (
      !(await confirmAction({
        title: 'AI 해설을 요청할까요?',
        description: `공개 종목 정보와 선택한 Radar 선정 근거를 OpenAI에 전송합니다. API 사용 비용이 발생할 수 있습니다.\n모델: ${data.model}\n관심종목 목록과 개인 검토 기록은 보내지 않습니다.`,
        actionLabel: '확인하고 AI 요청',
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/stocks/${code}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lens, revision: data.revision }),
      });
      const body = await response.json().catch(() => {
        throw new Error(
          '서버 응답을 읽지 못했습니다. 자동 재시도하지 않았습니다. 서버 상태를 확인해 주세요.',
        );
      });
      if (!response.ok)
        throw new Error(body.error || 'AI 설명을 생성하지 못했습니다.');
      if (body.revision !== data.revision)
        throw new Error('근거 버전이 바뀌었습니다. 다시 확인해 주세요.');
      setData({ ...data, result: body.result });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'AI 설명을 생성하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <output className="block py-4 text-xs leading-6 text-muted-foreground">
        {error ?? '선정 당시 근거를 확인합니다…'}
        {error && (
          <Button size="sm" variant="outline" onClick={reload}>
            다시 확인
          </Button>
        )}
      </output>
    );
  const { packet, result } = data;
  return (
    <div className="space-y-4">
      {confirmationDialog}
      <section className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="size-4" />
          <h3 className="text-sm font-semibold">선정 근거를 이해하기</h3>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {packet.as_of} Radar 기록을 설명합니다. 최신 재무 재평가나 공시 본문
          분석은 아닙니다.
        </p>
        <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
          요청할 때만 공개 종목 정보와 선정 근거를 OpenAI로 전송합니다. 관심종목
          목록·검토 기록은 보내지 않습니다.
        </p>
        {!data.configured && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-5 text-amber-900">
            API 키 미설정 · .env.local에 OPENAI_API_KEY를 추가하고 서버를 다시
            시작해 주세요. 키는 화면이나 채팅에 입력하지 마세요.
          </p>
        )}
        {packet.status === 'insufficient_evidence' && (
          <p className="mt-3 text-[11px] text-amber-800">
            근거가 부족해 AI 요청을 보내지 않습니다.
          </p>
        )}
        {!result && (
          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={busy || !data.configured || packet.status !== 'available'}
            onClick={() => void generate()}
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            {busy ? '근거 설명 중…' : 'AI 해설 생성 · API 사용'}
          </Button>
        )}
        <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
          {data.model} · 동일 근거의 유효한 답변은 재사용
        </p>
      </section>
      {error && (
        <section
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900"
        >
          {error}
          <Button size="sm" variant="ghost" disabled={busy} onClick={reload}>
            근거 다시 확인
          </Button>
        </section>
      )}
      {result && (
        <section className="space-y-3" aria-label="AI 생성 해설">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">AI 해석 · 원문 확인 필요</h3>
            <span className="text-[9px] text-muted-foreground">
              {result.cached ? '저장된 답변' : '새로 생성'}
            </span>
          </div>
          {result.answer.status === 'insufficient_evidence' && (
            <p className="text-xs leading-6 text-muted-foreground">
              AI가 설명에 필요한 근거가 부족하다고 응답했습니다. 아래 원자료와
              미확인 항목을 확인하세요.
            </p>
          )}
          {result.answer.claims.map((claim, index) => (
            <article key={index} className="rounded-xl border bg-card p-3">
              <div className="mb-2 flex flex-wrap gap-1">
                {claim.source_ids.map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setSelected(id)}
                    className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary"
                    aria-label={`${id} 근거 펼치기`}
                  >
                    {id} 근거
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-6">{claim.explanation}</p>
              <p className="mt-3 border-t pt-2 text-[11px] leading-5 text-muted-foreground">
                <span className="block text-[10px] font-medium text-primary">
                  추가 확인 질문
                </span>
                {claim.question}
              </p>
            </article>
          ))}
          <p className="text-[9px] leading-4 text-muted-foreground">
            출처 연결·숫자 표현 검사만 자동 수행합니다. 해석의 정확성을 보증하지
            않습니다.
            <br />
            생성 {new Date(result.generated_at).toLocaleString('ko-KR')}
            {result.input_tokens !== null && result.output_tokens !== null
              ? ` · 토큰 ${result.input_tokens.toLocaleString()}/${result.output_tokens.toLocaleString()} (입력/출력)`
              : ''}
          </p>
        </section>
      )}
      <section aria-label="규칙 기반 지표 설명">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <BookOpen className="size-3.5" />
          수치·계산 의미{' '}
          <span className="ml-auto text-[9px] font-normal text-muted-foreground">
            고정 설명 · AI 아님
          </span>
        </h3>
        <div className="space-y-2">
          {packet.facts.map((fact) => (
            <details
              key={fact.id}
              open={selected === fact.id}
              className="rounded-xl border bg-card"
              onToggle={(event) => {
                if (!event.currentTarget.open && selected === fact.id)
                  setSelected(null);
              }}
            >
              <summary
                className="cursor-pointer list-none p-3"
                onClick={(event) => {
                  event.preventDefault();
                  setSelected(selected === fact.id ? null : fact.id);
                }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[9px] font-semibold text-primary">
                    {fact.id}
                  </span>
                  <span className="flex-1 text-[11px] font-medium">
                    {fact.title}
                  </span>
                </div>
                <p className="mt-2 text-base font-semibold tabular-nums tracking-tight">
                  {fact.display}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {fact.period} · 조건 {fact.comparison}
                </p>
              </summary>
              <div className="space-y-2 border-t px-3 py-3 text-[11px] leading-5">
                <p>{fact.meaning}</p>
                <p className="text-muted-foreground">{fact.check}</p>
                <p className="text-[10px] text-muted-foreground">
                  출처 표기: {fact.source} · 선정 당시 저장값
                </p>
                <a
                  href={fact.url ?? packet.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary"
                >
                  {fact.url ? 'DART 접수 원문' : 'Radar 저장 근거 보기'}
                  <ExternalLink className="size-3" />
                </a>
              </div>
            </details>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-muted/40 p-3">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold">
          <AlertTriangle className="size-3.5" />
          반대 근거·미확인 자료
        </h3>
        {[...packet.contradictions, ...packet.missing].map((text, index) => (
          <p
            key={index}
            className="mt-2 text-[11px] leading-5 text-muted-foreground"
          >
            {text}
          </p>
        ))}
        {!packet.contradictions.length && (
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            기록된 반대 근거가 없습니다. 위험이 없다는 뜻은 아닙니다.
          </p>
        )}
        {packet.warnings.map((text, index) => (
          <p key={index} className="mt-2 text-[10px] leading-5 text-amber-800">
            {text}
          </p>
        ))}
      </section>
    </div>
  );
}
