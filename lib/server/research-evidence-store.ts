import type { DatabaseSync } from 'node:sqlite';
import { DocumentStore } from './document-store.ts';
import { ThesisStore } from './thesis-store.ts';
import {
  evidenceRelations,
  researchEvidenceConfig,
  type EvidenceRelation,
  type ResearchEvidence,
} from '../research-evidence.ts';
import { ThesisError, uuidPattern } from '../investment-thesis.ts';

type CreateEvidence = {
  id: string;
  thesis_id: string;
  thesis_revision: number;
  relation: EvidenceRelation;
  note: string;
  receipt: string;
  document_version: string;
  section_id: string;
  block_id: string;
};

export class ResearchEvidenceStore {
  db: DatabaseSync;
  directory: string;
  constructor(db: DatabaseSync, directory: string) {
    this.db = db;
    this.directory = directory;
  }
  decode(row: Record<string, unknown>): ResearchEvidence {
    const excerpt = JSON.parse(String(row.excerpt_json));
    if (
      !excerpt ||
      typeof excerpt !== 'object' ||
      typeof excerpt.text !== 'string' ||
      !Object.hasOwn(evidenceRelations, String(row.relation)) ||
      (row.archived_at !== null && typeof row.archived_at !== 'string')
    )
      throw new Error('Invalid stored research evidence');
    return {
      id: String(row.id),
      code: String(row.code),
      thesis_id: String(row.thesis_id),
      thesis_revision: Number(row.thesis_revision),
      relation: row.relation as EvidenceRelation,
      note: String(row.note),
      receipt: String(row.receipt),
      document_title: String(row.document_title),
      document_version: String(row.document_version),
      collected_at: String(row.document_collected_at),
      section_id: String(row.section_id),
      section_title: String(row.section_title),
      block_id: String(row.block_id),
      block_kind: row.block_kind as 'text' | 'table',
      source_path: String(row.source_path),
      excerpt,
      created_at: String(row.created_at),
      archived_at: row.archived_at as string | null,
    };
  }
  list(code: string, thesisId?: string, includeArchived = false) {
    new ThesisStore(this.db).active(code);
    if (thesisId && !uuidPattern.test(thesisId))
      throw new ThesisError('투자포인트 식별자를 확인해 주세요.');
    const where = [
      'e.code=?',
      ...(thesisId ? ['e.thesis_id=?'] : []),
      ...(includeArchived ? [] : ['e.archived_at IS NULL']),
    ];
    return this.db
      .prepare(
        `SELECT e.* FROM research_evidence e WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC,e.id DESC`,
      )
      .all(code, ...(thesisId ? [thesisId] : []))
      .map((row) => this.decode(row));
  }
  create(code: string, value: CreateEvidence) {
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
      !/^\d{14}$/.test(value.receipt) ||
      !value.document_version ||
      !value.section_id ||
      !value.block_id
    )
      throw new ThesisError('연결할 투자포인트와 원문 정보를 확인해 주세요.');
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
        .prepare('SELECT * FROM research_evidence WHERE id=?')
        .get(value.id);
      if (prior) {
        const decoded = this.decode(prior);
        if (
          decoded.code !== code ||
          decoded.thesis_id !== value.thesis_id ||
          decoded.thesis_revision !== value.thesis_revision ||
          decoded.relation !== value.relation ||
          decoded.note !== value.note ||
          decoded.receipt !== value.receipt ||
          decoded.document_version !== value.document_version ||
          decoded.section_id !== value.section_id ||
          decoded.block_id !== value.block_id
        )
          throw new ThesisError(
            '동일 요청 식별자로 다른 근거를 연결할 수 없습니다.',
            409,
          );
        return decoded;
      }
      const count = this.db
        .prepare(
          `SELECT
            (SELECT count(*) FROM research_evidence WHERE thesis_id=? AND archived_at IS NULL) +
            (SELECT count(*) FROM research_financial_evidence WHERE thesis_id=? AND archived_at IS NULL) +
            (SELECT count(*) FROM research_manual_evidence WHERE thesis_id=? AND archived_at IS NULL) AS count`,
        )
        .get(value.thesis_id, value.thesis_id, value.thesis_id)!;
      if (Number(count.count) >= researchEvidenceConfig.max_links_per_thesis)
        throw new ThesisError(
          `투자포인트당 연결 자료는 ${researchEvidenceConfig.max_links_per_thesis}개까지입니다. 사용하지 않는 연결을 먼저 해제해 주세요.`,
          409,
        );
      const duplicate = this.db
        .prepare(
          'SELECT * FROM research_evidence WHERE thesis_id=? AND receipt=? AND document_version=? AND block_id=? AND archived_at IS NULL',
        )
        .get(
          value.thesis_id,
          value.receipt,
          value.document_version,
          value.block_id,
        );
      if (duplicate)
        throw new ThesisError(
          '이 원문 위치는 선택한 투자포인트에 이미 연결되어 있습니다.',
          409,
        );
      const source = new DocumentStore(this.db, this.directory).sourceBlock(
        code,
        value.receipt,
        value.document_version,
        value.section_id,
        value.block_id,
      );
      const now = new Date().toISOString();
      const excerpt = {
        text: source.block.text,
        ...(source.block.rows ? { rows: source.block.rows } : {}),
      };
      this.db
        .prepare(
          'INSERT INTO research_evidence(id,code,thesis_id,thesis_revision,relation,note,receipt,document_title,document_version,document_collected_at,section_id,section_title,block_id,block_kind,source_path,excerpt_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          value.id,
          code,
          value.thesis_id,
          value.thesis_revision,
          value.relation,
          value.note,
          value.receipt,
          source.document.title,
          value.document_version,
          source.collected_at,
          value.section_id,
          source.section.title,
          value.block_id,
          source.block.kind,
          source.block.source_path,
          JSON.stringify(excerpt),
          now,
        );
      return this.decode(
        this.db
          .prepare('SELECT * FROM research_evidence WHERE id=?')
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
        .prepare('SELECT * FROM research_evidence WHERE code=? AND id=?')
        .get(code, id);
      if (!row) throw new ThesisError('연결 자료를 찾지 못했습니다.', 404);
      if ((row.archived_at !== null) === archived) return this.decode(row);
      if (!archived) {
        const duplicate = this.db
          .prepare(
            'SELECT 1 FROM research_evidence WHERE thesis_id=? AND receipt=? AND document_version=? AND block_id=? AND archived_at IS NULL',
          )
          .get(
            row.thesis_id,
            row.receipt,
            row.document_version,
            row.block_id,
          );
        if (duplicate)
          throw new ThesisError(
            '같은 원문 위치가 이미 연결되어 있습니다.',
            409,
          );
      }
      this.db
        .prepare('UPDATE research_evidence SET archived_at=? WHERE id=?')
        .run(archived ? new Date().toISOString() : null, id);
      return this.decode(
        this.db.prepare('SELECT * FROM research_evidence WHERE id=?').get(id)!,
      );
    });
  }
}
