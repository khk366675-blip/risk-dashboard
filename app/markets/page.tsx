import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { MarketsWorkspace } from '@/components/markets-workspace';
import {
  marketSnapshot as bundledMarketSnapshot,
  type MarketSnapshot,
} from '@/lib/market-snapshot';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Markets — Value Dashboard',
  description: '글로벌 주식, 한국 시장, 환율·금리, 실물자산을 함께 보는 시장 상황판',
  openGraph: { title: 'Markets — Value Dashboard', description: '시장 맥락과 데이터 상태를 함께 확인합니다.', images: [] },
  twitter: { card: 'summary', title: 'Markets — Value Dashboard', description: '시장 맥락과 데이터 상태를 함께 확인합니다.', images: [] },
};

async function latestMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    return JSON.parse(
      await readFile(
        path.join(process.cwd(), 'public', 'data', 'markets', 'latest.json'),
        'utf8',
      ),
    ) as MarketSnapshot;
  } catch {
    return bundledMarketSnapshot;
  }
}

export default async function MarketsPage() {
  return <MarketsWorkspace initialSnapshot={await latestMarketSnapshot()} />;
}
