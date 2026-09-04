import type { DatabaseSync } from 'node:sqlite';
import policy from '../../research/ai-request-policy.json' with { type: 'json' };
import { ThesisError } from '../investment-thesis.ts';

export class AiRequestGate {
  readonly db: DatabaseSync;
  readonly now: typeof Date.now;
  constructor(db: DatabaseSync, now = Date.now) {
    this.db = db;
    this.now = now;
  }
  // Caller owns BEGIN IMMEDIATE, so separate processes cannot reserve together.
  reserve(id: string, kind: string) {
    const now = this.now();
    if (
      this.db
        .prepare(
          'SELECT id FROM ai_request_attempts WHERE finished_at IS NULL AND lease_until>?',
        )
        .get(now)
    )
      throw new ThesisError(
        '다른 AI 요청이 진행 중입니다. 완료 후 다시 실행해 주세요.',
        429,
      );
    const recent = this.db
      .prepare(
        'SELECT count(*) AS n FROM ai_request_attempts WHERE started_at>?',
      )
      .get(now - policy.window_ms)!;
    if (Number(recent.n) >= policy.max_requests_per_hour)
      throw new ThesisError(
        `이 저장소의 시간당 AI 요청 한도(${policy.max_requests_per_hour}회)에 도달했습니다.`,
        429,
      );
    this.db
      .prepare(
        'INSERT INTO ai_request_attempts(id,kind,started_at,lease_until) VALUES(?,?,?,?)',
      )
      .run(id, kind, now, now + policy.lease_ms);
  }
  finish(id: string) {
    this.db
      .prepare('UPDATE ai_request_attempts SET finished_at=? WHERE id=?')
      .run(this.now(), id);
  }
}
