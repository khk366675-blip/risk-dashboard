import type { Metadata } from 'next';
import { ResearchWorkbench } from '@/components/research-workbench';
import { localStore } from '@/lib/server/research-store';
import { ResearchWorkbenchStore } from '@/lib/server/research-workbench-store';
import type { ResearchWorkbench as WorkbenchData } from '@/lib/research-workbench';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '관심종목 검토판 — Value Dashboard',
  description:
    '관심종목의 새 자료, 투자포인트 상태, 연결 근거와 학습 진행을 검토합니다.',
};

const emptyData = (): WorkbenchData => ({
  generated_at: new Date().toISOString(),
  stocks: [],
  updates: [],
  summary: {
    stock_count: 0,
    open_update_count: 0,
    attention_count: 0,
    thesis_count: 0,
    thesis_states: { open: 0, strengthened: 0, weakened: 0, on_hold: 0 },
    evidence_count: 0,
    ai_ready_count: 0,
  },
  warnings: [],
});

export default function WatchlistPage() {
  if (process.env.VERCEL)
    return (
      <ResearchWorkbench
        initialData={emptyData()}
        initialError="관심종목 검토판은 현재 로컬 저장소와 수집기에서 작동합니다."
      />
    );
  try {
    const owner = localStore();
    try {
      return (
        <ResearchWorkbench
          initialData={new ResearchWorkbenchStore(owner.db).snapshot(
            owner.followups(),
          )}
        />
      );
    } finally {
      owner.close();
    }
  } catch {
    return (
      <ResearchWorkbench
        initialData={emptyData()}
        initialError="관심종목 검토판을 읽지 못했습니다. 저장소와 수집 상태를 확인해 주세요."
      />
    );
  }
}
