import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ThesisError, uuidPattern } from '../investment-thesis.ts';
import {
  thesisReviewStates,
  type ResearchUpdateItem,
  type ResearchWorkbench,
  type SourceLauncher,
  type ThesisEvidenceCounts,
  type ThesisReviewState,
  type ThesisStatusRecord,
  type WorkbenchStock,
  type WorkbenchThesis,
} from '../research-workbench.ts';
import { classifyFiling } from '../stock-research.ts';
import type { FollowupItem } from '../research-followup.ts';
import type { StockDetail } from '../stock-detail.ts';
import { ThesisStore } from './thesis-store.ts';

type WorkbenchConfig = {
  max_update_note_chars: number;
  max_status_note_chars: number;
  max_update_items: number;
  source_searches: {
    key: string;
    label: string;
    description: string;
    template: string;
  }[];
};

export const workbenchConfig = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'research/workbench-config.json'),
    'utf8',
  ),
) as WorkbenchConfig;

const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

function isoDate(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{8}$/.test(value))
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return value;
}

function latest(values: (string | null)[]) {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

export class ResearchWorkbenchStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private status(thesisId: string): ThesisStatusRecord {
    const row = this.db
      .prepare('SELECT * FROM investment_thesis_status WHERE thesis_id=?')
      .get(thesisId);
    return row
      ? {
          state: row.state as ThesisReviewState,
          note: String(row.note),
          reviewed_at: String(row.reviewed_at),
          updated_at: String(row.updated_at),
        }
      : {
          state: 'open',
          note: '',
          reviewed_at: null,
          updated_at: null,
        };
  }

  private evidence(thesisId: string): ThesisEvidenceCounts {
    const rows = this.db
      .prepare(
        `SELECT relation,kind,count(*) AS count,max(created_at) AS latest_at FROM (
          SELECT relation,'documents' AS kind,created_at FROM research_evidence WHERE thesis_id=? AND archived_at IS NULL
          UNION ALL
          SELECT relation,'financials' AS kind,created_at FROM research_financial_evidence WHERE thesis_id=? AND archived_at IS NULL
          UNION ALL
          SELECT relation,'manual' AS kind,created_at FROM research_manual_evidence WHERE thesis_id=? AND archived_at IS NULL
        ) GROUP BY relation,kind`,
      )
      .all(thesisId, thesisId, thesisId);
    const manualRows = this.db
      .prepare(
        'SELECT source_type,count(*) AS count FROM research_manual_evidence WHERE thesis_id=? AND archived_at IS NULL GROUP BY source_type',
      )
      .all(thesisId);
    const result: ThesisEvidenceCounts = {
      supports: 0,
      challenges: 0,
      context: 0,
      total: 0,
      documents: 0,
      financials: 0,
      manual: 0,
      manual_types: {},
      latest_at: null,
    };
    const dates: (string | null)[] = [];
    for (const row of rows) {
      const count = Number(row.count);
      const relation = String(row.relation) as keyof Pick<
        ThesisEvidenceCounts,
        'supports' | 'challenges' | 'context'
      >;
      const kind = String(row.kind) as 'documents' | 'financials' | 'manual';
      result[relation] += count;
      result[kind] += count;
      result.total += count;
      dates.push(row.latest_at ? String(row.latest_at) : null);
    }
    for (const row of manualRows)
      result.manual_types[
        String(row.source_type) as keyof typeof result.manual_types
      ] = Number(row.count);
    result.latest_at = latest(dates);
    return result;
  }

  private ai(thesisId: string) {
    const row = this.db
      .prepare(
        `SELECT r.*,a.lease_until FROM thesis_evidence_ai_runs r
         JOIN ai_request_attempts a ON a.id=r.id
         WHERE r.thesis_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`,
      )
      .get(thesisId);
    if (!row)
      return {
        state: null,
        created_at: null,
        thesis_revision: null,
        evidence_signature: null,
      } as const;
    const interrupted =
      row.state === 'pending' && Number(row.lease_until) <= Date.now();
    return {
      state: interrupted
        ? ('interrupted' as const)
        : (String(row.state) as 'pending' | 'completed' | 'error'),
      created_at: String(row.created_at),
      thesis_revision: Number(row.thesis_revision),
      evidence_signature: String(row.evidence_signature),
    };
  }

  private theses(code: string): WorkbenchThesis[] {
    const store = new ThesisStore(this.db);
    return store
      .list(code)
      .filter((item) => !item.archived)
      .map((item) => ({
        ...item,
        review: this.status(item.id),
        evidence: this.evidence(item.id),
        ai: this.ai(item.id),
      }));
  }

  private launchers(code: string, name: string): SourceLauncher[] {
    return workbenchConfig.source_searches.map((source) => ({
      key: source.key,
      label: source.label,
      description: source.description,
      url: source.template
        .replaceAll('{name}', encodeURIComponent(name))
        .replaceAll('{code}', encodeURIComponent(code)),
      state: 'manual_search',
    }));
  }

  private updateState() {
    return new Map(
      this.db
        .prepare('SELECT * FROM research_update_states')
        .all()
        .map((row) => [String(row.item_key), row]),
    );
  }

  private updates(followups: FollowupItem[]): ResearchUpdateItem[] {
    const state = this.updateState();
    const updates: ResearchUpdateItem[] = [];
    const push = (
      item: Omit<ResearchUpdateItem, 'state' | 'note' | 'reviewed_at'>,
    ) => {
      const saved = state.get(item.key);
      updates.push({
        ...item,
        state: saved?.status === 'reviewed' ? 'reviewed' : 'open',
        note: saved ? String(saved.note) : '',
        reviewed_at:
          saved?.reviewed_at && typeof saved.reviewed_at === 'string'
            ? saved.reviewed_at
            : null,
      });
    };
    for (const item of followups) {
      const stockRow = this.db
        .prepare('SELECT detail_json FROM watchlist WHERE code=?')
        .get(item.code);
      const stock = stockRow
        ? (JSON.parse(String(stockRow.detail_json)) as StockDetail)
        : null;
      for (const section of item.firstSections) {
        const tab =
          section === '공시'
            ? 'events'
            : section === '재무'
              ? 'financials'
              : 'price';
        push({
          key: `first:${item.code}:${tab}`,
          code: item.code,
          name: item.name,
          kind: 'first_review',
          priority: 'info',
          title: `${section} 첫 확인 기준 필요`,
          summary: '현재 자료를 확인한 뒤 다음 변화 비교 기준으로 저장하세요.',
          occurred_at: null,
          href: `/stocks/${item.code}?tab=${tab}`,
          source_name: section,
          source_id: null,
          source_status: 'first_review',
          warning: null,
        });
      }
      if (item.filings.newCount !== null) {
        for (const event of item.filings.preview) {
          const classification = classifyFiling(event);
          push({
            key: `filing:${item.code}:${sha([event.id, event.url, event.date, event.title])}`,
            code: item.code,
            name: item.name,
            kind: 'filing',
            priority:
              classification.priority === 'focus' ? 'attention' : 'standard',
            title: event.title?.trim() || '제목 미확인 공시',
            summary: classification.reason,
            occurred_at: isoDate(event.date),
            href: `/stocks/${item.code}?tab=events&scope=all`,
            source_name: 'DART 공시 목록',
            source_id: event.id,
            source_status:
              item.sources.find((source) => source.key === 'dart_events')
                ?.status ?? 'missing',
            warning: null,
          });
        }
      }
      for (const change of item.financials.changes) {
        const quarter = stock?.quarters.find(
          (candidate) =>
            `${candidate.year} ${candidate.quarter}` === change.period,
        );
        push({
          key: `financial:${item.code}:${sha([
            change,
            quarter?.statement_basis ?? null,
            quarter?.receipt_no ?? null,
            quarter?.rev ?? null,
            quarter?.op ?? null,
            quarter?.ni ?? null,
            quarter?.ocf ?? null,
            quarter?.equity ?? null,
            quarter?.debt ?? null,
          ])}`,
          code: item.code,
          name: item.name,
          kind: 'financial',
          priority: 'standard',
          title: `${change.period} 재무 ${change.kind === 'new' ? '추가' : '수정'}`,
          summary:
            '연결·별도 기준과 전년 동기 수치, 현금흐름을 함께 확인하세요.',
          occurred_at:
            item.sources.find((source) => source.key === 'financials')?.as_of ??
            null,
          href: `/stocks/${item.code}?tab=financials`,
          source_name: 'DART 재무',
          source_id: change.period,
          source_status:
            item.sources.find((source) => source.key === 'financials')
              ?.status ?? 'missing',
          warning: null,
        });
      }
      for (const source of item.sources.filter(
        (source) => source.status !== 'ok' || source.stale,
      )) {
        push({
          key: `source:${item.code}:${source.key}:${sha([source.status, source.stale, source.collected_at, source.warning])}`,
          code: item.code,
          name: item.name,
          kind: 'source_issue',
          priority: 'attention',
          title: `${source.label} 자료 상태 확인`,
          summary:
            source.warning ||
            (source.stale
              ? '수집 시점이 오래됐습니다.'
              : '자료 상태를 확인해 주세요.'),
          occurred_at: source.collected_at,
          href: `/stocks/${item.code}`,
          source_name: source.source,
          source_id: source.run_id,
          source_status: source.stale ? 'stale' : source.status,
          warning: source.warning,
        });
      }
      const documents = this.db
        .prepare(
          `SELECT d.receipt,d.title,d.state,v.version,v.collected_at
           FROM filing_documents d JOIN filing_document_versions v
           ON v.code=d.code AND v.receipt=d.receipt
           WHERE d.code=? AND ? IS NOT NULL AND v.collected_at>?
           ORDER BY v.collected_at DESC`,
        )
        .all(item.code, item.checked_at, item.checked_at);
      for (const row of documents) {
        push({
          key: `document:${item.code}:${String(row.receipt)}:${String(row.version)}`,
          code: item.code,
          name: item.name,
          kind: 'document',
          priority: 'standard',
          title: `${String(row.title)} 원문 저장`,
          summary:
            '저장된 문서에서 근거를 찾거나 이전 보고서와 변화 대조를 실행할 수 있습니다.',
          occurred_at: String(row.collected_at),
          href: `/stocks/${item.code}?tab=documents&receipt=${String(row.receipt)}`,
          source_name: 'DART 원문 저장본',
          source_id: String(row.receipt),
          source_status: String(row.state),
          warning: null,
        });
      }
    }
    return updates
      .sort((a, b) => {
        const stateOrder =
          Number(a.state === 'reviewed') - Number(b.state === 'reviewed');
        if (stateOrder) return stateOrder;
        const priority = { attention: 0, standard: 1, info: 2 };
        return (
          priority[a.priority] - priority[b.priority] ||
          (b.occurred_at ?? '').localeCompare(a.occurred_at ?? '') ||
          a.name.localeCompare(b.name, 'ko-KR')
        );
      })
      .slice(0, workbenchConfig.max_update_items);
  }

  snapshot(followups: FollowupItem[]): ResearchWorkbench {
    const stocks: WorkbenchStock[] = followups.map((followup) => ({
      code: followup.code,
      name: followup.name,
      followup,
      theses: this.theses(followup.code),
      source_launchers: this.launchers(followup.code, followup.name),
    }));
    const updates = this.updates(followups);
    const theses = stocks.flatMap((stock) => stock.theses);
    const thesisStates = { open: 0, strengthened: 0, weakened: 0, on_hold: 0 };
    for (const thesis of theses) thesisStates[thesis.review.state] += 1;
    const warnings = [
      ...new Set(
        stocks.flatMap((stock) =>
          stock.followup.sources
            .filter((source) => source.status !== 'ok' || source.stale)
            .map(
              (source) =>
                `${stock.name} ${source.label}: ${source.warning || (source.stale ? '이전 자료' : source.status)}`,
            ),
        ),
      ),
    ];
    return {
      generated_at: new Date().toISOString(),
      stocks,
      updates,
      summary: {
        stock_count: stocks.length,
        open_update_count: updates.filter((item) => item.state === 'open')
          .length,
        attention_count: updates.filter(
          (item) => item.state === 'open' && item.priority === 'attention',
        ).length,
        thesis_count: theses.length,
        thesis_states: thesisStates,
        evidence_count: theses.reduce(
          (sum, thesis) => sum + thesis.evidence.total,
          0,
        ),
        ai_ready_count: theses.filter((thesis) => thesis.evidence.total > 0)
          .length,
      },
      warnings,
    };
  }

  setUpdate(
    followups: FollowupItem[],
    value: { item_key: string; status: string; note: string },
  ) {
    if (
      typeof value.item_key !== 'string' ||
      !['open', 'reviewed'].includes(value.status) ||
      typeof value.note !== 'string' ||
      value.note.includes('\0') ||
      value.note.length > workbenchConfig.max_update_note_chars
    )
      throw new ThesisError('업데이트 검토 상태와 메모를 확인해 주세요.');
    const current = this.updates(followups).find(
      (item) => item.key === value.item_key,
    );
    if (!current)
      throw new ThesisError(
        '현재 업데이트 목록에서 항목을 찾지 못했습니다.',
        404,
      );
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO research_update_states(item_key,code,status,note,reviewed_at,updated_at)
         VALUES(?,?,?,?,?,?) ON CONFLICT(item_key) DO UPDATE SET
         status=excluded.status,note=excluded.note,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at`,
      )
      .run(
        current.key,
        current.code,
        value.status,
        value.note,
        value.status === 'reviewed' ? now : null,
        now,
      );
    return this.updates(followups).find((item) => item.key === value.item_key)!;
  }

  setThesisStatus(value: {
    code: string;
    thesis_id: string;
    state: string;
    note: string;
  }) {
    if (
      !/^\d{6}$/.test(value.code) ||
      !uuidPattern.test(value.thesis_id) ||
      !Object.hasOwn(thesisReviewStates, value.state) ||
      typeof value.note !== 'string' ||
      value.note.includes('\0') ||
      value.note.length > workbenchConfig.max_status_note_chars
    )
      throw new ThesisError('투자포인트 검토 상태와 메모를 확인해 주세요.');
    const thesis = this.db
      .prepare('SELECT archived FROM investment_theses WHERE id=? AND code=?')
      .get(value.thesis_id, value.code);
    if (!thesis) throw new ThesisError('투자포인트를 찾지 못했습니다.', 404);
    if (thesis.archived === 1)
      throw new ThesisError(
        '보관된 투자포인트의 상태는 바꿀 수 없습니다.',
        409,
      );
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO investment_thesis_status(thesis_id,code,state,note,reviewed_at,updated_at)
         VALUES(?,?,?,?,?,?) ON CONFLICT(thesis_id) DO UPDATE SET
         state=excluded.state,note=excluded.note,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at`,
      )
      .run(value.thesis_id, value.code, value.state, value.note, now, now);
    return this.status(value.thesis_id);
  }
}
