import radarRunJson from '@/public/data/radar/latest.json';

export type Lens = 'quality' | 'improvement' | 'dislocation' | 'event';

export type RadarEvidence = {
  key: string;
  label: string;
  value: number | string | null;
  comparison: string;
  period: string;
  source: string;
};

export type LensResult = {
  lens: Lens;
  label: string;
  matched: boolean;
  qualified?: boolean;
  band: 'strong' | 'review';
  evidence_count: number;
  evidence_ratio_pct: number;
  coverage_pct: number;
  evidence: RadarEvidence[];
  contradictions: string[];
};

export type RadarCandidate = {
  discovery?: 'radar' | 'manual';
  code: string;
  name: string;
  market: string;
  sector: string;
  market_cap_krw: number | null;
  primary_lens: Lens;
  matched_lenses: Lens[];
  lenses: Record<Lens, LensResult>;
  plot: {
    evidence_density_pct: number;
    coverage_pct: number;
  };
  contradictions: string[];
  warnings: string[];
  as_of: string;
  latest_price_date: string | null;
  freshness: 'latest' | 'stale';
};

export type RadarRun = {
  schema_version: string;
  rule_version: string;
  run_id: string;
  generated_at: string;
  source_generated_at?: string;
  as_of: string;
  status: 'ok' | 'partial' | 'error';
  scope_label: string;
  summary: {
    listing_universe_count: number;
    financial_universe_count: number;
    evaluated_universe_count?: number;
    financial_coverage_count?: number;
    price_target_count?: number;
    fresh_price_count?: number;
    standard_eligible_count: number;
    event_eligible_count: number;
    candidate_unique_count: number;
    lens_counts: Record<Lens, number>;
  };
  diagnostics: {
    standard_rejections: Record<string, number>;
    event_rejections: Record<string, number>;
    valuation_cutoffs_universe_fallback: Record<string, number | null>;
    median_return_6m_pct: number | null;
    qualified_lens_counts_before_focus_limit?: Record<Lens, number>;
    focus_limit_per_lens?: Record<Lens, number | null>;
  };
  source_status: Record<string, {
    status: string;
    record_count?: number;
    warning_count?: number;
    generated_at?: string;
    path_redacted?: string;
    target_count?: number;
    fresh_count?: number;
    covered_count?: number;
    coverage_pct?: number;
    market_as_of?: string;
    through?: string;
  }>;
  warnings: string[];
  candidates: RadarCandidate[];
};

export const radarRun = radarRunJson as RadarRun;

export const lenses: Array<{
  key: Lens;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
}> = [
  { key: 'quality', label: 'Quality', shortLabel: 'Q', description: '현금창출·이익 지속성·재무 회복력', color: '#2f6fed' },
  { key: 'improvement', label: 'Improvement', shortLabel: 'I', description: '매출·이익·마진의 방향 변화', color: '#8b5cf6' },
  { key: 'dislocation', label: 'Dislocation', shortLabel: 'D', description: '가격과 사업 근거 사이의 괴리', color: '#0f9f75' },
  { key: 'event', label: 'Event', shortLabel: 'E', description: '공시로 확인된 중요한 변화', color: '#d97706' },
];

export const lensColor: Record<Lens, string> = Object.fromEntries(
  lenses.map((lens) => [lens.key, lens.color]),
) as Record<Lens, string>;

export const lensLabel: Record<Lens, string> = Object.fromEntries(
  lenses.map((lens) => [lens.key, lens.label]),
) as Record<Lens, string>;

export function lensForDisplay(candidate: RadarCandidate, selectedLens: Lens | 'all'): Lens {
  return selectedLens === 'all' ? candidate.primary_lens : selectedLens;
}

export function formatMarketCap(value: number | null): string {
  if (value === null) return '시총 미수집';
  const trillion = value / 1_000_000_000_000;
  if (trillion >= 1) return `${trillion.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조`;
  return `${Math.round(value / 100_000_000).toLocaleString('ko-KR')}억`;
}
