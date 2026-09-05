'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useDiscardConfirmation } from '@/components/use-discard-confirmation';
import {
  questionKinds,
  sourceKinds,
  thesisAiConfig,
  type ThesisAiView,
  type ThesisAiRun,
} from '@/lib/thesis-ai';
import { thesisConfig, type InvestmentThesis } from '@/lib/investment-thesis';

async function json(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || 'AI 요청을 처리하지 못했습니다.');
  return body;
}
export function ThesisAiPanel({
  code,
  item,
  dirty,
  onAdopt,
  onDraftDirty,
}: {
  code: string;
  item: InvestmentThesis | null;
  dirty: boolean;
  onAdopt: (item: InvestmentThesis) => void;
  onDraftDirty: (dirty: boolean) => void;
}) {
  const [view, setView] = useState<ThesisAiView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [choices, setChoices] = useState<
    { suggestion_index: number; text: string; selected: boolean }[]
  >([]);
  const requestId = useRef<{ signature: string; id: string } | null>(null);
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  const base = item
    ? `/api/watchlist/${code}/theses/${item.id}/analysis`
    : null;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!base) return null;
      const result = (await json(
        await fetch(base, { cache: 'no-store', signal }),
      )) as ThesisAiView;
      if (!signal?.aborted) setView(result);
      return result;
    },
    [base],
  );
  useEffect(() => {
    const abort = new AbortController();
    if (!base) return;
    void fetch(base, { cache: 'no-store', signal: abort.signal })
      .then(json)
      .then((result) => {
        if (!abort.signal.aborted) {
          setView(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError('AI 설정·저장 결과를 읽지 못했습니다. 다시 확인해 주세요.');
      });
    return () => abort.abort();
  }, [base, item?.revision]);
  useEffect(() => {
    if (view?.run?.state !== 'pending' || busy) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void load(abort.signal).catch(() => {
        if (!abort.signal.aborted)
          setError(
            '요청 상태를 읽지 못했습니다. 새 요청을 보내지 않고 상태를 다시 확인해 주세요.',
          );
      });
    }, thesisAiConfig.poll_interval_ms);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [view, busy, load]);
  const staged =
    selectionOpen &&
    choices.some(
      (c) =>
        c.selected ||
        c.text !== view?.run?.answer?.suggestions[c.suggestion_index]?.question,
    );
  useEffect(() => {
    onDraftDirty(staged || busy);
    return () => onDraftDirty(false);
  }, [staged, busy, onDraftDirty]);
  if (!item)
    return (
      <p className="text-xs leading-6 text-muted-foreground">
        투자포인트 탭에서 저장한 포인트를 선택해 주세요. AI가 다른 글을 임의로
        골라 읽지 않습니다.
      </p>
    );
  const run = view?.run;
  const stale = Boolean(
    run &&
    (run.thesis_revision !== item.revision || view?.revision !== item.revision),
  );
  const request = async () => {
    if (!view || !base || !consent || busy || dirty) return;
    setBusy(true);
    setError(null);
    if (requestId.current?.signature !== view.signature)
      requestId.current = {
        signature: view.signature,
        id: crypto.randomUUID(),
      };
    try {
      const response = await json(
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
      );
      const result = response.run as ThesisAiRun;
      setView({ ...view, run: result });
      setConsentOpen(false);
      setConsent(false);
      // A failed request can only be retried by another explicit, consented click.
      if (result.state === 'error' || result.state === 'interrupted')
        requestId.current = null;
    } catch (e) {
      setError(
        (e as Error).message,
      ); /* Keep request ID after ambiguous network failure. */
    } finally {
      setBusy(false);
    }
  };
  const closeSelection = async () => {
    if (busy) return;
    if (
      staged &&
      !(await confirmDiscard('선택·수정한 질문을 저장하지 않고 닫을까요?'))
    )
      return;
    setSelectionOpen(false);
  };
  const adopt = async () => {
    if (!run || !base || busy || dirty || stale) return;
    setBusy(true);
    setError(null);
    try {
      const result = await json(
        await fetch(`${base}/${run.id}/adopt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: item.revision,
            questions: choices
              .filter((c) => c.selected)
              .map(({ suggestion_index, text }) => ({
                suggestion_index,
                text,
              })),
          }),
        }),
      );
      setSelectionOpen(false);
      onAdopt(result.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {discardDialog}
      <div>
        <p className="text-[10px] font-medium text-primary">
          내 가설 → 확인할 질문
        </p>
        <h3 className="mt-2 text-sm font-semibold">AI 질문 제안</h3>
        <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
          선택한 글의 성립 조건·반증·필요한 자료를 제안합니다. 기업 사실
          확인이나 공시 본문 분석은 아닙니다.
        </p>
      </div>
      {dirty && (
        <p className="rounded-lg bg-muted p-3 text-[11px]">
          작성 중인 투자포인트를 먼저 저장해 주세요. AI는 저장본만 읽습니다.
        </p>
      )}
      {view && !view.configured && (
        <p className="rounded-lg border p-3 text-[11px] leading-5">
          OpenAI API 키 미설정 · .env.local에 OPENAI_API_KEY를 설정한 후 서버를
          재시작해 주세요. 키는 화면·채팅에 입력하지 않습니다.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={
            !view ||
            !view.configured ||
            dirty ||
            item.archived ||
            busy ||
            run?.state === 'pending'
          }
          onClick={async () => {
            setError(null);
            try {
              const latest = await load();
              if (latest) {
                setConsent(false);
                setConsentOpen(true);
              }
            } catch {
              setError('전송할 저장본을 다시 읽지 못했습니다.');
            }
          }}
        >
          <Sparkles />
          {view && !view.configured ? 'API 연결 후 사용' : '질문 제안 요청'}
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="AI 상태 다시 확인"
          disabled={busy}
          onClick={() => {
            void load()
              .then(() => setError(null))
              .catch(() => setError('AI 상태를 읽지 못했습니다.'));
          }}
        >
          <RefreshCw />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      {run && (
        <>
          <p className="text-[10px] leading-5 text-muted-foreground">
            {run.model} · 저장 버전 {run.thesis_revision}
            <br />
            {new Date(run.created_at).toLocaleString('ko-KR')}
          </p>
          {run.state === 'pending' && (
            <output className="block text-xs leading-6">
              질문을 생성하고 있습니다. 새로고침해도 같은 요청을 다시 전송하지
              않습니다.
            </output>
          )}
          {run.error && (
            <p
              role="alert"
              className="rounded-lg border p-3 text-[11px] leading-6 text-destructive"
            >
              {run.error}
            </p>
          )}
          {run.adoption ? (
            <p className="rounded-lg bg-primary/5 p-3 text-[11px] leading-6">
              질문 {run.adoption.checks.length}개를 내 검증 항목에 저장했습니다.
              투자포인트 탭에서 수정할 수 있습니다.
            </p>
          ) : (
            stale && (
              <p className="rounded-lg border p-3 text-[11px] leading-6">
                이전 저장본의 제안입니다. 현재 글이 바뀌어 채택을 막았습니다.
                최신 저장본으로 다시 요청해 주세요.
              </p>
            )
          )}
          {run.answer && (
            <>
              <p className="text-[11px] font-medium">
                {run.answer.status === 'needs_clarification'
                  ? '먼저 가설을 구체화할 질문'
                  : '가설을 확인할 질문'}{' '}
                · {run.answer.suggestions.length}개
              </p>
              {run.answer.suggestions.map((s, index) => (
                <section
                  key={index}
                  className="space-y-2 rounded-xl border p-3"
                >
                  <p className="text-[10px] font-medium text-primary">
                    {questionKinds[s.kind]}
                  </p>
                  <h4 className="text-xs font-semibold leading-6">
                    {s.question}
                  </h4>
                  <blockquote className="border-l-2 pl-2 text-[10px] leading-5 text-muted-foreground">
                    내 글에서: “{s.anchor_quote}”
                  </blockquote>
                  <p className="text-[11px] leading-6">{s.why}</p>
                  <details className="text-[11px] leading-6">
                    <summary className="cursor-pointer font-medium">
                      필요한 자료·약해지는 조건
                    </summary>
                    <p className="mt-2 text-muted-foreground">
                      필요한 자료 · {sourceKinds[s.source_kind]}
                    </p>
                    <p>{s.look_for}</p>
                    <p className="mt-2 text-muted-foreground">
                      이런 관측이라면 재검토
                    </p>
                    <p>{s.weakening_signal}</p>
                  </details>
                </section>
              ))}
              {!run.adoption && (
                <Button
                  className="w-full"
                  size="sm"
                  variant="outline"
                  disabled={dirty || busy || stale || item.archived}
                  onClick={() => {
                    setChoices(
                      run.answer!.suggestions.map((s, i) => ({
                        suggestion_index: i,
                        text: s.question,
                        selected: false,
                      })),
                    );
                    setSelectionOpen(true);
                  }}
                >
                  검증 질문에 추가
                </Button>
              )}
            </>
          )}
          {run.usage && (
            <p className="text-[10px] text-muted-foreground">
              실제 사용량 · 입력 {run.usage.input_tokens ?? '미확인'} / 출력{' '}
              {run.usage.output_tokens ?? '미확인'} 토큰
            </p>
          )}
        </>
      )}
      <p className="border-t pt-3 text-[10px] leading-5 text-muted-foreground">
        제안은 자동 반영되지 않습니다. 채택할 질문만 직접 선택합니다.
      </p>
      <Dialog
        open={consentOpen}
        onOpenChange={(open) => {
          if (!busy) setConsentOpen(open);
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>이 저장본만 AI에 전송</DialogTitle>
            <DialogDescription>
              OpenAI 유료 API · {view?.model}. 아래 글과 기존 질문만 전송합니다.
              다른 포인트·개인 기록·원문 링크·수집 자료는 제외합니다.
            </DialogDescription>
          </DialogHeader>
          {view && (
            <div className="space-y-3 rounded-xl border p-3 text-xs leading-6">
              <p>
                {view.input.company.name} · {view.input.company.code} · 버전{' '}
                {view.revision}
              </p>
              {(['title', 'body', 'timing', 'weakens'] as const).map((key) => (
                <section key={key}>
                  <p className="text-[10px] text-muted-foreground">
                    {
                      {
                        title: '제목',
                        body: '투자포인트',
                        timing: '예상 확인 시기',
                        weakens: '기대가 약해지는 조건',
                      }[key]
                    }
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    {view.input.point[key] || '미작성'}
                  </p>
                </section>
              ))}
              <section>
                <p className="text-[10px] text-muted-foreground">
                  기존 질문 {view.input.existing_questions.length}개
                </p>
                {view.input.existing_questions.map((q, i) => (
                  <p key={i}>{q}</p>
                ))}
              </section>
            </div>
          )}
          <p className="text-[11px] leading-5 text-muted-foreground">
            출력은 질문 제안이며 사실 확인이 아닙니다. 자동 재시도하지 않습니다.
            요청·결과는 내 PC에 보존하며, 공급자의 데이터 보존 정책은 별도로
            적용됩니다.
          </p>
          <label className="flex items-start gap-2 text-xs leading-5">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            선택한 저장본을 OpenAI에 전송하는 데 동의합니다.
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {view && !view.configured && (
            <p className="text-xs text-destructive">
              API 키를 설정한 후 실행할 수 있습니다.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConsentOpen(false)}
            >
              취소
            </Button>
            <Button
              disabled={!consent || !view?.configured || busy || dirty}
              onClick={() => void request()}
            >
              {busy ? '질문 생성 중…' : '동의하고 질문 제안받기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={selectionOpen}
        onOpenChange={(open) => {
          if (!open) void closeSelection();
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>검증할 질문 선택·수정</DialogTitle>
            <DialogDescription>
              선택한 질문을 검증 질문 탭에 저장합니다. 답변과 근거는 그곳에서
              기록할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          {choices.map((choice, index) => (
            <div
              key={choice.suggestion_index}
              className="space-y-2 rounded-xl border p-3"
            >
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={choice.selected}
                  onChange={(e) =>
                    setChoices((prior) =>
                      prior.map((c, i) =>
                        i === index ? { ...c, selected: e.target.checked } : c,
                      ),
                    )
                  }
                />
                질문 {index + 1} 채택
              </label>
              <Textarea
                aria-label={`채택할 질문 ${index + 1}`}
                disabled={busy}
                value={choice.text}
                onChange={(e) =>
                  setChoices((prior) =>
                    prior.map((c, i) =>
                      i === index ? { ...c, text: e.target.value } : c,
                    ),
                  )
                }
              />
              <p className="text-[10px] text-muted-foreground">
                {choice.text.length} / {thesisConfig.max_check_chars}자
              </p>
            </div>
          ))}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void closeSelection()}
            >
              취소
            </Button>
            <Button
              disabled={
                busy ||
                !choices.some((c) => c.selected) ||
                choices.some(
                  (c) =>
                    c.selected &&
                    (!c.text.trim() ||
                      c.text.length > thesisConfig.max_check_chars),
                ) ||
                stale ||
                dirty
              }
              onClick={() => void adopt()}
            >
              {busy
                ? '저장 중…'
                : `선택한 ${choices.filter((c) => c.selected).length}개 질문 저장`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
