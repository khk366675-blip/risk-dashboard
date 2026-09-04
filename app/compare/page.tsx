import type { Metadata } from 'next';
import {
  ComparisonWorkspace,
  type ComparisonStock,
} from '@/components/comparison-workspace';
import { localStore } from '@/lib/server/research-store';
import { ResearchSystemStore } from '@/lib/server/research-system-store';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '기업 비교 — Value Dashboard',
  description: '관심종목의 실제 재무값과 사업 KPI를 같은 기준으로 비교합니다.',
};
export default function ComparePage() {
  const owner = localStore();
  try {
    const system = new ResearchSystemStore(owner.db);
    const items = owner.list().map((item) => {
      const record = owner.get(item.code)!;
      return {
        stock: record.stock,
        kpis: system.snapshot(item.code).kpis,
        thesis_count: item.thesis?.count ?? 0,
      } satisfies ComparisonStock;
    });
    return <ComparisonWorkspace items={items} />;
  } finally {
    owner.close();
  }
}
