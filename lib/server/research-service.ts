import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RadarRun } from '../radar-run';
import type { StockDetail } from '../stock-detail';
import {
  localStore,
  researchConfig,
  researchDirectory,
} from './research-store';

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
    try {
      const stock = JSON.parse(
        await readFile(
          path.join(process.cwd(), directory, `${code}.json`),
          'utf8',
        ),
      ) as StockDetail;
      if (stock.run_id && stock.run_id !== radar.run_id) continue;
      return {
        ...stock,
        data_level: 'preview',
        quarters: [],
        events: [],
        prices: stock.prices.slice(-65),
        radar: candidate,
        warnings: [
          'Radar 기본 자료입니다. 관심종목으로 등록하면 상세 재무·공시를 보강합니다.',
        ],
        source_status: {
          prices: stock.source_status.prices,
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
