'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ThesisEvidenceReviewPanel } from '@/components/thesis-evidence-review-panel';
import { ManualEvidenceDialog } from '@/components/manual-evidence-dialog';
import {
  thesisConfig,
  type InvestmentThesis,
  type ThesisCheck,
} from '@/lib/investment-thesis';
import type { ThesisEvidenceReviewItem } from '@/lib/thesis-evidence-ai';

export function ThesisCheckReview({
  check,
  onChange,
  thesis,
  dirty,
  expanded = false,
  onRequestEvidence,
}: {
  check: ThesisCheck;
  onChange: (check: ThesisCheck) => void;
  thesis: InvestmentThesis | null;
  dirty: boolean;
  expanded?: boolean;
  onRequestEvidence?: () => void;
}) {
  const [open, setOpen] = useState(expanded);
  const [aiOpen, setAiOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<ThesisEvidenceReviewItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !thesis) return;
    const abort = new AbortController();
    fetch(`/api/watchlist/${thesis.code}/theses/${thesis.id}/materials`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        return body;
      })
      .then((body) => {
        setItems(body.items);
        setError('');
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoaded(true);
      });
    return () => abort.abort();
  }, [open, thesis, refresh]);
  const missing = (check.evidence_ids ?? []).filter(
    (id) => !items.some((item) => item.id === id),
  );
  return (
    <>
      <details
        className="mt-2 rounded-lg border bg-muted/15 p-3"
        open={expanded || undefined}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className={expanded ? 'hidden' : 'cursor-pointer text-xs'}>
          {check.status === 'answered'
            ? '답변 기록됨'
            : check.status === 'reviewing'
              ? '확인 중'
              : '답변 · 자료 연결'}
          {check.evidence_ids?.length
            ? ` · 자료 ${check.evidence_ids.length}개`
            : ''}
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block space-y-1 text-xs">
            내 확인 상태
            <select
              className="ml-2 rounded border bg-background p-1"
              value={check.status ?? 'open'}
              onChange={(e) =>
                onChange({
                  ...check,
                  status: e.target.value as ThesisCheck['status'],
                })
              }
            >
              <option value="open">미확인</option>
              <option value="reviewing">확인 중</option>
              <option value="answered">답변 기록됨</option>
            </select>
          </label>
          <label
            htmlFor={`answer-${check.id}`}
            className="block space-y-1 text-xs"
          >
            내 답변
            <Textarea
              id={`answer-${check.id}`}
              value={check.answer ?? ''}
              maxLength={thesisConfig.max_check_answer_chars}
              placeholder="자료에서 확인한 내용과 현재 해석"
              onChange={(e) => onChange({ ...check, answer: e.target.value })}
            />
          </label>
          <label
            htmlFor={`unresolved-${check.id}`}
            className="block space-y-1 text-xs"
          >
            남은 확인 사항
            <Textarea
              id={`unresolved-${check.id}`}
              value={check.unresolved ?? ''}
              maxLength={thesisConfig.max_check_answer_chars}
              placeholder="아직 모르는 부분이나 다음에 확인할 것"
              onChange={(e) =>
                onChange({ ...check, unresolved: e.target.value })
              }
            />
          </label>
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">답변의 근거 자료</p>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!thesis || dirty}
                  onClick={() => setManualOpen(true)}
                >
                  링크·메모 추가
                </Button>
                {onRequestEvidence && (
                  <Button size="xs" variant="ghost" onClick={onRequestEvidence}>
                    전체 자료
                  </Button>
                )}
              </div>
            </div>
            {error && <p role="alert">{error}</p>}
            {!thesis && (
              <p className="text-muted-foreground">
                투자포인트 저장 후 자료를 연결할 수 있습니다.
              </p>
            )}
            {thesis && !loaded && !error && (
              <p className="text-muted-foreground">연결 자료 불러오는 중…</p>
            )}
            {thesis && loaded && !items.length && !error && (
              <p className="text-muted-foreground">
                연결 자료에서 공시·재무·외부 자료를 먼저 등록하세요.
              </p>
            )}
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border bg-background p-2"
                >
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={check.evidence_ids?.includes(item.id) ?? false}
                      onChange={(e) =>
                        onChange({
                          ...check,
                          evidence_ids: e.target.checked
                            ? [...(check.evidence_ids ?? []), item.id]
                            : (check.evidence_ids ?? []).filter(
                                (id) => id !== item.id,
                              ),
                        })
                      }
                    />
                    <span>
                      {item.label}
                      <span className="block text-muted-foreground">
                        {item.period ?? '대상 기간 미확인'} ·{' '}
                        {item.relation === 'supports'
                          ? '뒷받침'
                          : item.relation === 'challenges'
                            ? '약화'
                            : '미확인'}
                        {item.kind === 'manual'
                          ? ' · 사용자 입력·미검증'
                          : !['ok', 'stored_snapshot'].includes(
                                item.source_status,
                              )
                            ? ' · 출처 상태 확인 필요'
                            : ''}
                      </span>
                    </span>
                  </label>
                  <details className="ml-5 mt-1 text-muted-foreground">
                    <summary className="cursor-pointer">저장 내용 보기</summary>
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-5">
                      {item.excerpt || '저장된 발췌 없음'}
                    </p>
                    {item.excerpt_truncated && (
                      <p className="mt-1">
                        일부 발췌 · 전체 자료에서 원문 확인
                      </p>
                    )}
                  </details>
                </div>
              ))}
            </div>
            {missing.length > 0 && loaded && !error && (
              <p className="text-amber-800">
                이전에 연결한 자료 {missing.length}개가 해제되어 이번 AI
                입력에서는 제외됩니다.
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={dirty || !thesis || !check.evidence_ids?.length}
            onClick={() => setAiOpen(true)}
          >
            이 질문만 AI 검토
          </Button>
          {dirty && (
            <p className="text-xs text-muted-foreground">
              먼저 저장하면 새 자료 추가와 AI 검토를 할 수 있습니다.
            </p>
          )}
        </div>
      </details>
      {thesis && (
        <ManualEvidenceDialog
          item={thesis}
          open={manualOpen}
          onOpenChange={setManualOpen}
          onSaved={(item) => {
            onChange({
              ...check,
              evidence_ids: [
                ...new Set([
                  ...(check.evidence_ids ?? []),
                  `manual:${item.id}`,
                ]),
              ],
            });
            setRefresh((value) => value + 1);
          }}
        />
      )}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="flex h-[85dvh] max-h-[900px] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>질문과 선택 자료 검토</DialogTitle>
            <DialogDescription>
              전송 범위를 확인한 뒤 직접 실행합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <ThesisEvidenceReviewPanel
              code={thesis?.code ?? ''}
              thesis={thesis}
              checkId={check.id}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
