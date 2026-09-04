import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ResearchWorkbenchStore } from '../lib/server/research-workbench-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ManualEvidenceStore } from '../lib/server/manual-evidence-store.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';

const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-workbench-'));
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
      title: '해외 채널 확장',
      body: '해외 채널 확대가 매출 성장으로 이어지는지 확인한다.',
    },
  );
  new ManualEvidenceStore(owner.db).create(candidate.code, {
    id: randomUUID(),
    thesis_id: thesis.id,
    thesis_revision: thesis.revision,
    relation: 'context',
    source_type: 'news',
    title: '현지 매장 관련 기사',
    url: 'https://example.com/news/1',
    source_name: '테스트 매체',
    published_at: '2026-09-04',
    body: '사용자가 확인할 기사 문구',
    note: '',
  });
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    rmSync(resolved, { recursive: true });
  });
  return { owner, thesis };
}

test('workbench combines updates, thesis status, evidence and source launchers', (t) => {
  const { owner, thesis } = fixture(t);
  const store = new ResearchWorkbenchStore(owner.db);
  const initial = store.snapshot(owner.followups());
  assert.equal(initial.stocks.length, 1);
  assert.equal(initial.summary.thesis_count, 1);
  assert.equal(initial.summary.evidence_count, 1);
  assert.equal(initial.stocks[0].theses[0].evidence.manual, 1);
  assert.equal(initial.stocks[0].source_launchers.length, 5);
  assert.ok(initial.updates.length > 0);

  const update = initial.updates[0];
  const reviewed = store.setUpdate(owner.followups(), {
    item_key: update.key,
    status: 'reviewed',
    note: '원자료 확인',
  });
  assert.equal(reviewed.state, 'reviewed');
  assert.equal(reviewed.note, '원자료 확인');

  const status = store.setThesisStatus({
    code: candidate.code,
    thesis_id: thesis.id,
    state: 'weakened',
    note: '반대 자료 추가 확인',
  });
  assert.equal(status.state, 'weakened');
  const after = store.snapshot(owner.followups());
  assert.equal(after.stocks[0].theses[0].review.state, 'weakened');
  assert.equal(after.summary.thesis_states.weakened, 1);
});

test('workbench rejects unknown update keys and invalid thesis states', (t) => {
  const { owner, thesis } = fixture(t);
  const store = new ResearchWorkbenchStore(owner.db);
  assert.throws(
    () =>
      store.setUpdate(owner.followups(), {
        item_key: 'unknown',
        status: 'reviewed',
        note: '',
      }),
    { status: 404 },
  );
  assert.throws(
    () =>
      store.setThesisStatus({
        code: candidate.code,
        thesis_id: thesis.id,
        state: 'buy',
        note: '',
      }),
    { status: 400 },
  );
});

test('same financial period surfaces again when its stored values change', (t) => {
  const { owner } = fixture(t);
  const store = new ResearchWorkbenchStore(owner.db);
  const followup = owner.followups()[0];
  const row = owner.db
    .prepare('SELECT detail_json FROM watchlist WHERE code=?')
    .get(candidate.code);
  const detail = JSON.parse(row.detail_json);
  const quarter = {
    year: 2026,
    quarter: '2Q',
    label: '2026 2Q',
    op: 10,
    statement_basis: 'CFS',
    receipt_no: '20260814000001',
  };
  detail.quarters = [quarter];
  owner.db
    .prepare('UPDATE watchlist SET detail_json=? WHERE code=?')
    .run(JSON.stringify(detail), candidate.code);
  const input = {
    ...followup,
    checked_at: '2026-01-01T00:00:00.000Z',
    firstSections: [],
    sources: [],
    filings: { ...followup.filings, newCount: 0, preview: [] },
    financials: {
      ...followup.financials,
      changes: [
        { period: `${quarter.year} ${quarter.quarter}`, kind: 'revised' },
      ],
    },
  };
  const first = store
    .snapshot([input])
    .updates.find((item) => item.kind === 'financial').key;
  quarter.op = Number(quarter.op ?? 0) + 1;
  owner.db
    .prepare('UPDATE watchlist SET detail_json=? WHERE code=?')
    .run(JSON.stringify(detail), candidate.code);
  const second = store
    .snapshot([input])
    .updates.find((item) => item.kind === 'financial').key;
  assert.notEqual(first, second);
});
