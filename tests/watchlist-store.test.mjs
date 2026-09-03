import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResearchStore } from '../lib/server/research-store.ts';

const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];
const preview = JSON.parse(
  readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
);
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-watchlist-test-'));
  const store = new ResearchStore(directory);
  t.after(() => {
    store.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('value-watchlist-test-'));
    rmSync(resolved, { recursive: true });
  });
  return { store, directory };
}
test('registration persists and double clicks do not duplicate collection', (t) => {
  const { store, directory } = fixture(t);
  const first = store.register(candidate, radar, preview);
  const duplicate = store.register(candidate, radar, preview);
  assert.ok(first.jobId);
  assert.equal(duplicate.jobId, null);
  assert.equal(store.list().length, 1);
  const reopened = new ResearchStore(directory);
  try {
    assert.equal(reopened.get(candidate.code).item.job.job_id, first.jobId);
  } finally {
    reopened.close();
  }
});
test('unregister keeps collected data and a dropped Radar candidate remains stored', (t) => {
  const { store } = fixture(t);
  store.register(candidate, radar, preview);
  store.remove(candidate.code);
  assert.equal(store.list().length, 0);
  assert.equal(store.get(candidate.code).item.active, false);
  assert.deepEqual(store.get(candidate.code).stock, preview);
  assert.deepEqual(store.get(candidate.code).stock.radar, candidate);
});
test('one in-flight job per stock and stale worker cannot overwrite a new job', (t) => {
  const { store } = fixture(t);
  const first = store.register(candidate, radar, preview);
  assert.equal(store.queue(candidate.code, 'retry'), null);
  store.db
    .prepare(
      "UPDATE research_jobs SET updated_at='2000-01-01T00:00:00Z' WHERE code=?",
    )
    .run(candidate.code);
  assert.equal(store.get(candidate.code).item.job.state, 'error');
  const second = store.queue(candidate.code, 'retry');
  assert.notEqual(second, first.jobId);
  store.fail(candidate.code, first.jobId);
  assert.equal(store.get(candidate.code).item.job.state, 'queued');
});
test('corrupt saved JSON raises instead of silently resetting user state', (t) => {
  const { store } = fixture(t);
  store.register(candidate, radar, preview);
  store.db
    .prepare("UPDATE watchlist SET detail_json='broken' WHERE code=?")
    .run(candidate.code);
  assert.throws(() => store.register(candidate, radar, preview));
  assert.equal(
    store.db
      .prepare('SELECT detail_json FROM watchlist WHERE code=?')
      .get(candidate.code).detail_json,
    'broken',
  );
});

function collected(store) {
  const stock = {
    ...structuredClone(preview),
    data_level: 'research',
    events: [
      {
        id: 'receipt-1',
        date: '20260902',
        title: '사업보고서',
        url: 'https://dart.fss.or.kr/',
      },
    ],
    source_status: Object.fromEntries(
      ['prices', 'financials', 'dart_events'].map((key) => [
        key,
        { status: 'ok', collected_at: new Date().toISOString() },
      ]),
    ),
  };
  store.register(candidate, radar, stock);
  store.db
    .prepare("UPDATE research_jobs SET state='ready' WHERE code=?")
    .run(candidate.code);
  return stock;
}
test('confirmation is explicit, persistent and separate from collector data', (t) => {
  const { store, directory } = fixture(t);
  const stock = collected(store);
  const initial = store.followup(candidate.code);
  assert.equal(initial.checked_at, null);
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS count FROM watchlist_reviews').get()
      .count,
    0,
  );
  assert.equal(store.acknowledge(candidate.code, initial.revision), true);
  const reviewed = store.followup(candidate.code);
  assert.equal(reviewed.filings.newCount, 0);
  assert.ok(reviewed.checked_at);
  assert.deepEqual(store.get(candidate.code).stock, stock);
  const reopened = new ResearchStore(directory);
  try {
    assert.equal(
      reopened.followup(candidate.code).checked_at,
      reviewed.checked_at,
    );
  } finally {
    reopened.close();
  }
  store.remove(candidate.code);
  assert.equal(store.followups().length, 0);
  assert.ok(store.reviewBaseline(candidate.code));
});
test('a concurrent source update or another confirmation invalidates the displayed revision', (t) => {
  const { store } = fixture(t);
  const stock = collected(store);
  const old = store.followup(candidate.code);
  stock.events.push({
    id: 'receipt-2',
    date: '20260903',
    title: '유상증자결정',
  });
  store.db
    .prepare('UPDATE watchlist SET detail_json=? WHERE code=?')
    .run(JSON.stringify(stock), candidate.code);
  assert.equal(store.acknowledge(candidate.code, old.revision), false);
  assert.equal(store.reviewBaseline(candidate.code), null);
  const latest = store.followup(candidate.code);
  assert.equal(store.acknowledge(candidate.code, latest.revision), true);
  assert.equal(store.acknowledge(candidate.code, latest.revision), false);
  store.queue(candidate.code, 'all');
  const running = store.followup(candidate.code);
  assert.equal(store.acknowledge(candidate.code, running.revision), false);
});
test('existing databases migrate additively; malformed review data is not reset', (t) => {
  const { store, directory } = fixture(t);
  collected(store);
  store.db.exec('DROP TABLE watchlist_reviews'); // Only the isolated, test-created table.
  const reopened = new ResearchStore(directory);
  try {
    const current = reopened.followup(candidate.code);
    assert.equal(current.filings.total, 1);
    assert.equal(reopened.acknowledge(candidate.code, current.revision), true);
    reopened.db
      .prepare("UPDATE watchlist_reviews SET baseline_json='{}' WHERE code=?")
      .run(candidate.code);
    assert.throws(() => reopened.followup(candidate.code));
    assert.equal(
      reopened.db
        .prepare('SELECT baseline_json FROM watchlist_reviews WHERE code=?')
        .get(candidate.code).baseline_json,
      '{}',
    );
  } finally {
    reopened.close();
  }
});
