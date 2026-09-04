import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ManualEvidenceStore } from '../lib/server/manual-evidence-store.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';

const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-manual-evidence-'));
  const owner = new ResearchStore(directory);
  const stock = JSON.parse(
    readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
  );
  owner.register(candidate, radar, stock);
  const thesis = new ThesisStore(owner.db).create(
    candidate.code,
    randomUUID(),
    {
      ...emptyThesis(),
      body: '신제품이 해외 매출 성장을 견인하는지 확인한다.',
    },
  );
  const evidence = new ManualEvidenceStore(owner.db);
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    rmSync(resolved, { recursive: true });
  });
  return { owner, thesis, evidence };
}

function request(thesis, change = {}) {
  return {
    id: randomUUID(),
    thesis_id: thesis.id,
    thesis_revision: thesis.revision,
    relation: 'supports',
    source_type: 'news',
    title: '해외 신규 매장 확대 기사',
    url: 'https://example.com/article/1',
    source_name: '테스트 경제지',
    published_at: '2026-09-04',
    body: '사용자가 직접 기록한 핵심 내용',
    note: '다음 분기 해외 매출과 함께 확인',
    ...change,
  };
}

test('manual evidence preserves the user snapshot without fetching or changing review state', (t) => {
  const { owner, thesis, evidence } = fixture(t);
  const before = new ThesisStore(owner.db).list(candidate.code)[0];
  const item = evidence.create(candidate.code, request(thesis));
  assert.equal(item.source_type, 'news');
  assert.equal(item.source_status, 'user_supplied');
  assert.equal(item.body, '사용자가 직접 기록한 핵심 내용');
  assert.equal(item.thesis_revision, 1);
  assert.match(item.snapshot_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(new ThesisStore(owner.db).list(candidate.code)[0], before);
  assert.equal(owner.reviewBaseline(candidate.code), null);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    0,
  );
});

test('manual evidence validates URLs and revisions, deduplicates and archives recoverably', (t) => {
  const { owner, thesis, evidence } = fixture(t);
  const saved = evidence.create(candidate.code, request(thesis));
  assert.throws(() => evidence.create(candidate.code, request(thesis)), {
    status: 409,
  });
  assert.throws(
    () =>
      evidence.create(
        candidate.code,
        request(thesis, { url: 'file:///tmp/a' }),
      ),
    { status: 400 },
  );
  assert.throws(
    () =>
      evidence.create(candidate.code, request(thesis, { url: '', body: '' })),
    { status: 400 },
  );
  const edited = new ThesisStore(owner.db).update(
    candidate.code,
    thesis.id,
    thesis.revision,
    { content: { ...thesis.content, body: '수정한 투자포인트' } },
  );
  assert.equal(edited.revision, 2);
  assert.throws(
    () =>
      evidence.create(candidate.code, request(thesis, { title: '다른 자료' })),
    { status: 409 },
  );
  evidence.archive(candidate.code, saved.id, true);
  assert.equal(evidence.list(candidate.code, thesis.id).length, 0);
  assert.equal(evidence.list(candidate.code, thesis.id, true).length, 1);
});
