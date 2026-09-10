import type { RadarCandidate } from '@/lib/radar-run';

export type StockQuarter = {
  [key: string]: unknown;
  metric_sources?: Record<
    string,
    {
      status: string;
      formula?: string;
      inputs?: unknown[];
      [key: string]: unknown;
    }
  >;
  parser_version?: string;
  year: number;
  quarter: string;
  label: string;
  rev?: number | null;
  op?: number | null;
  ni?: number | null;
  ocf?: number | null;
  equity?: number | null;
  debt?: number | null;
  warnings?: string[];
  statement_basis?: string;
  source_url?: string | null;
  receipt_no?: string | null;
  op_margin_pct?: number | null;
  debt_ratio_pct?: number | null;
};

export type StockPrice = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type StockEvent = {
  id: string | null;
  date: string | null;
  title: string | null;
  url: string | null;
  importance: string | null;
  direction: string | null;
};

export type StockDetail = {
  schema_version: string;
  data_level?: 'preview' | 'research';
  event_scope?: string;
  research_run_id?: string;
  generated_at: string;
  run_id?: string;
  collected_at?: string;
  warnings?: string[];
  code: string;
  name: string;
  market: string;
  sector: string;
  industry: string | null;
  listing_date: string | null;
  summary: {
    latest_price: number | null;
    change_1d_pct: number | null;
    price_as_of: string | null;
    market_cap_krw: number | null;
    high_52w: number | null;
    low_52w: number | null;
    drawdown_52w_pct: number | null;
    price_position_52w_pct: number | null;
  };
  valuation: {
    roe_basis?: 'average' | 'closing';
    attribution_basis?: 'parent' | 'total';
    interest_basis?: 'interest' | 'finance_costs';
    method?: string;
    per: number | null;
    pbr: number | null;
    ev_ebitda: number | null;
    ev_operating_profit?: number | null;
    ttm_roe_pct: number | null;
    debt_ratio_pct: number | null;
    interest_coverage: number | null;
    ttm_revenue: number | null;
    ttm_operating_profit: number | null;
    ttm_net_income: number | null;
    ttm_operating_cash_flow: number | null;
  };
  quarters: StockQuarter[];
  annual_financials?: StockQuarter[];
  financial_parser_version?: string;
  radar_valuation_basis?: {
    interest_basis?: 'interest' | 'finance_costs';
    roe_basis?: 'average' | 'closing';
  };
  prices: StockPrice[];
  events: StockEvent[];
  radar: RadarCandidate;
  source_status: Record<
    string,
    {
      status: string;
      record_count?: number;
      quarter_count?: number;
      as_of?: string | null;
      source?: string;
      collected_at?: string | null;
      warning?: string | null;
      run_id?: string;
    }
  >;
};

export function formatWon(value: number | null, compact = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (!compact) return `${Math.round(value).toLocaleString('ko-KR')}원`;
  const trillion = value / 1_000_000_000_000;
  if (Math.abs(trillion) >= 1)
    return `${trillion.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조`;
  return `${Math.round(value / 100_000_000).toLocaleString('ko-KR')}억`;
}

export function formatMultiple(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? '—'
    : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}x`;
}

export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? '—'
    : `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
}
