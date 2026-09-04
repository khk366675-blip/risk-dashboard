import marketSnapshot from '../../public/data/markets/latest.json' with {
  type: 'json',
};
import radarSnapshot from '../../public/data/radar/latest.json' with {
  type: 'json',
};
import {
  mobileSnapshotSchema,
  type MobileEvidenceItem,
  type MobileMarket,
  type MobileSnapshot,
} from '../mobile-dashboard.ts';
import type { RadarRun } from '../radar-run.ts';
import { ManualEvidenceStore } from './manual-evidence-store.ts';
import { FinancialEvidenceStore } from './financial-evidence-store.ts';
import { ResearchEvidenceStore } from './research-evidence-store.ts';
import { researchDirectory, ResearchStore } from './research-store.ts';
import { ResearchSystemStore } from './research-system-store.ts';
import { ResearchWorkbenchStore } from './research-workbench-store.ts';

const dartUrl = (receipt: string | null) =>
  receipt
    ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receipt)}`
    : null;

export function buildLocalMobileSnapshot(): MobileSnapshot {
  const market = marketSnapshot as MobileMarket;
  const radar = radarSnapshot as RadarRun;
  const owner = new ResearchStore();
  try {
    const system = new ResearchSystemStore(owner.db);
    const workbench = new ResearchWorkbenchStore(owner.db).snapshot(
      owner.followups(),
    );
    const documents = new ResearchEvidenceStore(owner.db, researchDirectory);
    const financials = new FinancialEvidenceStore(owner.db);
    const manuals = new ManualEvidenceStore(owner.db);
    const stocks = owner.list().flatMap((item) => {
      const record = owner.get(item.code);
      if (!record) return [];
      const research = workbench.stocks.find((stock) => stock.code === item.code);
      const detail = record.stock;
      return [
        {
          code: item.code,
          name: item.name,
          market: detail.market,
          sector: detail.sector,
          radar_lens: detail.radar?.primary_lens ?? null,
          detail_generated_at: detail.generated_at,
          summary: detail.summary,
          valuation: detail.valuation,
          quarters: detail.quarters.slice(-8),
          events: detail.events.slice(0, 16),
          theses: (research?.theses ?? []).map((thesis) => {
            const evidence: MobileEvidenceItem[] = [
              ...documents.list(item.code, thesis.id).map((entry) => ({
                id: entry.id,
                kind: 'filing' as const,
                relation: entry.relation,
                label: `${entry.document_title} · ${entry.section_title}`,
                summary: entry.excerpt.text,
                source: 'DART 공시 원문',
                as_of: entry.collected_at,
                url: dartUrl(entry.receipt),
                note: entry.note,
                source_status: 'saved_snapshot',
              })),
              ...financials.list(item.code, thesis.id).map((entry) => ({
                id: entry.id,
                kind: 'financial' as const,
                relation: entry.relation,
                label: `${entry.metric_label} · ${entry.year} ${entry.quarter}`,
                summary:
                  entry.value === null
                    ? '수치 미확인'
                    : `${entry.value.toLocaleString('ko-KR')} ${entry.unit}`,
                source: 'DART 재무',
                as_of: entry.source_collected_at,
                url: dartUrl(entry.receipt_no),
                note: entry.note,
                source_status:
                  typeof entry.source_status.status === 'string'
                    ? entry.source_status.status
                    : 'unknown',
              })),
              ...manuals.list(item.code, thesis.id).map((entry) => ({
                id: entry.id,
                kind: 'manual' as const,
                relation: entry.relation,
                label: entry.title,
                summary: entry.body,
                source: entry.source_name || '사용자 입력',
                as_of: entry.published_at ?? entry.created_at,
                url: entry.url,
                note: entry.note,
                source_status: 'user_supplied',
              })),
            ];
            return {
              id: thesis.id,
              revision: thesis.revision,
              title:
                thesis.content.title || thesis.content.body.split('\n')[0],
              body: thesis.content.body,
              timing: thesis.content.timing,
              weakens: thesis.content.weakens,
              checks: thesis.content.checks.map((check) => check.text),
              review: thesis.review,
              evidence,
            };
          }),
          kpis: system.snapshot(item.code).kpis,
          journal: system.snapshot(item.code).journal.slice(0, 20),
        },
      ];
    });
    return {
      schema_version: mobileSnapshotSchema,
      generated_at: new Date().toISOString(),
      market: {
        generated_at: market.generated_at,
        as_of: market.as_of,
        status: market.status,
        summary: market.summary,
        breadth: market.breadth,
        assets: market.assets.map((asset) => ({
          key: asset.key,
          label: asset.label,
          group: asset.group,
          unit: asset.unit,
          value: asset.value,
          change_1d_pct: asset.change_1d_pct,
          change_20d_pct: asset.change_20d_pct,
          as_of: asset.as_of,
          freshness: asset.freshness,
        })),
      },
      radar: {
        generated_at: radar.generated_at,
        as_of: radar.as_of,
        status: radar.status,
        universe_count:
          radar.summary.evaluated_universe_count ??
          radar.summary.standard_eligible_count,
        candidate_count: radar.summary.candidate_unique_count,
        lens_counts: radar.summary.lens_counts,
      },
      stocks,
      learning: system.learning(),
    };
  } finally {
    owner.close();
  }
}
