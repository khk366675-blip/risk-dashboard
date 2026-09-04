import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ThesisError } from '../investment-thesis.ts';
import type {
  JournalEntry,
  JournalKind,
  KpiCategory,
  KpiObservation,
  LearningItem,
  LearningKind,
  LearningStatus,
  ResearchSystemSnapshot,
} from '../research-system.ts';

const categories = new Set<KpiCategory>([
  'price',
  'quantity',
  'cost',
  'business',
  'other',
]);
const journalKinds = new Set<JournalKind>([
  'insight',
  'question',
  'thesis_change',
  'feedback',
  'hold',
  'rejected',
  'revisit',
]);
const learningKinds = new Set<LearningKind>([
  'book',
  'lecture',
  'article',
  'other',
]);
const learningStatuses = new Set<LearningStatus>([
  'to_read',
  'reading',
  'finished',
]);
const clean = (
  value: unknown,
  limit: number,
  label: string,
  required = false,
) => {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    value.length > limit ||
    (required && !value.trim())
  )
    throw new ThesisError(`${label} 입력을 확인해 주세요.`);
  return value.trim();
};
const nullableUrl = (value: unknown) => {
  const url = clean(value ?? '', 1000, '출처 링크');
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
  } catch {
    throw new ThesisError('출처 링크는 http 또는 https 주소여야 합니다.');
  }
  return url;
};
const finite = (value: unknown) =>
  value === null || value === '' || value === undefined
    ? null
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : (() => {
          throw new ThesisError('KPI 수치는 유효한 숫자여야 합니다.');
        })();

