'use client';

import { useState } from 'react';
import { Link2, NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InvestmentThesis } from '@/lib/investment-thesis';
import {
  evidenceRelations,
  researchEvidenceConfig,
  type EvidenceRelation,
} from '@/lib/research-evidence';
import {
  manualEvidenceTypes,
  type ManualEvidence,
  type ManualEvidenceType,
} from '@/lib/research-manual-evidence';

type Draft = {
  source_type: ManualEvidenceType;
  title: string;
  url: string;
  source_name: string;
  published_at: string;
  body: string;
  relation: EvidenceRelation;
  note: string;
};

const emptyDraft: Draft = {
  source_type: 'news',
  title: '',
  url: '',
  source_name: '',
  published_at: '',
  body: '',
  relation: 'context',
  note: '',
};

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || '자료를 저장하지 못했습니다.');
  return body;
}

export function ManualEvidenceDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: InvestmentThesis;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: ManualEvidence) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setDraft(emptyDraft);
    setError(null);
    onOpenChange(false);
  };
  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prior) => ({ ...prior, [key]: value }));
    setError(null);
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = await responseJson(
        await fetch(`/api/watchlist/${item.code}/manual-evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            thesis_id: item.id,
            thesis_revision: item.revision,
            ...draft,
          }),
        }),
      );
      onSaved(body.item as ManualEvidence);
      close();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          if (next) onOpenChange(true);
          else close();
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-w-xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="size-4 text-primary" />
            외부 자료·메모 직접 추가
          </DialogTitle>
          <DialogDescription>
            뉴스, 리포트, IR 자료 또는 내 메모를 현재 투자포인트 버전에
            연결합니다. 링크 본문은 자동 수집하거나 검증하지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">자료 종류</span>
              <select
                aria-label="직접 추가 자료 종류"
                value={draft.source_type}
                onChange={(event) =>
                  patch('source_type', event.target.value as ManualEvidenceType)
                }
                className="h-9 w-full rounded-md border bg-background px-2"
              >
                {Object.entries(manualEvidenceTypes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">발행일 · 선택</span>
              <Input
                aria-label="자료 발행일"
                type="date"
                value={draft.published_at}
                onChange={(event) => patch('published_at', event.target.value)}
              />
            </div>
          </div>
          <div className="block space-y-1.5 text-xs">
            <span className="font-medium">자료 제목</span>
            <Input
              aria-label="직접 추가 자료 제목"
              value={draft.title}
              maxLength={researchEvidenceConfig.max_manual_title_chars}
              onChange={(event) => patch('title', event.target.value)}
              placeholder="기사·리포트 제목 또는 메모 제목"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">링크 · 선택</span>
              <Input
                aria-label="직접 추가 자료 링크"
                type="url"
                value={draft.url}
                maxLength={researchEvidenceConfig.max_manual_url_chars}
                onChange={(event) => patch('url', event.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">출처·작성자 · 선택</span>
              <Input
                aria-label="직접 추가 자료 출처"
                value={draft.source_name}
                maxLength={researchEvidenceConfig.max_manual_source_chars}
                onChange={(event) => patch('source_name', event.target.value)}
                placeholder="매체, 증권사, 기관, 작성자"
              />
            </div>
          </div>
          <div className="block space-y-1.5 text-xs">
            <span className="font-medium">
              핵심 내용·인용 메모{' '}
              <span className="font-normal text-muted-foreground">· 선택</span>
            </span>
            <Textarea
              aria-label="직접 추가 자료 핵심 내용"
              value={draft.body}
              maxLength={researchEvidenceConfig.max_manual_body_chars}
              onChange={(event) => patch('body', event.target.value)}
              rows={6}
              className="resize-y"
              placeholder="자료에서 확인한 내용과 수치, 인용할 문장, 내 관찰을 직접 적어두세요. 링크가 없다면 내용을 입력해야 합니다."
            />
            <span className="block text-right text-[10px] text-muted-foreground">
              {draft.body.length.toLocaleString()}/
              {researchEvidenceConfig.max_manual_body_chars.toLocaleString()}자
            </span>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">이 자료를 보는 관점</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(evidenceRelations).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={draft.relation === value ? 'default' : 'outline'}
                  onClick={() => patch('relation', value as EvidenceRelation)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="block space-y-1.5 text-xs">
            <span className="font-medium">판단 메모 · 선택</span>
            <Textarea
              aria-label="직접 추가 자료 판단 메모"
              value={draft.note}
              maxLength={researchEvidenceConfig.max_note_chars}
              onChange={(event) => patch('note', event.target.value)}
              placeholder="왜 이 관계로 분류했는지, 다음에 무엇을 확인할지"
            />
          </div>
          <p className="rounded-lg bg-muted/50 p-2.5 text-[10px] leading-5 text-muted-foreground">
            제목은 필수이며 링크 또는 핵심 내용 중 하나가 필요합니다. 저장 시
            현재 투자포인트 버전과 입력 원문을 함께 고정합니다.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={close}
          >
            취소
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              !draft.title.trim() ||
              (!draft.url.trim() && !draft.body.trim())
            }
            onClick={() => void save()}
          >
            <Link2 />
            {busy ? '저장 중…' : '현재 투자포인트에 연결'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
