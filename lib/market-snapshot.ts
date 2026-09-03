import marketSnapshotJson from '@/public/data/markets/latest.json';

export type MarketGroup = 'global_equity' | 'korea' | 'fx_rates' | 'real_assets';

export type MarketAsset = {
  key: string;
  label: string;
  group: MarketGroup;
  symbol: string;
  unit: string;
  inverse: boolean;
  value: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_20d_pct: number | null;
  change_60d_pct: number | null;
  change_252d_pct: number | null;
  change_1d_value: number | null;
  change_5d_value: number | null;
  change_20d_value: number | null;
  change_60d_value: number | null;
  change_252d_value: number | null;
  position_252d_pct: number | null;
  as_of: string | null;
  source: string;
  freshness: 'latest' | 'stale' | 'missing';
  warning: string | null;
  latest_session: {
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    range_pct: number | null;
    from_open_pct: number | null;
  } | null;
  sparkline: Array<{ date: string; value: number }>;
};

export type MarketSnapshot = {
  schema_version: string;
  generated_at: string;
  status: 'ok' | 'partial' | 'error';
  as_of: string | null;
  summary: {
    global_risk_label: string;
    korea_label: string;
    fx_pressure_label: string;
    one_line: string;
    method: 'rule_based_raw_metrics';
    signals: {
      sp500_20d_pct: number | null;
      nasdaq_20d_pct: number | null;
      vix_level: number | null;
      kospi_20d_pct: number | null;
      kosdaq_20d_pct: number | null;
      above_20d_pct: number | null;
      above_60d_pct: number | null;
      usdkrw_20d_pct: number | null;
      dxy_20d_pct: number | null;
    };
  };
  breadth: {
    status: string;
    as_of: string | null;
    coverage_count: number;
    advancers_pct: number | null;
    above_20d_pct: number | null;
    above_60d_pct: number | null;
    new_high_20d_pct: number | null;
    new_low_20d_pct: number | null;
    source?: string;
    warning?: string | null;
  };
  assets: MarketAsset[];
  source_status: Record<string, Record<string, number | string | null>>;
  warnings: string[];
};

export const marketSnapshot = marketSnapshotJson as MarketSnapshot;

export const marketGroups: Array<{ key: MarketGroup; label: string; description: string }> = [
  { key: 'global_equity', label: '글로벌 주식', description: '위험선호와 변동성' },
  { key: 'korea', label: '한국 시장', description: '국내 벤치마크' },
  { key: 'fx_rates', label: '환율·금리', description: '할인율과 외환 압력' },
  { key: 'real_assets', label: '실물자산', description: '물가·경기 민감 자산' },
];

export function formatAssetValue(asset: MarketAsset): string {
  if (asset.value === null) return '—';
  const value = asset.value.toLocaleString('ko-KR', { maximumFractionDigits: asset.value < 10 ? 3 : 2 });
  return asset.unit === 'KRW' ? `₩${value}` : asset.unit === '%' ? `${value}%` : asset.unit === 'USD' ? `$${value}` : value;
}

export function formatChange(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

export function changeTone(value: number | null, inverse = false): string {
  if (value === null || value === 0) return 'text-slate-500';
  const positive = inverse ? value < 0 : value > 0;
  return positive ? 'text-rose-600' : 'text-blue-600';
}

export type ChangeHorizon = '1d' | '5d' | '20d' | '60d' | '252d';

export function assetChangeValue(asset: MarketAsset, horizon: ChangeHorizon): number | null {
  const values = {
    '1d': asset.change_1d_value,
    '5d': asset.change_5d_value,
    '20d': asset.change_20d_value,
    '60d': asset.change_60d_value,
    '252d': asset.change_252d_value,
  };
  const percentages = {
    '1d': asset.change_1d_pct,
    '5d': asset.change_5d_pct,
    '20d': asset.change_20d_pct,
    '60d': asset.change_60d_pct,
    '252d': asset.change_252d_pct,
  };
  if (asset.key === 'us10y') return values[horizon] === null ? null : Number((values[horizon]! * 100).toFixed(1));
  if (asset.key === 'vix') return values[horizon];
  return percentages[horizon];
}

export function formatAssetChange(asset: MarketAsset, horizon: ChangeHorizon): string {
  const value = assetChangeValue(asset, horizon);
  if (value === null) return '—';
  const prefix = value > 0 ? '+' : '';
  if (asset.key === 'us10y') return `${prefix}${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}bp`;
  if (asset.key === 'vix') return `${prefix}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}pt`;
  return `${prefix}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

export function rawChangeTone(value: number | null): string {
  if (value === null || value === 0) return 'text-slate-500';
  return value > 0 ? 'text-rose-600' : 'text-blue-600';
}
