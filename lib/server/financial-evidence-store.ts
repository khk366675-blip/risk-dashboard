import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  financialMetrics,
  metricValue,
  type FinancialMetric,
} from '../stock-research.ts';
import type { StockDetail } from '../stock-detail.ts';
import {
  evidenceRelations,
  researchEvidenceConfig,
  type EvidenceRelation,
} from '../research-evidence.ts';
import type { FinancialEvidence } from '../research-financial-evidence.ts';
import { ThesisError, uuidPattern } from '../investment-thesis.ts';
import { ThesisStore } from './thesis-store.ts';

type CreateFinancialEvidence = {
  id: string;
  thesis_id: string;
  thesis_revision: number;
  relation: EvidenceRelation;
  note: string;
  metric: FinancialMetric;
  year: number;
  quarter: string;
};

const metricKeys = new Set<FinancialMetric>(
  Object.keys(financialMetrics) as FinancialMetric[],
);

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class FinancialEvidenceStore {
  db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  decode(row: Record<string, unknown>): FinancialEvidence {
    const values = JSON.parse(String(row.value_json)) as Record<string, unknown>;
    const sourceStatus = JSON.parse(String(row.source_status_json));
    if (
      !metricKeys.has(row.metric as FinancialMetric) ||
      !Object.hasOwn(evidenceRelations, String(row.relation)) ||
      !values ||
      typeof values !== 'object' ||
      (values.value !== null && !Number.isFinite(values.value)) ||
      (values.raw_value !== null && !Number.isFinite(values.raw_value)) ||
      !sourceStatus ||
      typeof sourceStatus !== 'object'
    )
      throw new Error('Invalid stored financial evidence');
    return {
      id: String(row.id),
      code: String(row.code),
      thesis_id: String(row.thesis_id),
      thesis_revision: Number(row.thesis_revision),
      relation: row.relation as EvidenceRelation,
      note: String(row.note),
      metric: row.metric as FinancialMetric,
      metric_label: String(row.metric_label),
      unit: String(row.unit),
      year: Number(row.year),
      quarter: String(row.quarter),
      value: finiteOrNull(values.value),
      raw_value: finiteOrNull(values.raw_value),
      statement_basis:
        typeof row.statement_basis === 'string' ? row.statement_basis : null,
      receipt_no: typeof row.receipt_no === 'string' ? row.receipt_no : null,
      source_run_id: String(row.source_run_id),
      source_collected_at: String(row.source_collected_at),
      source_status: sourceStatus,
      snapshot_hash: String(row.snapshot_hash),
      created_at: String(row.created_at),
      archived_at:
        typeof row.archived_at === 'string' ? row.archived_at : null,
    };
  }

  list(code: string, thesisId?: string, includeArchived = false) {
    new ThesisStore(this.db).active(code);
    if (thesisId && !uuidPattern.test(thesisId))
      throw new ThesisError('투자포인트 식별자를 확인해 주세요.');
    const where = [
      'code=?',
      ...(thesisId ? ['thesis_id=?'] : []),
      ...(includeArchived ? [] : ['archived_at IS NULL']),
    ];
    return this.db
      .prepare(
        `SELECT * FROM research_financial_evidence WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC`,
      )
      .all(code, ...(thesisId ? [thesisId] : []))
      .map((row) => this.decode(row));
  }

  private source(code: string) {
    const row = this.db
      .prepare('SELECT active,detail_json FROM watchlist WHERE code=?')
      .get(code);
    if (!row || row.active !== 1)
      throw new ThesisError('활성 관심종목에서만 재무 관측을 연결할 수 있습니다.', 409);
    const stock = JSON.parse(String(row.detail_json)) as StockDetail;
    if (!Array.isArray(stock.quarters))
      throw new ThesisError('저장된 재무 자료를 읽지 못했습니다.', 503);
    return stock;
  }

  create(code: string, value: CreateFinancialEvidence) {
    const theses = new ThesisStore(this.db);
    theses.active(code);
    if (
      !uuidPattern.test(value.id) ||
      !uuidPattern.test(value.thesis_id) ||
      !Number.isSafeInteger(value.thesis_revision) ||
      value.thesis_revision < 1 ||
      !Object.hasOwn(evidenceRelations, value.relation) ||
      typeof value.note !== 'string' ||
      value.note.includes('\0') ||
      value.note.length > researchEvidenceConfig.max_note_chars ||
      !metricKeys.has(value.metric) ||
      !Number.isSafeInteger(value.year) ||
      !/^[1-4]Q$/.test(value.quarter)
    )
      throw new ThesisError('연결할 투자포인트와 재무 관측을 확인해 주세요.');
    return theses.transaction(() => {
      const thesis = this.db
        .prepare('SELECT * FROM investment_theses WHERE code=? AND id=?')
        .get(code, value.thesis_id);
      if (!thesis) throw new ThesisError('투자포인트를 찾지 못했습니다.', 404);
      if (thesis.archived === 1)
        throw new ThesisError('보관된 투자포인트에는 연결할 수 없습니다.', 409);
      if (Number(thesis.revision) !== value.thesis_revision)
        throw new ThesisError(
          '투자포인트 저장본이 바뀌었습니다. 최신 저장본을 다시 선택해 주세요.',
          409,
        );
      const prior = this.db
        .prepare('SELECT * FROM research_financial_evidence WHERE id=?')
        .get(value.id);
      if (prior) {
        const decoded = this.decode(prior);
        if (
          decoded.code !== code ||
          decoded.thesis_id !== value.thesis_id ||
          decoded.thesis_revision !== value.thesis_revision ||
          decoded.relation !== value.relation ||
          decoded.note !== value.note ||
          decoded.metric !== value.metric ||
          decoded.year !== value.year ||
          decoded.quarter !== value.quarter
        )
          throw new ThesisError(
            '동일 요청 식별자로 다른 재무 관측을 연결할 수 없습니다.',
            409,
          );
        return decoded;
      }
      const total = Number(
        this.db
          .prepare(
            `SELECT
              (SELECT count(*) FROM research_evidence WHERE thesis_id=? AND archived_at IS NULL) +
              (SELECT count(*) FROM research_financial_evidence WHERE thesis_id=? AND archived_at IS NULL) +
              (SELECT count(*) FROM research_manual_evidence WHERE thesis_id=? AND archived_at IS NULL) AS count`,
          )
          .get(value.thesis_id, value.thesis_id, value.thesis_id)!.count,
      );
      if (total >= researchEvidenceConfig.max_links_per_thesis)
        throw new ThesisError(
          `투자포인트당 연결 자료는 ${researchEvidenceConfig.max_links_per_thesis}개까지입니다. 사용하지 않는 연결을 먼저 해제해 주세요.`,
          409,
        );
      const stock = this.source(code);
      const quarter = stock.quarters.find(
        (item) => item.year === value.year && item.quarter === value.quarter,
      );
      if (!quarter)
        throw new ThesisError('선택한 재무 기간을 찾지 못했습니다.', 404);
      const rawValue = finiteOrNull(quarter[value.metric]);
      const normalizedValue = metricValue(quarter, value.metric);
      const definition = financialMetrics[value.metric];
      const sourceStatus = stock.source_status?.financials ?? {
        status: 'missing',
        warning: '재무 출처 상태가 저장되지 않았습니다.',
      };
      const sourceRunId = String(
        stock.research_run_id || stock.run_id || stock.generated_at || 'unknown',
      );
      const sourceCollectedAt = String(
        sourceStatus.collected_at || stock.collected_at || stock.generated_at,
      );
      const snapshot = {
        code,
        metric: value.metric,
        year: quarter.year,
        quarter: quarter.quarter,
        raw_value: rawValue,
        value: normalizedValue,
        statement_basis: quarter.statement_basis ?? null,
        receipt_no: /^\d{14}$/.test(quarter.receipt_no ?? '')
          ? quarter.receipt_no!
          : null,
      };
      const snapshotHash = createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('hex');
      const duplicate = this.db
        .prepare(
          'SELECT 1 FROM research_financial_evidence WHERE thesis_id=? AND snapshot_hash=? AND archived_at IS NULL',
        )
        .get(value.thesis_id, snapshotHash);
      if (duplicate)
        throw new ThesisError(
          '이 재무 관측은 선택한 투자포인트에 이미 연결되어 있습니다.',
          409,
        );
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO research_financial_evidence(
            id,code,thesis_id,thesis_revision,relation,note,metric,metric_label,unit,year,quarter,value_json,
            statement_basis,receipt_no,source_run_id,source_collected_at,source_status_json,snapshot_hash,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          value.id,
          code,
          value.thesis_id,
          value.thesis_revision,
          value.relation,
          value.note,
          value.metric,
          definition.label,
          definition.unit,
          quarter.year,
          quarter.quarter,
          JSON.stringify({ value: normalizedValue, raw_value: rawValue }),
          quarter.statement_basis ?? null,
          snapshot.receipt_no,
          sourceRunId,
          sourceCollectedAt,
          JSON.stringify(sourceStatus),
          snapshotHash,
          now,
        );
      return this.decode(
        this.db
          .prepare('SELECT * FROM research_financial_evidence WHERE id=?')
          .get(value.id)!,
      );
    });
  }

  archive(code: string, id: string, archived: boolean) {
    const theses = new ThesisStore(this.db);
    theses.active(code);
    if (!uuidPattern.test(id) || typeof archived !== 'boolean')
      throw new ThesisError('연결 자료 식별자를 확인해 주세요.');
    return theses.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM research_financial_evidence WHERE code=? AND id=?')
        .get(code, id);
      if (!row) throw new ThesisError('재무 연결 자료를 찾지 못했습니다.', 404);
      if ((row.archived_at !== null) === archived) return this.decode(row);
      if (!archived) {
        const duplicate = this.db
          .prepare(
            'SELECT 1 FROM research_financial_evidence WHERE thesis_id=? AND snapshot_hash=? AND archived_at IS NULL',
          )
          .get(row.thesis_id, row.snapshot_hash);
        if (duplicate)
          throw new ThesisError('같은 재무 관측이 이미 연결되어 있습니다.', 409);
      }
      this.db
        .prepare('UPDATE research_financial_evidence SET archived_at=? WHERE id=?')
        .run(archived ? new Date().toISOString() : null, id);
      return this.decode(
        this.db
          .prepare('SELECT * FROM research_financial_evidence WHERE id=?')
          .get(id)!,
      );
    });
  }
}
