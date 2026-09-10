'use client';

import { useRef, useState } from 'react';
import { Link2, NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { emptyMemo, RichMemoEditor } from '@/components/rich-memo-editor';
import {
  memoPlainText,
  parseRichMemo,
  richMemoConfig,
  type RichMemo,
} from '@/lib/rich-memo';
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
  const [document, setDocument] = useState<RichMemo>(emptyMemo);
  const [imageBusy, setImageBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [wide, setWide] = useState(false);
  const requestIdentity = useRef<{ payload: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setDraft(emptyDraft);
    setDocument(emptyMemo());
    setConfirmDiscard(false);
    setWide(false);
    requestIdentity.current = null;
    setError(null);
    onOpenChange(false);
  };
  const requestClose = () => {
    if (busy || imageBusy) return;
    if (
      draft.title.trim() ||
      draft.url.trim() ||
      draft.note.trim() ||
      memoPlainText(document)
    )
      setConfirmDiscard(true);
    else close();
  };
  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prior) => ({ ...prior, [key]: value }));
    setError(null);
  };
  const save = async () => {
    if (busy || imageBusy) return;
    setBusy(true);
    setError(null);
    try {
      const validatedDocument = memoPlainText(document)
        ? parseRichMemo(document)
        : null;
      const payload = {
        thesis_id: item.id,
        thesis_revision: item.revision,
        ...draft,
        body: memoPlainText(document),
        document: validatedDocument,
      };
      const signature = JSON.stringify(payload);
      if (requestIdentity.current?.payload !== signature)
        requestIdentity.current = {
          payload: signature,
          id: crypto.randomUUID(),
        };
      const body = await responseJson(
        await fetch(`/api/watchlist/${item.code}/manual-evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            id: requestIdentity.current.id,
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
        if (!busy && !imageBusy) {
          if (next) onOpenChange(true);
          else requestClose();
        }
      }}
    >
      <DialogContent
        className="h-[min(900px,calc(100dvh-1.5rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-3xl"
        showCloseButton={!busy && !imageBusy}
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
        <fieldset
          disabled={busy || imageBusy}
          className="min-h-0 min-w-0 space-y-4 overflow-y-auto px-1"
        >
          <div className={wide ? 'hidden' : 'grid gap-3 sm:grid-cols-2'}>
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
          <div className={wide ? 'hidden' : 'grid gap-3 sm:grid-cols-2'}>
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
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                핵심 내용·인용 메모{' '}
                <span className="font-normal text-muted-foreground">
                  · 선택
                </span>
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setWide(!wide)}
              >
                {wide ? '자료 정보 함께 보기' : '넓게 쓰기'}
              </Button>
            </div>
            <RichMemoEditor
              value={document}
              onChange={setDocument}
              disabled={busy}
              expanded={wide}
              onBusyChange={setImageBusy}
            />
          </div>
          <fieldset className={wide ? 'hidden' : 'space-y-2'}>
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
          <div className={wide ? 'hidden' : 'block space-y-1.5 text-xs'}>
            <span className="font-medium">판단 메모 · 선택</span>
            <Textarea
              aria-label="직접 추가 자료 판단 메모"
              value={draft.note}
              maxLength={researchEvidenceConfig.max_note_chars}
              onChange={(event) => patch('note', event.target.value)}
              placeholder="왜 이 관계로 분류했는지, 다음에 무엇을 확인할지"
            />
          </div>
          <p
            className={
              wide
                ? 'hidden'
                : 'rounded-lg bg-muted/50 p-2.5 text-[10px] leading-5 text-muted-foreground'
            }
          >
            제목은 필수이며 링크 또는 핵심 내용 중 하나가 필요합니다. 저장 시
            현재 투자포인트 버전과 입력 원문을 함께 고정합니다.
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </fieldset>
        <DialogFooter>
          {confirmDiscard ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs">저장하지 않은 내용을 버릴까요?</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDiscard(false)}
              >
                계속 작성
              </Button>
              <Button type="button" variant="destructive" onClick={close}>
                버리고 닫기
              </Button>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy || imageBusy}
                onClick={requestClose}
              >
                취소
              </Button>
              <Button
                type="button"
                disabled={
                  busy ||
                  imageBusy ||
                  memoPlainText(document).length >
                    richMemoConfig.max_text_chars ||
                  !draft.title.trim() ||
                  (!draft.url.trim() && !memoPlainText(document))
                }
                onClick={() => void save()}
              >
                <Link2 />
                {busy ? '저장 중…' : '현재 투자포인트에 연결'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
