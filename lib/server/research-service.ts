import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { completePreviewPrices } from './price-history.ts';
import type { Lens, RadarCandidate, RadarRun } from '../radar-run.ts';
import type { StockDetail } from '../stock-detail.ts';
import type { ListedStock } from './listing-store.ts';
import {
  localStore,
  researchConfig,
  researchDirectory,
} from './research-store.ts';

export async function readRadar(): Promise<RadarRun> {
  return JSON.parse(
    await readFile(
      path.join(process.cwd(), 'public/data/radar/latest.json'),
      'utf8',
    ),
  );
}
export async function readPreview(
  code: string,
  radar: RadarRun,
): Promise<StockDetail | null> {
  const candidate = radar.candidates.find((row) => row.code === code);
  if (!candidate) return null;
  for (const directory of [researchConfig.preview_dir, 'public/data/stocks']) {
    const previewDirectory = path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      directory,
    );
    try {
      const stock = JSON.parse(
        await readFile(path.join(previewDirectory, `${code}.json`), 'utf8'),
      ) as StockDetail;
      if (stock.run_id && stock.run_id !== radar.run_id) continue;
      // Older previews retained only 65 sessions. Recover the matching full local
      // price snapshot without running any external collector.
      const prices = completePreviewPrices(
        stock,
        path.join(process.cwd(), 'data/market/radar_market.db'),
      );
      return {
        ...stock,
        data_level: 'preview',
        quarters: [],
        events: [],
        prices,
        radar: candidate,
        warnings: [
          'Radar 기본 자료입니다. 관심종목으로 등록하면 상세 재무·공시를 보강합니다.',
        ],
        source_status: {
          prices: {
            ...stock.source_status.prices,
            record_count: prices.length,
          },
          financials: {
            ...stock.source_status.financials,
            status: 'partial',
            source: 'Radar 기본 재무',
            warning: '상세 자료는 관심종목 등록 후 수집합니다.',
          },
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

const lensNames: Record<Lens, string> = {
  quality: 'Quality',
  improvement: 'Improvement',
  dislocation: 'Dislocation',
  event: 'Event',
};

export function manualCandidate(
  listing: ListedStock,
  radar: RadarRun,
): RadarCandidate {
  const emptyLens = (lens: Lens): RadarCandidate['lenses'][Lens] => ({
    lens,
    label: lensNames[lens],
    matched: false,
    qualified: false,
    band: 'review',
    evidence_count: 0,
    evidence_ratio_pct: 0,
    coverage_pct: 0,
    evidence: [],
    contradictions: [],
  });
  const lenses: RadarCandidate['lenses'] = {
    quality: emptyLens('quality'),
    improvement: emptyLens('improvement'),
    dislocation: emptyLens('dislocation'),
    event: emptyLens('event'),
  };
  return {
    discovery: 'manual',
    code: listing.code,
    name: listing.name,
    market: listing.market,
    sector: listing.sector,
    market_cap_krw: listing.market_cap_krw,
    // Kept only for backward-compatible storage; manual entries expose no lens.
    primary_lens: 'quality',
    matched_lenses: [],
    lenses,
    plot: { evidence_density_pct: 0, coverage_pct: 0 },
    contradictions: [],
    warnings: [
      '사용자가 직접 추가한 관심종목입니다. Radar 선정 근거가 없습니다.',
    ],
    as_of: radar.as_of,
    latest_price_date: radar.as_of,
    freshness: radar.status === 'ok' ? 'latest' : 'stale',
  };
}

export function manualPreview(
  listing: ListedStock,
  radar: RadarRun,
): StockDetail {
  const generatedAt = new Date().toISOString();
  const candidate = manualCandidate(listing, radar);
  return {
    schema_version: 'stock-preview.v1',
    data_level: 'preview',
    code: listing.code,
    name: listing.name,
    market: listing.market,
    sector: listing.sector,
    industry: listing.industry,
    listing_date: listing.listing_date,
    generated_at: generatedAt,
    collected_at: radar.generated_at,
    warnings: [...candidate.warnings],
    summary: {
      latest_price: listing.latest_price,
      change_1d_pct: null,
      price_as_of: radar.as_of,
      market_cap_krw: listing.market_cap_krw,
      high_52w: null,
      low_52w: null,
      drawdown_52w_pct: null,
      price_position_52w_pct: null,
    },
    valuation: {
      per: null,
      pbr: null,
      ev_ebitda: null,
      ev_operating_profit: null,
      ttm_roe_pct: null,
      debt_ratio_pct: null,
      interest_coverage: null,
      ttm_revenue: null,
      ttm_operating_profit: null,
      ttm_net_income: null,
      ttm_operating_cash_flow: null,
    },
    quarters: [],
    prices: [],
    events: [],
    radar: candidate,
    source_status: {
      prices: {
        status: 'partial',
        source: 'KRX 상장종목 스냅샷',
        as_of: radar.as_of,
        collected_at: radar.generated_at,
        record_count: listing.latest_price === null ? 0 : 1,
        warning: '등록 후 가격 이력을 수집하고 있습니다.',
      },
      financials: {
        status: 'missing',
        source: 'DART 단일회사 전체 재무제표',
        as_of: null,
        collected_at: null,
        warning: '등록 후 재무자료를 수집하고 있습니다.',
      },
      dart_events: {
        status: 'missing',
        source: 'DART 회사별 공시검색',
        as_of: null,
        collected_at: null,
        warning: '등록 후 공시를 수집하고 있습니다.',
      },
    },
  };
}
export async function startResearchWorker(code: string, jobId: string) {
  const python =
    process.env.RADAR_PYTHON_EXECUTABLE ||
    path.join(
      process.cwd(),
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  let environmentFile: string | undefined;
  for (const file of [
    process.env.RADAR_ENV_FILE,
    '.env.local',
    '.env',
    '../ai-invest/.env',
  ]) {
    if (!file) continue;
    try {
      const resolved = path.resolve(/* turbopackIgnore: true */ file);
      await access(resolved);
      environmentFile = resolved;
      break;
    } catch {
      /* try next local configuration */
    }
  }
  const args = [
    '-m',
    'scripts.collect_watchlist_stock',
    '--code',
    code,
    '--job-id',
    jobId,
  ];
  if (environmentFile) args.push('--env-file', environmentFile);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ python, args, {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          RESEARCH_STORAGE_DIR: researchDirectory,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      });
      child.once('error', reject);
      child.once('exit', (exitCode) => {
        if (exitCode === 0) return;
        // Spawn can succeed even when Python exits before initializing the job.
        // Keep registration; fail only the matching, still-active attempt.
        try {
          const store = localStore();
          try {
            store.fail(code, jobId);
          } finally {
            store.close();
          }
        } catch {
          /* Persistent timeout recovery remains available. */
        }
      });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  } catch {
    const store = localStore();
    try {
      store.fail(code, jobId);
    } finally {
      store.close();
    }
  }
}
export function validateMutation(request: Request) {
  const origin = request.headers.get('origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new Error('다른 사이트에서의 변경 요청은 허용하지 않습니다.');
}
