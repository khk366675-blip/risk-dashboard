import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { FinancialEvidenceStore } from '../lib/server/financial-evidence-store.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';

const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-financial-evidence-'));
  const owner = new ResearchStore(directory);
  const stock = JSON.parse(
    readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
  );
  stock.research_run_id = 'research-run-1';
  stock.collected_at = '2026-09-04T00:00:00.000Z';
  stock.quarters = [
    {
      year: 2026,
      quarter: '2Q',
      label: '26 2Q',
      rev: 10_000_000_000,
      op: 800_000_000,
      op_margin_pct: 8,
      statement_basis: 'CFS',
      receipt_no: '20260814003108',
      source_url:
        'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003108',
    },
  ];
  stock.source_status.financials = {
    status: 'ok',
    source: 'OpenDART 전체 재무제표',
    as_of: '2026 2Q',
    collected_at: stock.collected_at,
    run_id: stock.research_run_id,
  };
  owner.register(candidate, radar, stock);
  const thesis = new ThesisStore(owner.db).create(
    candidate.code,
    randomUUID(),
    { ...emptyThesis(), body: '제품 믹스가 매출과 이익률에 미치는 영향' },
  );
  const evidence = new FinancialEvidenceStore(owner.db);
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
    note: '매출 규모 변화와 이익률을 함께 확인',
    metric: 'rev',
    year: 2026,
    quarter: '2Q',
    ...change,
  };
}

test('financial link snapshots a server-resolved value and source without changing review state', (t) => {
  const { owner, thesis, evidence } = fixture(t);
  const linked = evidence.create(candidate.code, request(thesis));
  assert.equal(linked.value, 100);
  assert.equal(linked.raw_value, 10_000_000_000);
  assert.equal(linked.unit, '억원');
  assert.equal(linked.statement_basis, 'CFS');
  assert.equal(linked.receipt_no, '20260814003108');
  assert.equal(linked.source_status.status, 'ok');
  assert.match(linked.snapshot_hash, /^[a-f0-9]{64}$/);
  assert.equal(owner.reviewBaseline(candidate.code), null);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    0,
  );
});

test('financial links validate revisions, deduplicate snapshots and retain changed observations', (t) => {
  const { owner, thesis, evidence } = fixture(t);
  const first = evidence.create(candidate.code, request(thesis));
  assert.throws(() => evidence.create(candidate.code, request(thesis)), {
    status: 409,
  });
  const record = owner.get(candidate.code);
  record.stock.quarters[0].rev = 12_000_000_000;
  owner.db
    .prepare('UPDATE watchlist SET detail_json=? WHERE code=?')
    .run(JSON.stringify(record.stock), candidate.code);
  const changed = evidence.create(candidate.code, request(thesis));
  assert.equal(changed.value, 120);
  assert.notEqual(changed.snapshot_hash, first.snapshot_hash);
  assert.equal(evidence.list(candidate.code, thesis.id).length, 2);
  const edited = new ThesisStore(owner.db).update(
    candidate.code,
    thesis.id,
    thesis.revision,
    { content: { ...thesis.content, body: '수정된 투자포인트' } },
  );
  assert.throws(
    () => evidence.create(candidate.code, request(thesis, { metric: 'op' })),
    { status: 409 },
  );
  assert.equal(edited.revision, 2);
  evidence.archive(candidate.code, first.id, true);
  assert.equal(evidence.list(candidate.code, thesis.id).length, 1);
  assert.equal(evidence.list(candidate.code, thesis.id, true).length, 2);
});
