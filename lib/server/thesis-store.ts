import type { DatabaseSync } from 'node:sqlite';
import {
  emptyThesis,
  thesisConfig,
  thesisTitle,
  ThesisError,
  uuidPattern,
  validateThesisContent,
  type InvestmentThesis,
  type ThesisContent,
  type ThesisSummary,
} from '../investment-thesis.ts';

export class ThesisStore {
  db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  active(code: string) {
    if (!/^\d{6}$/.test(code))
      throw new ThesisError('종목코드를 확인해 주세요.');
    const record = this.db
      .prepare('SELECT active FROM watchlist WHERE code=?')
      .get(code);
    if (!record) throw new ThesisError('관심종목을 찾지 못했습니다.', 404);
    if (record.active !== 1)
      throw new ThesisError(
        '관심종목을 다시 등록한 후 작성해 주세요. 기존 글은 보존되어 있습니다.',
        409,
      );
  }
  decode(row: Record<string, unknown>): InvestmentThesis {
    if (
      !Number.isInteger(row.revision) ||
      Number(row.revision) < 1 ||
      ![0, 1].includes(Number(row.archived))
    )
      throw new Error('Invalid stored thesis');
    return {
      id: String(row.id),
      code: String(row.code),
      revision: Number(row.revision),
      archived: row.archived === 1,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      content: validateThesisContent(
        JSON.parse(String(row.content_json)),
        true,
      ),
    };
  }
  list(code: string) {
    this.active(code);
    return this.db
      .prepare(
        'SELECT * FROM investment_theses WHERE code=? ORDER BY archived,created_at,id',
      )
      .all(code)
      .map((row) => this.decode(row));
  }
  summary(code: string): ThesisSummary {
    const rows = this.db
      .prepare(
        'SELECT content_json FROM investment_theses WHERE code=? AND archived=0 ORDER BY created_at,id',
      )
      .all(code);
    return {
      count: rows.length,
      title: rows.length
        ? thesisTitle(
            validateThesisContent(
              JSON.parse(String(rows[0].content_json)),
              true,
            ),
          )
        : null,
    };
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  capacity(code: string) {
    const row = this.db
      .prepare(
        'SELECT count(*) AS count FROM investment_theses WHERE code=? AND archived=0',
      )
      .get(code)!;
    if (Number(row.count) >= thesisConfig.max_active_points)
      throw new ThesisError(
        `활성 투자포인트는 ${thesisConfig.max_active_points}개까지입니다. 사용하지 않는 포인트를 보관해 주세요.`,
        409,
      );
  }
  snapshot(id: string) {
    this.db
      .prepare(
        'INSERT INTO investment_thesis_revisions(thesis_id,revision,archived,saved_at,content_json) SELECT id,revision,archived,updated_at,content_json FROM investment_theses WHERE id=?',
      )
      .run(id);
  }
  // The caller must own the transaction (also used for atomic registration).
  createInTransaction(code: string, id: string, value: unknown) {
    this.active(code);
    if (!uuidPattern.test(id))
      throw new ThesisError('요청 식별자를 확인해 주세요.');
    const content = validateThesisContent(value);
    const existing = this.db
      .prepare('SELECT * FROM investment_theses WHERE id=?')
      .get(id);
    if (existing) {
      const first = this.db
        .prepare(
          'SELECT content_json FROM investment_thesis_revisions WHERE thesis_id=? AND revision=1',
        )
        .get(id);
      if (
        existing.code !== code ||
        first?.content_json !== JSON.stringify(content)
      )
        throw new ThesisError(
          '동일 요청 식별자로 다른 내용을 저장할 수 없습니다.',
          409,
        );
      return this.decode(existing);
    }
    this.capacity(code);
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO investment_theses(id,code,revision,archived,created_at,updated_at,content_json) VALUES(?,?,1,0,?,?,?)',
      )
      .run(id, code, now, now, JSON.stringify(content));
    this.snapshot(id);
    return this.decode(
      this.db.prepare('SELECT * FROM investment_theses WHERE id=?').get(id)!,
    );
  }
  create(code: string, id: string, content: unknown) {
    return this.transaction(() => this.createInTransaction(code, id, content));
  }
  initial(code: string, request: { id: string; reason: string }) {
    if (!request.reason.trim()) return;
    return this.createInTransaction(code, request.id, {
      ...emptyThesis(),
      body: request.reason,
    });
  }
  update(
    code: string,
    id: string,
    revision: number,
    change: { content?: ThesisContent; archived?: boolean },
  ) {
    return this.transaction(() =>
      this.updateInTransaction(code, id, revision, change),
    );
  }
  updateInTransaction(
    code: string,
    id: string,
    revision: number,
    change: { content?: ThesisContent; archived?: boolean },
  ) {
    this.active(code);
    if (
      !uuidPattern.test(id) ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      throw new ThesisError('저장 버전과 포인트 식별자를 확인해 주세요.');
    const row = this.db
      .prepare('SELECT * FROM investment_theses WHERE code=? AND id=?')
      .get(code, id);
    if (!row) throw new ThesisError('투자포인트를 찾지 못했습니다.', 404);
    const current = this.decode(row);
    if (current.revision !== revision)
      throw new ThesisError(
        '다른 화면에서 수정됐습니다. 입력은 유지했으니 최신 저장본과 비교해 주세요.',
        409,
      );
    if (current.archived && change.content)
      throw new ThesisError('보관된 포인트는 복구한 후 수정해 주세요.', 409);
    if (current.archived && change.archived === false) this.capacity(code);
    const content = change.content
      ? validateThesisContent(change.content)
      : current.content;
    const archived = change.archived ?? current.archived;
    if (
      JSON.stringify(content) === JSON.stringify(current.content) &&
      archived === current.archived
    )
      return current;
    this.db
      .prepare(
        'UPDATE investment_theses SET content_json=?,archived=?,revision=revision+1,updated_at=? WHERE id=?',
      )
      .run(
        JSON.stringify(content),
        Number(archived),
        new Date().toISOString(),
        id,
      );
    this.snapshot(id);
    return this.decode(
      this.db.prepare('SELECT * FROM investment_theses WHERE id=?').get(id)!,
    );
  }
}
