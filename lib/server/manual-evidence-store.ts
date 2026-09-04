import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ThesisError, uuidPattern } from '../investment-thesis.ts';
import {
  evidenceRelations,
  researchEvidenceConfig,
  type EvidenceRelation,
} from '../research-evidence.ts';
import {
  manualEvidenceTypes,
  type ManualEvidence,
  type ManualEvidenceType,
} from '../research-manual-evidence.ts';
import { ThesisStore } from './thesis-store.ts';

type CreateManualEvidence = {
  id: string;
  thesis_id: string;
  thesis_revision: number;
  relation: EvidenceRelation;
  source_type: ManualEvidenceType;
  title: string;
  url: string;
  source_name: string;
  published_at: string;
  body: string;
  note: string;
};

function clean(value: string) {
  return value.trim().replace(/\r\n/g, '\n');
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function validUrl(value: string) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export class ManualEvidenceStore {
  db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  decode(row: Record<string, unknown>): ManualEvidence {
    if (
      !Object.hasOwn(evidenceRelations, String(row.relation)) ||
      !Object.hasOwn(manualEvidenceTypes, String(row.source_type)) ||
      row.source_status !== 'user_supplied' ||
      !/^[a-f0-9]{64}$/.test(String(row.snapshot_hash))
    )
      throw new Error('Invalid stored manual evidence');
    return {
      id: String(row.id),
      code: String(row.code),
      thesis_id: String(row.thesis_id),
      thesis_revision: Number(row.thesis_revision),
      relation: row.relation as EvidenceRelation,
      source_type: row.source_type as ManualEvidenceType,
      title: String(row.title),
      url: typeof row.url === 'string' ? row.url : null,
      source_name: String(row.source_name),
      published_at:
        typeof row.published_at === 'string' ? row.published_at : null,
      body: String(row.body),
      note: String(row.note),
      source_status: 'user_supplied',
      snapshot_hash: String(row.snapshot_hash),
      created_at: String(row.created_at),
      archived_at: typeof row.archived_at === 'string' ? row.archived_at : null,
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
        `SELECT * FROM research_manual_evidence WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC`,
      )
      .all(code, ...(thesisId ? [thesisId] : []))
      .map((row) => this.decode(row));
  }

  create(code: string, raw: CreateManualEvidence) {
    const value = {
      ...raw,
      title: clean(raw.title),
      url: clean(raw.url),
      source_name: clean(raw.source_name),
      published_at: clean(raw.published_at),
      body: clean(raw.body),
      note: clean(raw.note),
    };
    const strings = [
      value.title,
      value.url,
      value.source_name,
      value.published_at,
      value.body,
      value.note,
    ];
    if (
      !uuidPattern.test(value.id) ||
      !uuidPattern.test(value.thesis_id) ||
      !Number.isSafeInteger(value.thesis_revision) ||
      value.thesis_revision < 1 ||
      !Object.hasOwn(evidenceRelations, value.relation) ||
      !Object.hasOwn(manualEvidenceTypes, value.source_type) ||
      !value.title ||
      value.title.length > researchEvidenceConfig.max_manual_title_chars ||
      value.url.length > researchEvidenceConfig.max_manual_url_chars ||
      value.source_name.length >
        researchEvidenceConfig.max_manual_source_chars ||
      value.body.length > researchEvidenceConfig.max_manual_body_chars ||
      value.note.length > researchEvidenceConfig.max_note_chars ||
      strings.some((item) => item.includes('\0')) ||
      (!value.url && !value.body) ||
      !validUrl(value.url) ||
      (value.published_at && !validDate(value.published_at))
    )
      throw new ThesisError(
        '직접 추가할 자료의 제목·링크·날짜·내용을 확인해 주세요.',
      );
    const theses = new ThesisStore(this.db);
    theses.active(code);
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
      const snapshot = {
        source_type: value.source_type,
        title: value.title,
        url: value.url || null,
        source_name: value.source_name,
        published_at: value.published_at || null,
        body: value.body,
      };
      const snapshotHash = createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('hex');
      const prior = this.db
        .prepare('SELECT * FROM research_manual_evidence WHERE id=?')
        .get(value.id);
      if (prior) {
        const decoded = this.decode(prior);
        if (
          decoded.code !== code ||
          decoded.thesis_id !== value.thesis_id ||
          decoded.thesis_revision !== value.thesis_revision ||
          decoded.relation !== value.relation ||
          decoded.note !== value.note ||
          decoded.snapshot_hash !== snapshotHash
        )
          throw new ThesisError(
            '동일 요청 식별자로 다른 자료를 추가할 수 없습니다.',
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
      if (
        this.db
          .prepare(
            'SELECT 1 FROM research_manual_evidence WHERE thesis_id=? AND snapshot_hash=? AND archived_at IS NULL',
          )
          .get(value.thesis_id, snapshotHash)
      )
        throw new ThesisError(
          '같은 링크·내용의 자료가 이미 연결되어 있습니다.',
          409,
        );
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO research_manual_evidence(
            id,code,thesis_id,thesis_revision,relation,source_type,title,url,source_name,published_at,body,note,source_status,snapshot_hash,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          value.id,
          code,
          value.thesis_id,
          value.thesis_revision,
          value.relation,
          value.source_type,
          value.title,
          value.url || null,
          value.source_name,
          value.published_at || null,
          value.body,
          value.note,
          'user_supplied',
          snapshotHash,
          now,
        );
      return this.decode(
        this.db
          .prepare('SELECT * FROM research_manual_evidence WHERE id=?')
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
        .prepare('SELECT * FROM research_manual_evidence WHERE code=? AND id=?')
        .get(code, id);
      if (!row)
        throw new ThesisError('직접 추가한 자료를 찾지 못했습니다.', 404);
      if ((row.archived_at !== null) === archived) return this.decode(row);
      if (
        !archived &&
        this.db
          .prepare(
            'SELECT 1 FROM research_manual_evidence WHERE thesis_id=? AND snapshot_hash=? AND archived_at IS NULL',
          )
          .get(row.thesis_id, row.snapshot_hash)
      )
        throw new ThesisError('같은 자료가 이미 연결되어 있습니다.', 409);
      this.db
        .prepare('UPDATE research_manual_evidence SET archived_at=? WHERE id=?')
        .run(archived ? new Date().toISOString() : null, id);
      return this.decode(
        this.db
          .prepare('SELECT * FROM research_manual_evidence WHERE id=?')
          .get(id)!,
      );
    });
  }
}
