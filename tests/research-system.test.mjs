import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ResearchSystemStore } from '../lib/server/research-system-store.ts';

const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-research-system-'));
  const owner = new ResearchStore(directory);
  owner.register(
    candidate,
    radar,
    JSON.parse(
      readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
    ),
  );
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    rmSync(resolved, { recursive: true });
  });
  return { owner, store: new ResearchSystemStore(owner.db) };
}

test('KPI observations and journal entries stay source-aware and archive recoverably', (t) => {
  const { store } = fixture(t);
  let snapshot = store.createKpi(candidate.code, {
    name: '가입자',
    unit: '만명',
    category: 'quantity',
    description: '매출 수량 변수',
  });
  const kpi = snapshot.kpis[0];
  snapshot = store.createObservation(candidate.code, {
    kpi_id: kpi.id,
    period: '2026 3Q',
    actual: 120,
    estimate: 115,
    source_label: '분기보고서',
    source_url: 'https://dart.fss.or.kr',
    note: '유료 가입자',
  });
  assert.equal(snapshot.kpis[0].observations[0].actual, 120);
  assert.equal(snapshot.kpis[0].observations[0].source_label, '분기보고서');
  snapshot = store.updateObservation(candidate.code, {
    id: snapshot.kpis[0].observations[0].id,
    period: '2026 3Q',
    actual: 123,
    estimate: 115,
    source_label: '분기보고서 정정',
    source_url: '',
    note: '정정',
  });
  assert.equal(snapshot.kpis[0].observations[0].actual, 123);
  snapshot = store.updateKpi(candidate.code, {
    id: kpi.id,
    name: '유료 가입자',
    unit: '만명',
    category: 'quantity',
    description: '수정된 정의',
  });
  assert.equal(snapshot.kpis[0].name, '유료 가입자');
  snapshot = store.createJournal(candidate.code, {
    kind: 'feedback',
    title: '세션 피드백',
    body: '가격 가정 재검토',
    occurred_at: '2026-09-04',
    source_url: '',
  });
  assert.equal(snapshot.journal[0].kind, 'feedback');
  snapshot = store.updateJournal(candidate.code, {
    id: snapshot.journal[0].id,
    kind: 'thesis_change',
    title: '논리 수정',
    body: '가격 가정 수정',
    occurred_at: '2026-09-05',
    source_url: '',
  });
  assert.equal(snapshot.journal[0].kind, 'thesis_change');
  snapshot = store.archive(candidate.code, 'journal', snapshot.journal[0].id);
  assert.equal(snapshot.journal.length, 0);
  assert.equal(snapshot.archived_journal.length, 1);
  snapshot = store.restore(
    candidate.code,
    'journal',
    snapshot.archived_journal[0].id,
  );
  assert.equal(snapshot.journal.length, 1);
  assert.equal(
    store.db
      .prepare(
        'SELECT count(*) AS count FROM research_journal_entries WHERE archived_at IS NOT NULL',
      )
      .get().count,
    0,
  );
});

test('learning records update and link to active watchlist stocks', (t) => {
  const { store } = fixture(t);
  let items = store.saveLearning({
    kind: 'book',
    title: 'Quality Investing',
    author: 'Test',
    status: 'reading',
    tags: ['quality'],
    summary: '요약',
    lessons: '배운 점',
    changed_view: '',
    applications: '',
    disagreements: '',
    source_url: '',
    linked_codes: [candidate.code],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].linked_stocks[0].code, candidate.code);
  items = store.saveLearning({
    ...items[0],
    linked_codes: [candidate.code],
    status: 'finished',
  });
  assert.equal(items[0].status, 'finished');
  store.archiveLearning(items[0].id);
  assert.equal(store.learning().length, 0);
  assert.equal(store.learning(true).length, 1);
  store.restoreLearning(items[0].id);
  assert.equal(store.learningForStock(candidate.code).length, 1);
});
