'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function useDiscardConfirmation() {
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const confirmDiscard = useCallback((text: string): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setMessage(text);
    });
  }, []);
  const finish = useCallback((answer: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setMessage(null);
    resolve?.(answer);
  }, []);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  const discardDialog = (
    <Dialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>저장하지 않은 내용이 있습니다</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(false)}>
            계속 작성
          </Button>
          <Button onClick={() => finish(true)}>변경 버리기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { confirmDiscard, discardDialog };
}
