import type { EvidenceRelation } from './research-evidence';
import type { RichMemo } from './rich-memo';

export const manualEvidenceTypes = {
  news: '뉴스',
  broker_report: '증권사·리서치 리포트',
  ir: '기업 IR·발표 자료',
  industry: '산업·시장 자료',
  academic: '논문·전문 자료',
  memo: '내 메모',
  other: '기타 자료',
} as const;

export type ManualEvidenceType = keyof typeof manualEvidenceTypes;

export type ManualEvidence = {
  id: string;
  code: string;
  thesis_id: string;
  thesis_revision: number;
  relation: EvidenceRelation;
  source_type: ManualEvidenceType;
  title: string;
  url: string | null;
  source_name: string;
  published_at: string | null;
  body: string;
  document?: RichMemo | null;
  note: string;
  source_status: 'user_supplied';
  snapshot_hash: string;
  created_at: string;
  archived_at: string | null;
};
