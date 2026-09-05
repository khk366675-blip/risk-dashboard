'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

type Confirmation = {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
};

export function useActionConfirmation() {
  const [prompt, setPrompt] = useState<Confirmation | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmAction = useCallback((value: Confirmation): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setPrompt(value);
    });
  }, []);
  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setPrompt(null);
    resolve?.(accepted);
  }, []);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  const confirmationDialog = (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) finish(false);
      }}
    >
      <DialogContent initialFocus={cancelRef}>
        <DialogHeader>
          <DialogTitle>{prompt?.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line leading-6">
            {prompt?.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={() => finish(false)}
          >
            취소
          </Button>
          <Button
            variant={prompt?.destructive ? 'destructive' : 'default'}
            onClick={() => finish(true)}
          >
            {prompt?.actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { confirmAction, confirmationDialog };
}
