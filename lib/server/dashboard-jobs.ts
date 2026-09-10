import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  localStore,
  ResearchStore,
  researchDirectory,
  researchConfig,
} from './research-store.ts';
export const operationsConfig = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'research/operations-config.json'),
    'utf8',
  ),
);
export type JobKind = 'markets' | 'radar';
export function recoverInterrupted(db: ReturnType<typeof localStore>['db']) {
  const cutoff = new Date(
    Date.now() - operationsConfig.interrupted_after_seconds * 1000,
  ).toISOString();
  db.prepare(
    "UPDATE dashboard_jobs SET state='error',error='수집 응답이 끊겼습니다. 기존 결과는 유지됩니다.',step='중단 · 재시도 필요',finished_at=? WHERE state IN ('queued','running') AND updated_at<?",
  ).run(new Date().toISOString(), cutoff);
}
export function listDashboardJobs() {
  const store = localStore();
  try {
    recoverInterrupted(store.db);
    const stocks = store
      .list()
      .filter((item) => item.job)
      .map((item) => ({
        code: item.code,
        name: item.name,
        peer: false,
        ...item.job,
      }));
    let warning: string | undefined;
    const peersDirectory = path.join(researchDirectory, 'peers');
    if (existsSync(path.join(peersDirectory, researchConfig.database_name))) {
      try {
        const peers = new ResearchStore(peersDirectory);
        try {
          stocks.push(
            ...peers
              .list()
              .filter((item) => item.job)
              .map((item) => ({
                code: item.code,
                name: item.name,
                peer: true,
                ...item.job,
              })),
          );
        } finally {
          peers.close();
        }
      } catch {
        warning =
          '비교 기업의 수집 상태를 읽지 못했습니다. 비교 저장소를 확인해 주세요.';
      }
    }
    return {
      jobs: store.db
        .prepare(
          "SELECT * FROM dashboard_jobs WHERE state IN ('queued','running') OR id IN (SELECT id FROM dashboard_jobs ORDER BY started_at DESC LIMIT 12) ORDER BY started_at DESC",
        )
        .all(),
      stocks,
      warning,
    };
  } finally {
    store.close();
  }
}
export async function startDashboardJob(kind: JobKind) {
  const store = localStore(),
    id = randomUUID(),
    now = new Date().toISOString();
  try {
    store.db.exec('BEGIN IMMEDIATE');
    recoverInterrupted(store.db);
    const existing = store.db
      .prepare(
        "SELECT * FROM dashboard_jobs WHERE kind=? AND state IN ('queued','running')",
      )
      .get(kind);
    if (existing) {
      store.db.exec('COMMIT');
      return existing;
    }
    store.db
      .prepare(
        "INSERT INTO dashboard_jobs(id,kind,state,step,started_at,updated_at) VALUES(?,?,'queued','실행 준비',?,?)",
      )
      .run(id, kind, now, now);
    store.db.exec('COMMIT');
    const python =
      process.env[
        kind === 'radar'
          ? 'RADAR_PYTHON_EXECUTABLE'
          : 'MARKET_PYTHON_EXECUTABLE'
      ] ||
      path.join(
        process.cwd(),
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      );
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          /* turbopackIgnore: true */ python,
          ['-m', 'scripts.dashboard_job', '--id', id, '--kind', kind],
          {
            cwd: process.cwd(),
            detached: true,
            windowsHide: true,
            stdio: 'ignore',
            env: {
              ...process.env,
              RESEARCH_STORAGE_DIR: researchDirectory,
              PYTHONUTF8: '1',
              PYTHONUNBUFFERED: '1',
            },
          },
        );
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      });
    } catch {
      store.db
        .prepare(
          "UPDATE dashboard_jobs SET state='error',step='실행 실패',error='Python 실행 환경을 확인해 주세요.',finished_at=? WHERE id=?",
        )
        .run(now, id);
    }
    return store.db.prepare('SELECT * FROM dashboard_jobs WHERE id=?').get(id)!;
  } catch (error) {
    try {
      store.db.exec('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    store.close();
  }
}
