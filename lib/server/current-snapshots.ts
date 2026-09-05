import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RadarRun } from '../radar-run.ts';
import type { MarketSnapshot } from '../market-snapshot.ts';

// Read on every request/publication. JSON imports are frozen in production bundles.
export function readCurrentRadar(root = process.cwd()): RadarRun {
  const value = JSON.parse(
    readFileSync(path.join(root, 'public/data/radar/latest.json'), 'utf8'),
  ) as RadarRun;
  if (
    !value.run_id ||
    !Array.isArray(value.candidates) ||
    value.summary.candidate_unique_count !== value.candidates.length
  )
    throw new Error('Radar 저장 결과의 후보 수와 목록이 일치하지 않습니다.');
  return value;
}
export function readCurrentMarket(root = process.cwd()): MarketSnapshot {
  const value = JSON.parse(
    readFileSync(path.join(root, 'public/data/markets/latest.json'), 'utf8'),
  ) as MarketSnapshot;
  if (!value.generated_at || !Array.isArray(value.assets))
    throw new Error('시장 저장 결과를 읽지 못했습니다.');
  return value;
}
