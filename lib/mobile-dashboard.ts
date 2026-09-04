import type { Lens } from './radar-run';
import type { StockDetail } from './stock-detail';
import type {
  JournalEntry,
  LearningItem,
  ResearchKpi,
} from './research-system';
import type {
  ThesisReviewState,
  ThesisStatusRecord,
} from './research-workbench';

export const mobileSnapshotSchema = 'mobile-dashboard.v2' as const;

export type MobileMarketAsset = {
  key: string;
  label: string;
  group: string;
  unit: string;
  value: number | null;
  change_1d_pct: number | null;
  change_5d_pct?: number | null;
  change_20d_pct: number | null;
  change_60d_pct?: number | null;
  position_252d_pct?: number | null;
  as_of: string | null;
  freshness: string;
  sparkline?: Array<{ date: string; value: number }>;
};

export type MobileMarket = {
  generated_at: string;
  as_of: string;
  status: string;
  summary: {
    global_risk_label?: string;
    korea_label?: string;
    fx_pressure_label?: string;
  };
  breadth: {
    coverage_count?: number;
    advancers_pct?: number | null;
    above_20d_pct?: number | null;
    above_60d_pct?: number | null;
  };
  assets: MobileMarketAsset[];
};

export type MobileEvidenceItem = {
  id: string;
  kind: 'filing' | 'financial' | 'manual';
  relation: 'supports' | 'challenges' | 'context';
  label: string;
  summary: string;
  source: string;
  as_of: string | null;
  url: string | null;
  note: string;
  source_status: string;
};

export type MobileThesis = {
  id: string;
  revision: number;
  title: string;
  body: string;
  timing: string;
  weakens: string;
  checks: string[];
  review: ThesisStatusRecord;
  evidence: MobileEvidenceItem[];
  ai_review?: {
    created_at: string;
    model: string;
    thesis_revision: number;
    questions: Array<{
      kind: 'support' | 'challenge' | 'clarification';
      question: string;
      why: string;
      look_for: string;
      weakening_signal: string;
    }>;
  } | null;
};

export type MobileStock = {
  code: string;
  name: string;
  market: string;
  sector: string;
  radar_lens: Lens | null;
  detail_generated_at: string;
  summary: StockDetail['summary'];
  valuation: StockDetail['valuation'];
  quarters: StockDetail['quarters'];
  events: StockDetail['events'];
  theses: MobileThesis[];
  kpis: ResearchKpi[];
  journal: JournalEntry[];
};

export type MobileRadarSummary = {
  generated_at: string;
  as_of: string;
  status: string;
  universe_count: number;
  candidate_count: number;
  lens_counts: Partial<Record<Lens, number>>;
  candidates?: Array<{
    code: string;
    name: string;
    market: string;
    sector: string;
    market_cap_krw: number | null;
    primary_lens: Lens;
    matched_lenses: Lens[];
    highlights: Array<{
      label: string;
      value: number | string | null;
      comparison: string;
      period: string;
    }>;
    contradictions: string[];
    warnings: string[];
    freshness: 'latest' | 'stale';
  }>;
};

export type MobileSnapshot = {
  schema_version: typeof mobileSnapshotSchema;
  generated_at: string;
  market: MobileMarket;
  radar: MobileRadarSummary;
  stocks: MobileStock[];
  learning: LearningItem[];
};

export type MobileNote = {
  id: string;
  code: string;
  body: string;
  created_at: string;
  consumed_at: string | null;
};

export const mobileReviewStateLabels: Record<ThesisReviewState, string> = {
  open: '검증 중',
  strengthened: '강화됨',
  weakened: '약화됨',
  on_hold: '판단 보류',
};
