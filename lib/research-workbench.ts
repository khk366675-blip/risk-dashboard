import type { FollowupItem } from './research-followup';
import type { InvestmentThesis } from './investment-thesis';
import type { EvidenceRelation } from './research-evidence';
import type { ManualEvidenceType } from './research-manual-evidence';

export const thesisReviewStates = {
  open: '검증 중',
  strengthened: '강화됨',
  weakened: '약화됨',
  on_hold: '판단 보류',
} as const;

export type ThesisReviewState = keyof typeof thesisReviewStates;
export type UpdateState = 'open' | 'reviewed';
export type UpdateKind =
  | 'filing'
  | 'financial'
  | 'document'
  | 'source_issue'
  | 'first_review';

export const updateKindLabels: Record<UpdateKind, string> = {
  filing: '새 공시',
  financial: '재무 변화',
  document: '원문 저장',
  source_issue: '자료 상태',
  first_review: '첫 확인',
};

export type ResearchUpdateItem = {
  key: string;
  code: string;
  name: string;
  kind: UpdateKind;
  priority: 'attention' | 'standard' | 'info';
  title: string;
  summary: string;
  occurred_at: string | null;
  href: string;
  source_name: string;
  source_id: string | null;
  source_status: string;
  warning: string | null;
  state: UpdateState;
  note: string;
  reviewed_at: string | null;
};

export type ThesisEvidenceCounts = Record<EvidenceRelation, number> & {
  total: number;
  documents: number;
  financials: number;
  manual: number;
  manual_types: Partial<Record<ManualEvidenceType, number>>;
  latest_at: string | null;
};

export type ThesisStatusRecord = {
  state: ThesisReviewState;
  note: string;
  reviewed_at: string | null;
  updated_at: string | null;
};

export type WorkbenchThesis = InvestmentThesis & {
  review: ThesisStatusRecord;
  evidence: ThesisEvidenceCounts;
  ai: {
    state: 'pending' | 'completed' | 'error' | 'interrupted' | null;
    created_at: string | null;
    thesis_revision: number | null;
    evidence_signature: string | null;
  };
};

export type SourceLauncher = {
  key: string;
  label: string;
  description: string;
  url: string;
  state: 'manual_search';
};

export type WorkbenchStock = {
  code: string;
  name: string;
  followup: FollowupItem;
  theses: WorkbenchThesis[];
  source_launchers: SourceLauncher[];
};

export type ResearchWorkbench = {
  generated_at: string;
  stocks: WorkbenchStock[];
  updates: ResearchUpdateItem[];
  summary: {
    stock_count: number;
    open_update_count: number;
    attention_count: number;
    thesis_count: number;
    thesis_states: Record<ThesisReviewState, number>;
    evidence_count: number;
    ai_ready_count: number;
  };
  warnings: string[];
};
