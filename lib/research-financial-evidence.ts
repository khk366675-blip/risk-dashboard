import type { FinancialMetric } from './stock-research';
import type { EvidenceRelation } from './research-evidence';

export const financialEvidenceStatusLabels: Record<string, string> = {
  ok: '출처 확인',
  partial: '일부 자료만 확인',
  stale: '이전 수집 자료',
  missing: '자료 없음',
  error: '수집 오류',
};

export function financialEvidenceStatusLabel(value: unknown) {
  return typeof value === 'string'
    ? (financialEvidenceStatusLabels[value] ?? '출처 상태 미확인')
    : '출처 상태 미확인';
}

export type FinancialEvidence = {
  id: string;
  code: string;
  thesis_id: string;
  thesis_revision: number;
  relation: EvidenceRelation;
  note: string;
  metric: FinancialMetric;
  metric_label: string;
  unit: string;
  year: number;
  quarter: string;
  value: number | null;
  raw_value: number | null;
  statement_basis: string | null;
  receipt_no: string | null;
  source_run_id: string;
  source_collected_at: string;
  source_status: Record<string, unknown>;
  snapshot_hash: string;
  created_at: string;
  archived_at: string | null;
};
