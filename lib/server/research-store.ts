import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  buildFollowup,
  checkpointFor,
  type ReviewBaseline,
  type FollowupConfig,
} from '../research-followup.ts';
import type { RadarCandidate, RadarRun } from '../radar-run';
import type { StockDetail } from '../stock-detail';
import type { ResearchRecord, WatchlistItem } from '../watchlist';
import { ThesisStore } from './thesis-store.ts';

export const researchConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), 'research/config.json'), 'utf8'),
) as FollowupConfig & {
  storage_dir: string;
  database_name: string;
  preview_dir: string;
  listing_path: string;
  manual_search_limit: number;
  job_timeout_ms: number;
  poll_interval_ms: number;
};
export const researchDirectory = path.resolve(
  /* turbopackIgnore: true */
  process.cwd(),
  process.env.RESEARCH_STORAGE_DIR || researchConfig.storage_dir,
);

export class ResearchStore {
  db: DatabaseSync;
  constructor(directory = researchDirectory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(
      path.join(directory, researchConfig.database_name),
    );
    this.db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;',
    );
    this.db.exec(
      readFileSync(path.join(process.cwd(), 'research/schema.sql'), 'utf8'),
    );
  }
  close() {
    this.db.close();
  }
  get(code: string): ResearchRecord | null {
    const row = this.db
      .prepare(
        'SELECT w.*, j.job_id, j.state, j.step, j.error, j.updated_at FROM watchlist w LEFT JOIN research_jobs j ON j.code=w.code WHERE w.code=?',
      )
      .get(code);
    if (!row) return null;
    let state = row.state as NonNullable<WatchlistItem['job']>['state'];
    const interrupted =
      ['queued', 'running'].includes(state) &&
      Date.now() - Date.parse(String(row.updated_at)) >
        researchConfig.job_timeout_ms;
    if (interrupted) state = 'error';
    return {
      item: {
        code: String(row.code),
        name: String(row.name),
        added_at: String(row.added_at),
        active: row.active === 1,
        thesis: new ThesisStore(this.db).summary(code),
        job: row.job_id
          ? {
              job_id: String(row.job_id),
              state,
              step: interrupted
                ? '수집 응답이 끊겼습니다. 재시도해 주세요.'
                : String(row.step),
              error: interrupted
                ? '수집 제한 시간 초과'
                : (row.error as string | null),
              updated_at: String(row.updated_at),
            }
          : null,
      },
      stock: JSON.parse(String(row.detail_json)) as StockDetail,
    };
  }
  list(): WatchlistItem[] {
    return this.db
      .prepare(
        'SELECT code FROM watchlist WHERE active=1 ORDER BY added_at DESC, code',
      )
      .all()
      .map((row) => this.get(String(row.code))!.item);
  }
  reviewBaseline(code: string): ReviewBaseline | null {
    const row = this.db
      .prepare('SELECT baseline_json FROM watchlist_reviews WHERE code=?')
      .get(code);
    if (!row) return null;
    const baseline = JSON.parse(String(row.baseline_json)) as ReviewBaseline;
    if (
      !baseline ||
      typeof baseline.checked_at !== 'string' ||
      (baseline.events !== null && !Array.isArray(baseline.events?.keys)) ||
      (baseline.financials !== null &&
        (!baseline.financials?.quarters ||
          typeof baseline.financials.quarters !== 'object')) ||
      (baseline.price !== null && !(baseline.price?.close > 0))
    ) {
      throw new Error('저장된 확인 기준을 읽지 못했습니다.');
    }
    return baseline;
  }
  followup(code: string) {
    const record = this.get(code);
    if (!record?.item.active) return null;
    const baseline = this.reviewBaseline(code);
    // Writing a thesis is not a change to the source-data review checkpoint.
    const { thesis: _thesis, ...sourceItem } = record.item;
    const revision = createHash('sha256')
      .update(JSON.stringify([{ ...record, item: sourceItem }, baseline]))
      .digest('hex');
    return buildFollowup(record, baseline, revision, researchConfig);
  }
  followups() {
    return this.db
      .prepare(
        'SELECT code FROM watchlist WHERE active=1 ORDER BY added_at DESC, code',
      )
      .all()
      .map((row) => this.followup(String(row.code))!);
  }
  acknowledge(code: string, revision: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.followup(code);
      if (!current || current.revision !== revision || !current.canReview) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const now = new Date().toISOString();
      const baseline = checkpointFor(
        this.get(code)!.stock,
        this.reviewBaseline(code),
        now,
      );
      this.db
        .prepare(
          'INSERT INTO watchlist_reviews(code,checked_at,baseline_json) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET checked_at=excluded.checked_at,baseline_json=excluded.baseline_json',
        )
        .run(code, now, JSON.stringify(baseline));
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  register(
    candidate: RadarCandidate,
    radar: RadarRun,
    preview: StockDetail,
    initialThesis?: { id: string; reason: string },
  ): { record: ResearchRecord; jobId: string | null } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(candidate.code);
      if (existing?.item.active) {
        if (initialThesis)
          new ThesisStore(this.db).initial(candidate.code, initialThesis);
        this.db.exec('COMMIT');
        return { record: this.get(candidate.code)!, jobId: null };
      }
      this.db
        .prepare(
          'INSERT INTO watchlist(code,name,candidate_json,radar_run_id,radar_as_of,added_at,active,detail_json) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(code) DO UPDATE SET active=1',
        )
        .run(
          candidate.code,
          candidate.name,
          JSON.stringify(candidate),
          radar.run_id,
          radar.as_of,
          new Date().toISOString(),
          JSON.stringify(preview),
        );
      const jobId = this.enqueue(candidate.code, 'all');
      // Explicit new writing is appended; request IDs deduplicate retries.
      // Re-registration never overwrites an existing point.
      if (initialThesis)
        new ThesisStore(this.db).initial(candidate.code, initialThesis);
      this.db.exec('COMMIT');
      return { record: this.get(candidate.code)!, jobId };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  enqueue(code: string, mode: 'all' | 'retry'): string | null {
    const row = this.get(code);
    if (!row?.item.active) throw new Error('관심종목 등록이 필요합니다.');
    if (row.item.job && ['queued', 'running'].includes(row.item.job.state))
      return null;
    const jobId = randomUUID();
    this.db
      .prepare(
        "INSERT INTO research_jobs(code,job_id,state,mode,step,updated_at) VALUES(?,?,'queued',?,'자료 수집을 준비합니다.',?) ON CONFLICT(code) DO UPDATE SET job_id=excluded.job_id,state=excluded.state,mode=excluded.mode,step=excluded.step,error=NULL,pid=NULL,updated_at=excluded.updated_at",
      )
      .run(code, jobId, mode, new Date().toISOString());
    return jobId;
  }
  queue(code: string, mode: 'all' | 'retry') {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = this.enqueue(code, mode);
      this.db.exec('COMMIT');
      return id;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  remove(code: string) {
    this.db.prepare('UPDATE watchlist SET active=0 WHERE code=?').run(code);
  }
  fail(code: string, jobId: string) {
    this.db
      .prepare(
        "UPDATE research_jobs SET state='error',step='수집기를 시작하지 못했습니다.',error='수집기 실행 환경을 확인해 주세요.',updated_at=? WHERE code=? AND job_id=? AND state IN ('queued','running')",
      )
      .run(new Date().toISOString(), code, jobId);
  }
}

export function localStore() {
  if (process.env.VERCEL)
    throw new Error(
      '관심종목은 현재 로컬에서 지원됩니다. 배포용 저장소와 수집기 연결이 필요합니다.',
    );
  return new ResearchStore();
}
