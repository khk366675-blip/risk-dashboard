'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ThesisCheckReview } from '@/components/thesis-check-review';
import {
  thesisConfig,
  type InvestmentThesis,
  type ThesisCheck,
} from '@/lib/investment-thesis';

export function ThesisQuestions({
  checks,
  onChange,
  thesis,
  dirty,
  onRequestEvidence,
  preferredCheckId,
}: {
  checks: ThesisCheck[];
  onChange: (checks: ThesisCheck[]) => void;
  thesis: InvestmentThesis | null;
  dirty: boolean;
  onRequestEvidence: () => void;
  preferredCheckId?: string;
}) {
  const [selectedId, setSelectedId] = useState(
    preferredCheckId ?? checks[0]?.id,
  );
  const selected = checks.find((check) => check.id === selectedId) ?? checks[0];
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3"
      aria-label="검증 질문 작업면"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          직접 쓴 질문과 채택한 AI 질문 · 답변 기록{' '}
          {checks.filter((check) => check.status === 'answered').length}/
          {checks.length}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={checks.length >= thesisConfig.max_checks}
          onClick={() => {
            const check = { id: crypto.randomUUID(), text: '' };
            onChange([...checks, check]);
            setSelectedId(check.id);
          }}
        >
          <Plus />
          질문 추가
        </Button>
      </div>
      {selected && (
        <select
          aria-label="검증 질문 선택"
          className="w-full shrink-0 rounded-lg border bg-background p-2 text-xs @min-[600px]:hidden"
          value={selected.id}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {checks.map((check, index) => (
            <option key={check.id} value={check.id}>
              {index + 1}. {check.text || '새 질문'}
            </option>
          ))}
        </select>
      )}
      {!checks.length && (
        <p className="text-xs text-muted-foreground">
          질문을 직접 추가하거나 AI 질문 제안에서 선택해 가져오세요.
        </p>
      )}
      <div className="grid min-h-0 min-w-0 flex-1 gap-4 @min-[600px]:grid-cols-[minmax(150px,1fr)_minmax(0,2fr)]">
        <div
          className="hidden min-h-0 space-y-1 overflow-y-auto @min-[600px]:block"
          aria-label="검증 질문 목록"
        >
          {checks.map((check, index) => (
            <button
              key={check.id}
              type="button"
              aria-pressed={check.id === selected?.id}
              onClick={() => setSelectedId(check.id)}
              className={`w-full rounded-xl border p-3 text-left text-xs leading-5 ${check.id === selected?.id ? 'border-primary/30 bg-primary/5' : 'border-transparent bg-muted/30'}`}
            >
              <span className="block line-clamp-3">
                {index + 1}. {check.text || '새 질문'}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {check.status === 'answered'
                  ? '답변 기록됨'
                  : check.status === 'reviewing'
                    ? '확인 중'
                    : '미확인'}{' '}
                · 자료 {check.evidence_ids?.length ?? 0}개
              </span>
            </button>
          ))}
        </div>
        {selected && (
          <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto pr-1">
            <div className="flex items-center justify-between">
              <label
                htmlFor={`question-${selected.id}`}
                className="text-sm font-medium"
              >
                검증할 질문
              </label>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="선택한 질문 제거"
                onClick={() =>
                  onChange(checks.filter((check) => check.id !== selected.id))
                }
              >
                <X />
              </Button>
            </div>
            <Textarea
              id={`question-${selected.id}`}
              value={selected.text}
              maxLength={thesisConfig.max_check_chars}
              placeholder="자료에서 확인할 질문"
              className="min-h-20 text-sm leading-6"
              onChange={(e) =>
                onChange(
                  checks.map((check) =>
                    check.id === selected.id
                      ? { ...check, text: e.target.value }
                      : check,
                  ),
                )
              }
            />
            <ThesisCheckReview
              key={selected.id}
              check={selected}
              thesis={thesis}
              dirty={dirty}
              expanded
              onRequestEvidence={onRequestEvidence}
              onChange={(updated) =>
                onChange(
                  checks.map((check) =>
                    check.id === updated.id ? updated : check,
                  ),
                )
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}