export class ResearchSystemStore {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  private active(code: string) {
    if (!/^\d{6}$/.test(code))
      throw new ThesisError('종목코드를 확인해 주세요.');
    const row = this.db
      .prepare('SELECT active FROM watchlist WHERE code=?')
      .get(code);
    if (!row || row.active !== 1)
      throw new ThesisError('관심종목을 먼저 등록해 주세요.', 404);
  }
  snapshot(code: string): ResearchSystemSnapshot {
    this.active(code);
    const readKpis = (archived: boolean) =>
      this.db
        .prepare(
          `SELECT * FROM research_kpis WHERE code=? AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'} ORDER BY updated_at DESC`,
        )
        .all(code)
        .map((row) => ({
          id: String(row.id),
          code: String(row.code),
          name: String(row.name),
          unit: String(row.unit),
          category: String(row.category) as KpiCategory,
          description: String(row.description),
          created_at: String(row.created_at),
          updated_at: String(row.updated_at),
          observations: this.db
            .prepare(
              'SELECT * FROM research_kpi_observations WHERE kpi_id=? AND archived_at IS NULL ORDER BY period,created_at',
            )
            .all(String(row.id))
            .map((item) => this.observation(item)),
        }));
    const readJournal = (archived: boolean) =>
      this.db
        .prepare(
          `SELECT * FROM research_journal_entries WHERE code=? AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'} ORDER BY occurred_at DESC,created_at DESC`,
        )
        .all(code)
        .map((row) => this.journal(row));
    return {
      kpis: readKpis(false),
      archived_kpis: readKpis(true),
      journal: readJournal(false),
      archived_journal: readJournal(true),
      learning: this.learningForStock(code),
      generated_at: new Date().toISOString(),
    };
  }
  private observation(row: Record<string, unknown>): KpiObservation {
    return {
      id: String(row.id),
      period: String(row.period),
      actual: row.actual === null ? null : Number(row.actual),
      estimate: row.estimate === null ? null : Number(row.estimate),
      source_label: String(row.source_label),
      source_url: typeof row.source_url === 'string' ? row.source_url : null,
      note: String(row.note),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }
  private journal(row: Record<string, unknown>): JournalEntry {
    return {
      id: String(row.id),
      code: String(row.code),
      kind: String(row.kind) as JournalKind,
      title: String(row.title),
      body: String(row.body),
      occurred_at: String(row.occurred_at),
      source_url: typeof row.source_url === 'string' ? row.source_url : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }
  createKpi(code: string, value: Record<string, unknown>) {
    this.active(code);
    const category = value.category as KpiCategory;
    if (!categories.has(category))
      throw new ThesisError('KPI 분류를 확인해 주세요.');
    const now = new Date().toISOString(),
      id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO research_kpis(id,code,name,unit,category,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        code,
        clean(value.name, 80, 'KPI 이름', true),
        clean(value.unit, 30, '단위', true),
        category,
        clean(value.description ?? '', 500, '설명'),
        now,
        now,
      );
    return this.snapshot(code);
  }
  createObservation(code: string, value: Record<string, unknown>) {
    this.active(code);
    const kpiId = clean(value.kpi_id, 80, 'KPI 식별자', true);
    const kpi = this.db
      .prepare(
        'SELECT id FROM research_kpis WHERE id=? AND code=? AND archived_at IS NULL',
      )
      .get(kpiId, code);
    if (!kpi) throw new ThesisError('KPI를 찾지 못했습니다.', 404);
    const actual = finite(value.actual),
      estimate = finite(value.estimate);
    if (actual === null && estimate === null)
      throw new ThesisError('실제값이나 예상값 중 하나를 입력해 주세요.');
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO research_kpi_observations(id,kpi_id,period,actual,estimate,source_label,source_url,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        kpiId,
        clean(value.period, 30, '관측 기간', true),
        actual,
        estimate,
        clean(value.source_label ?? '', 120, '출처 이름', true),
        nullableUrl(value.source_url),
        clean(value.note ?? '', 1000, '메모'),
        now,
        now,
      );
    this.db
      .prepare('UPDATE research_kpis SET updated_at=? WHERE id=?')
      .run(now, kpiId);
    return this.snapshot(code);
  }
  updateKpi(code: string, value: Record<string, unknown>) {
    this.active(code);
    const id = clean(value.id, 80, 'KPI 식별자', true),
      category = value.category as KpiCategory;
    if (!categories.has(category))
      throw new ThesisError('KPI 분류를 확인해 주세요.');
    const result = this.db
      .prepare(
        'UPDATE research_kpis SET name=?,unit=?,category=?,description=?,updated_at=? WHERE id=? AND code=? AND archived_at IS NULL',
      )
      .run(
        clean(value.name, 80, 'KPI 이름', true),
        clean(value.unit, 30, '단위', true),
        category,
        clean(value.description ?? '', 500, '설명'),
        new Date().toISOString(),
        id,
        code,
      );
    if (!result.changes)
      throw new ThesisError('수정할 KPI를 찾지 못했습니다.', 404);
    return this.snapshot(code);
  }
  updateObservation(code: string, value: Record<string, unknown>) {
    this.active(code);
    const id = clean(value.id, 80, '관측값 식별자', true),
      actual = finite(value.actual),
      estimate = finite(value.estimate);
    if (actual === null && estimate === null)
      throw new ThesisError('실제값이나 예상값 중 하나를 입력해 주세요.');
    const result = this.db
      .prepare(
        `UPDATE research_kpi_observations SET period=?,actual=?,estimate=?,source_label=?,source_url=?,note=?,updated_at=? WHERE id=? AND archived_at IS NULL AND kpi_id IN (SELECT id FROM research_kpis WHERE code=?)`,
      )
      .run(
        clean(value.period, 30, '관측 기간', true),
        actual,
        estimate,
        clean(value.source_label ?? '', 120, '출처 이름', true),
        nullableUrl(value.source_url),
        clean(value.note ?? '', 1000, '메모'),
        new Date().toISOString(),
        id,
        code,
      );
    if (!result.changes)
      throw new ThesisError('수정할 관측값을 찾지 못했습니다.', 404);
    return this.snapshot(code);
  }
  createJournal(code: string, value: Record<string, unknown>) {
    this.active(code);
    const kind = value.kind as JournalKind;
    if (!journalKinds.has(kind))
      throw new ThesisError('로그 분류를 확인해 주세요.');
    const occurredAt = clean(
        value.occurred_at ?? new Date().toISOString().slice(0, 10),
        30,
        '기록일',
        true,
      ),
      now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO research_journal_entries(id,code,kind,title,body,occurred_at,source_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        code,
        kind,
        clean(value.title, 120, '제목', true),
        clean(value.body, 5000, '내용', true),
        occurredAt,
        nullableUrl(value.source_url),
        now,
        now,
      );
    return this.snapshot(code);
  }
  updateJournal(code: string, value: Record<string, unknown>) {
    this.active(code);
    const kind = value.kind as JournalKind;
    if (!journalKinds.has(kind))
      throw new ThesisError('로그 분류를 확인해 주세요.');
    const result = this.db
      .prepare(
        'UPDATE research_journal_entries SET kind=?,title=?,body=?,occurred_at=?,source_url=?,updated_at=? WHERE id=? AND code=? AND archived_at IS NULL',
      )
      .run(
        kind,
        clean(value.title, 120, '제목', true),
        clean(value.body, 5000, '내용', true),
        clean(value.occurred_at, 30, '기록일', true),
        nullableUrl(value.source_url),
        new Date().toISOString(),
        clean(value.id, 80, '로그 식별자', true),
        code,
      );
    if (!result.changes)
      throw new ThesisError('수정할 로그를 찾지 못했습니다.', 404);
    return this.snapshot(code);
  }
  archive(code: string, kind: 'kpi' | 'observation' | 'journal', id: string) {
    this.active(code);
    const now = new Date().toISOString();
    if (kind === 'kpi') {
      const found = this.db
        .prepare('SELECT id FROM research_kpis WHERE id=? AND code=?')
        .get(id, code);
      if (!found) throw new ThesisError('KPI를 찾지 못했습니다.', 404);
      this.db
        .prepare(
          'UPDATE research_kpis SET archived_at=?,updated_at=? WHERE id=?',
        )
        .run(now, now, id);
    } else if (kind === 'observation') {
      const found = this.db
        .prepare(
          'SELECT o.id FROM research_kpi_observations o JOIN research_kpis k ON k.id=o.kpi_id WHERE o.id=? AND k.code=?',
        )
        .get(id, code);
      if (!found) throw new ThesisError('관측값을 찾지 못했습니다.', 404);
      this.db
        .prepare(
          'UPDATE research_kpi_observations SET archived_at=?,updated_at=? WHERE id=?',
        )
        .run(now, now, id);
    } else {
      const found = this.db
        .prepare(
          'SELECT id FROM research_journal_entries WHERE id=? AND code=?',
        )
        .get(id, code);
      if (!found) throw new ThesisError('로그를 찾지 못했습니다.', 404);
      this.db
        .prepare(
          'UPDATE research_journal_entries SET archived_at=?,updated_at=? WHERE id=?',
        )
        .run(now, now, id);
    }
    return this.snapshot(code);
  }
  restore(code: string, kind: 'kpi' | 'journal', id: string) {
    this.active(code);
    const now = new Date().toISOString();
    const table = kind === 'kpi' ? 'research_kpis' : 'research_journal_entries';
    const result = this.db
      .prepare(
        `UPDATE ${table} SET archived_at=NULL,updated_at=? WHERE id=? AND code=? AND archived_at IS NOT NULL`,
      )
      .run(now, id, code);
    if (!result.changes)
      throw new ThesisError('복구할 기록을 찾지 못했습니다.', 404);
    return this.snapshot(code);
  }
  learning(includeArchived = false): LearningItem[] {
    return this.db
      .prepare(
        `SELECT * FROM learning_items WHERE archived_at IS ${includeArchived ? 'NOT NULL' : 'NULL'} ORDER BY CASE status WHEN 'reading' THEN 0 WHEN 'to_read' THEN 1 ELSE 2 END,updated_at DESC`,
      )
      .all()
      .map((row) => {
        const links = this.db
          .prepare(
            'SELECT l.code,w.name FROM learning_stock_links l JOIN watchlist w ON w.code=l.code WHERE l.learning_id=? ORDER BY w.name',
          )
          .all(String(row.id))
          .map((l) => ({ code: String(l.code), name: String(l.name) }));
        return {
          id: String(row.id),
          kind: String(row.kind) as LearningKind,
          title: String(row.title),
          author: String(row.author),
          status: String(row.status) as LearningStatus,
          started_at: row.started_at ? String(row.started_at) : null,
          finished_at: row.finished_at ? String(row.finished_at) : null,
          tags: JSON.parse(String(row.tags_json)) as string[],
          summary: String(row.summary),
          lessons: String(row.lessons),
          changed_view: String(row.changed_view),
          applications: String(row.applications),
          disagreements: String(row.disagreements),
          source_url: row.source_url ? String(row.source_url) : null,
          linked_stocks: links,
          created_at: String(row.created_at),
          updated_at: String(row.updated_at),
        };
      });
  }
  learningForStock(code: string) {
    return this.learning().filter((item) =>
      item.linked_stocks.some((stock) => stock.code === code),
    );
  }
  saveLearning(value: Record<string, unknown>) {
    const id =
      typeof value.id === 'string' && value.id ? value.id : randomUUID();
    const kind = value.kind as LearningKind,
      status = value.status as LearningStatus;
    if (!learningKinds.has(kind) || !learningStatuses.has(status))
      throw new ThesisError('학습 자료의 종류와 상태를 확인해 주세요.');
    const codes = Array.isArray(value.linked_codes)
      ? [
          ...new Set(
            value.linked_codes.filter(
              (c): c is string => typeof c === 'string' && /^\d{6}$/.test(c),
            ),
          ),
        ]
      : [];
    const tags = Array.isArray(value.tags)
      ? [
          ...new Set(
            value.tags
              .filter((t): t is string => typeof t === 'string')
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ].slice(0, 12)
      : [];
    const existing = this.db
        .prepare('SELECT created_at FROM learning_items WHERE id=?')
        .get(id),
      now = new Date().toISOString();
    const fields = [
      kind,
      clean(value.title, 160, '제목', true),
      clean(value.author ?? '', 100, '저자'),
      status,
      clean(value.started_at ?? '', 20, '시작일') || null,
      clean(value.finished_at ?? '', 20, '완료일') || null,
      JSON.stringify(tags),
      clean(value.summary ?? '', 5000, '요약'),
      clean(value.lessons ?? '', 5000, '배운 점'),
      clean(value.changed_view ?? '', 5000, '관점 변화'),
      clean(value.applications ?? '', 5000, '적용 아이디어'),
      clean(value.disagreements ?? '', 5000, '동의하지 않는 점'),
      nullableUrl(value.source_url),
      now,
    ];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (existing)
        this.db
          .prepare(
            'UPDATE learning_items SET kind=?,title=?,author=?,status=?,started_at=?,finished_at=?,tags_json=?,summary=?,lessons=?,changed_view=?,applications=?,disagreements=?,source_url=?,updated_at=? WHERE id=?',
          )
          .run(...fields, id);
      else
        this.db
          .prepare(
            'INSERT INTO learning_items(id,kind,title,author,status,started_at,finished_at,tags_json,summary,lessons,changed_view,applications,disagreements,source_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(id, ...fields.slice(0, -1), now, now);
      this.db
        .prepare('DELETE FROM learning_stock_links WHERE learning_id=?')
        .run(id);
      for (const code of codes)
        if (
          this.db
            .prepare('SELECT code FROM watchlist WHERE code=? AND active=1')
            .get(code)
        )
          this.db
            .prepare(
              'INSERT INTO learning_stock_links(learning_id,code,created_at) VALUES(?,?,?)',
            )
            .run(id, code, now);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.learning();
  }
  archiveLearning(id: string) {
    const result = this.db
      .prepare(
        'UPDATE learning_items SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL',
      )
      .run(new Date().toISOString(), new Date().toISOString(), id);
    if (!result.changes)
      throw new ThesisError('학습 기록을 찾지 못했습니다.', 404);
    return this.learning();
  }
  restoreLearning(id: string) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE learning_items SET archived_at=NULL,updated_at=? WHERE id=? AND archived_at IS NOT NULL',
      )
      .run(now, id);
    if (!result.changes)
      throw new ThesisError('복구할 학습 기록을 찾지 못했습니다.', 404);
    return this.learning();
  }
}
