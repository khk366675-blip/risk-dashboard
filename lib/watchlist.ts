import type { StockDetail } from './stock-detail';
export type ResearchState =
  | 'queued'
  | 'running'
  | 'ready'
  | 'partial'
  | 'error';
export type WatchlistItem = {
  code: string;
  name: string;
  added_at: string;
  active: boolean;
  job: {
    job_id: string;
    state: ResearchState;
    step: string;
    error: string | null;
    updated_at: string;
  } | null;
};
export type ResearchRecord = { item: WatchlistItem; stock: StockDetail };
export const researchStateLabel: Record<ResearchState, string> = {
  queued: '수집 대기',
  running: '자료 보강 중',
  ready: '자료 확인 가능',
  partial: '일부 자료 확인 필요',
  error: '수집 재시도 필요',
};
