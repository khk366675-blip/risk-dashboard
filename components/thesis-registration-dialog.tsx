'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { thesisConfig } from '@/lib/investment-thesis';
import { useDiscardConfirmation } from '@/components/use-discard-confirmation';

export function ThesisRegistrationDialog({
  open,
  onClose,
  onRegister,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onRegister: (reason: string, id: string) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const { confirmDiscard, discardDialog } = useDiscardConfirmation();
  return (
    <>
      {discardDialog}
      <Dialog
        open={open}
        onOpenChange={async (value) => {
          if (
            !value &&
            !busy &&
            (!reason.trim() ||
              (await confirmDiscard('등록 이유를 저장하지 않고 닫을까요?')))
          )
            onClose();
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>관심종목으로 검토하기</DialogTitle>
            <DialogDescription>
              관심을 갖게 된 이유를 적으면 투자포인트로 함께 저장합니다. 지금은
              비워두어도 됩니다. 재등록할 때 적은 이유는 기존 글을 유지하고
              추가합니다.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-xs" htmlFor="registration-reason">
            <span>
              관심을 갖게 된 이유{' '}
              <span className="text-muted-foreground">· 선택</span>
            </span>
            <Textarea
              id="registration-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={5}
              placeholder="이 기업에서 기대하는 변화나 확인하고 싶은 가설"
              disabled={busy}
            />
          </label>
          <p className="text-[10px] text-muted-foreground">
            {reason.length.toLocaleString()} /{' '}
            {thesisConfig.max_body_chars.toLocaleString()}자 · 내 PC에만 저장 ·
            AI 전송 없음
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={async () => {
                if (
                  !reason.trim() ||
                  (await confirmDiscard('등록 이유를 저장하지 않고 닫을까요?'))
                )
                  onClose();
              }}
            >
              취소
            </Button>
            <Button
              disabled={busy || reason.length > thesisConfig.max_body_chars}
              onClick={async () => {
                if (await onRegister(reason, requestId)) onClose();
              }}
            >
              {busy ? '저장 중…' : '관심종목 등록'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
