import { ResearchSystemStore } from './research-system-store.ts';
import { ResearchStore } from './research-store.ts';
import { buildLocalMobileSnapshot } from './local-mobile-snapshot.ts';
import {
  markRemoteNoteConsumed,
  mobileCloudEnv,
  publishRemoteSnapshot,
  readRemoteNotes,
} from './mobile-cloud-rest.ts';

export type MobilePublishResult = {
  generated_at: string;
  watchlist_count: number;
  learning_count: number;
  bytes: number;
};

export type MobilePullResult = {
  imported_count: number;
  skipped_count: number;
  imported: string[];
  skipped: { id: string; reason: string }[];
};

function requireMobileCloudEnv() {
  const env = mobileCloudEnv();
  if (!env)
    throw new Error(
      'Supabase 연결값이 없습니다. .env.local의 SUPABASE_URL과 SUPABASE_SECRET_KEY를 확인하세요.',
    );
  return env;
}

export async function publishLocalMobileSnapshot(): Promise<MobilePublishResult> {
  const env = requireMobileCloudEnv();
  const snapshot = buildLocalMobileSnapshot();
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  await publishRemoteSnapshot(env, snapshot);
  return {
    generated_at: snapshot.generated_at,
    watchlist_count: snapshot.stocks.length,
    learning_count: snapshot.learning.length,
    bytes,
  };
}

export async function pullRemoteMobileNotes(): Promise<MobilePullResult> {
  const env = requireMobileCloudEnv();
  const notes = await readRemoteNotes(env, true);
  const owner = new ResearchStore();
  const imported: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  try {
    const system = new ResearchSystemStore(owner.db);
    for (const note of notes.reverse()) {
      const record = owner.get(note.code);
      if (!record?.item.active) {
        skipped.push({ id: note.id, reason: '현재 관심종목이 아님' });
        continue;
      }
      const exists = owner.db
        .prepare('SELECT id FROM research_journal_entries WHERE id=?')
        .get(note.id);
      if (!exists) {
        const now = new Date().toISOString();
        owner.db
          .prepare(
            'INSERT INTO research_journal_entries(id,code,kind,title,body,occurred_at,source_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .run(
            note.id,
            note.code,
            'insight',
            '모바일 메모',
            note.body,
            note.created_at.slice(0, 10),
            null,
            note.created_at,
            now,
          );
      }
      await markRemoteNoteConsumed(env, note.id, new Date().toISOString());
      imported.push(note.id);
      system.snapshot(note.code);
    }
  } finally {
    owner.close();
  }
  return {
    imported_count: imported.length,
    skipped_count: skipped.length,
    imported,
    skipped,
  };
}
