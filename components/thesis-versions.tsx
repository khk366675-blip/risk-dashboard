'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InvestmentThesis, ThesisContent } from '@/lib/investment-thesis';
export function ThesisVersions({
  item,
  onRestore,
}: {
  item: InvestmentThesis;
  onRestore: (content: ThesisContent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<
    { revision: number; saved_at: string; content: ThesisContent }[]
  >([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const load = async () => {
    setOpen(true);
    setError('');
    try {
      const response = await fetch(
        `/api/watchlist/${item.code}/theses/${item.id}/versions`,
        { cache: 'no-store' },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setVersions(data.versions);
      setSelected(0);
    } catch {
      setError('수정 기록을 읽지 못했습니다.');
    }
  };
  const prior = versions[selected];
  return (
    <>
      <Button size="sm" variant="ghost" onClick={load}>
        버전 {item.revision}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>투자포인트 수정 기록</DialogTitle>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <select
            className="rounded-lg border p-2 text-sm"
            aria-label="수정 버전 선택"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {versions.map((v, i) => (
              <option key={v.revision} value={i}>
                버전 {v.revision} ·{' '}
                {new Date(v.saved_at).toLocaleString('ko-KR')}
              </option>
            ))}
          </select>
          {prior && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  {
                    label: `선택한 버전 ${prior.revision}`,
                    content: prior.content,
                  },
                  {
                    label: `현재 저장본 ${item.revision}`,
                    content: item.content,
                  },
                ].map((v) => (
                  <section
                    key={v.label}
                    className="rounded-xl border p-4 text-sm leading-7"
                  >
                    <h3 className="font-semibold">{v.label}</h3>
                    <h4>{v.content.title}</h4>
                    <p className="whitespace-pre-wrap">{v.content.body}</p>
                    {v.content.timing && <p>확인 시기: {v.content.timing}</p>}
                    {v.content.weakens && <p>약화 조건: {v.content.weakens}</p>}
                    <ul className="mt-3 space-y-2">
                      {v.content.checks.map((c) => (
                        <li key={c.id}>
                          <p>{c.text}</p>
                          {c.answer && (
                            <p className="whitespace-pre-wrap text-muted-foreground">
                              답변: {c.answer}
                            </p>
                          )}
                          {c.unresolved && (
                            <p className="whitespace-pre-wrap text-muted-foreground">
                              남은 질문: {c.unresolved}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <Button
                disabled={item.archived || prior.revision === item.revision}
                onClick={() => {
                  onRestore(structuredClone(prior.content));
                  setOpen(false);
                }}
              >
                이 버전을 편집기에 불러오기
              </Button>
              <p className="text-xs text-muted-foreground">
                편집기에서 저장하면 새 버전으로 남습니다.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
