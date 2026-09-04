import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResearchStockController } from '@/components/research-stock-controller';
import { readRadar, readPreview } from '@/lib/server/research-service';
import { localStore, researchConfig } from '@/lib/server/research-store';
import { parseDetailTab } from '@/lib/research-followup';

type PageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function loadStock(code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const radarRun = await readRadar();
  if (!process.env.VERCEL) {
    const store = localStore();
    try {
      const record = store.get(code);
      if (record?.item.active)
        return { stock: record.stock, record, items: store.list(), radarRun };
      const stock = await readPreview(code, radarRun);
      return stock
        ? { stock, record: null, items: store.list(), radarRun }
        : null;
    } finally {
      store.close();
    }
  }
  const stock = await readPreview(code, radarRun);
  return stock ? { stock, record: null, items: [], radarRun } : null;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { code } = await params;
  const data = await loadStock(code);
  const stock = data?.stock;
  return stock
    ? {
        title: `${stock.name} (${stock.code}) — Value Dashboard`,
        description: `${stock.name}의 재무·가격·공시와 Radar 근거를 함께 검토합니다.`,
        openGraph: null,
        twitter: null,
      }
    : { title: '종목을 찾을 수 없음 — Value Dashboard' };
}

export default async function StockPage({ params, searchParams }: PageProps) {
  const { code } = await params;
  const query = await searchParams;
  const initialEventsScope = query.scope === 'all' ? 'all' : 'focus';
  const data = await loadStock(code);
  if (!data) notFound();
  const initialTab =
    query.tab === undefined && data.record
      ? 'thesis'
      : parseDetailTab(query.tab);
  return (
    <ResearchStockController
      key={`${code}-${initialTab}-${initialEventsScope}`}
      initialTab={initialTab}
      initialEventsScope={initialEventsScope}
      stock={data.stock}
      radarRun={data.radarRun}
      initialRecord={data.record}
      initialItems={data.items}
      pollInterval={researchConfig.poll_interval_ms}
    />
  );
}
