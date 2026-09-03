import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFollowup,
  checkpointFor,
  parseDetailTab,
} from '../lib/research-followup.ts';

const config = {
  followup_stale_hours: 72,
  followup_price_points: 30,
  followup_event_preview_limit: 6,
};
const now = '2026-09-03T07:00:00.000Z';
function fixture() {
  return {
    item: {
      code: '000001',
      name: '테스트 종목',
      active: true,
      added_at: now,
      job: { state: 'ready' },
    },
    stock: {
      data_level: 'research',
      events: [
        {
          id: 'receipt-1',
          date: '20260801',
          title: '사업보고서',
          url: 'https://dart.fss.or.kr/',
          importance: null,
        },
      ],
      quarters: [
        {
          year: 2025,
          quarter: '2Q',
          label: '25 2Q',
          rev: 100,
          op: -10,
          ocf: 0,
          statement_basis: 'CFS',
        },
        {
          year: 2026,
          quarter: '2Q',
          label: '26 2Q',
          rev: 120,
          op: 20,
          ocf: -5,
          statement_basis: 'CFS',
        },
      ],
      prices: [
        { date: '2026-09-01', close: 10000, volume: 1000 },
        { date: '2026-09-02', close: 12000, volume: 1500 },
      ],
      source_status: Object.fromEntries(
        ['prices', 'financials', 'dart_events'].map((key) => [
          key,
          {
            status: 'ok',
            collected_at: now,
            as_of: key === 'financials' ? '2026 2Q' : '2026-09-02',
            run_id: 'run-1',
          },
        ]),
      ),
    },
  };
}
const view = (record, baseline = null, clock = Date.parse(now)) =>
  buildFollowup(record, baseline, 'revision', config, clock);
test('first visit distinguishes historical coverage from new data and never mutates', () => {
  const record = fixture();
  const before = JSON.stringify(record);
  const result = view(record);
  assert.equal(result.filings.total, 1);
  assert.equal(result.filings.newCount, null);
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.firstSections, ['공시', '재무', '가격']);
  assert.equal(result.canReview, true);
  assert.equal(JSON.stringify(record), before);
});
test('unchanged refresh does not create financial revisions, but new receipt IDs do', () => {
  const record = fixture();
  const baseline = checkpointFor(record.stock, null, now);
  record.stock.quarters[1].collected_at = '2026-09-04T07:00:00Z';
  assert.equal(view(record, baseline).hasChanges, false);
  record.stock.events.push({
    ...record.stock.events[0],
    id: 'receipt-2',
    title: '[기재정정]사업보고서',
  });
  const result = view(record, baseline);
  assert.equal(result.filings.newCount, 1);
  assert.equal(result.filings.focusCount, 1);
  assert.deepEqual(
    result.filings.preview.map((e) => e.id),
    ['receipt-2'],
  );
});
test('backfilled filings on old dates are additions, rolling-window removals are not completion', () => {
  const record = fixture();
  const baseline = checkpointFor(record.stock, null, now);
  record.stock.events = [];
  const rolled = checkpointFor(record.stock, baseline, now);
  assert.deepEqual(rolled.events.keys, ['receipt-1']);
  record.stock.events.push({
    id: 'receipt-old',
    date: '20200101',
    title: '새로 수집한 과거 공시',
  });
  assert.equal(view(record, rolled).filings.newCount, 1);
  record.stock.events = fixture().stock.events;
  assert.equal(view(record, rolled).filings.newCount, 0);
});
test('new quarters and same-period changes are separate, missing is never zero', () => {
  const record = fixture();
  const baseline = checkpointFor(record.stock, null, now);
  record.stock.quarters[1].ocf = null;
  record.stock.quarters.push({
    year: 2026,
    quarter: '3Q',
    rev: 140,
    statement_basis: 'CFS',
  });
  assert.deepEqual(view(record, baseline).financials.changes, [
    { period: '2026 2Q', kind: 'revised' },
    { period: '2026 3Q', kind: 'new' },
  ]);
  assert.equal(
    view(record, baseline).financials.metrics.find((m) => m.key === 'ocf')
      .value,
    null,
  );
});
test('financial YoY requires positive prior value and the same statement basis', () => {
  const record = fixture();
  const metrics = view(record).financials.metrics;
  assert.ok(Math.abs(metrics[0].yoy - 20) < 1e-10);
  assert.equal(metrics[1].yoy, null);
  assert.equal(metrics[2].yoy, null);
  record.stock.quarters[0].statement_basis = 'OFS';
  assert.equal(view(record).financials.metrics[0].yoy, null);
});
test('prices remain actual and compare with stored confirmation close, not base 100', () => {
  const record = fixture();
  const baseline = checkpointFor(record.stock, null, now);
  record.stock.prices.push({ date: '2026-09-03', close: 9000, volume: 2000 });
  const result = view(record, baseline);
  assert.equal(result.price.close, 9000);
  assert.equal(result.price.sinceReview, -25);
  assert.deepEqual(
    result.price.series.map((p) => p.close),
    [10000, 12000, 9000],
  );
  assert.equal(result.hasChanges, false); // Price activity is not a filing/financial notification.
  record.stock.prices = [{ date: '2026-09-01', close: 10000, volume: 1000 }];
  assert.equal(view(record, baseline).price.sinceReview, null);
});
test('failed source checkpoints are preserved and attention survives acknowledgment', () => {
  const record = fixture();
  const baseline = checkpointFor(record.stock, null, now);
  record.stock.source_status.dart_events.status = 'error';
  record.stock.events.push({
    id: 'unacknowledged',
    date: '20260903',
    title: '주요사항보고서',
  });
  const next = checkpointFor(record.stock, baseline, '2026-09-04T07:00:00Z');
  assert.deepEqual(next.events, baseline.events);
  assert.equal(view(record, next).filings.newCount, 1);
  assert.equal(view(record, next).needsAttention, true);
  for (const source of Object.values(record.stock.source_status))
    source.status = 'error';
  assert.equal(view(record, next).canReview, false);
});
test('missing, stale and future collection times are visible; running/preview cannot be acknowledged', () => {
  const record = fixture();
  assert.equal(view(record).needsAttention, false);
  assert.equal(
    view(record, null, Date.parse(now) + 73 * 3600000).needsAttention,
    true,
  );
  delete record.stock.source_status.prices.collected_at;
  assert.equal(view(record).sources[0].stale, true);
  record.stock.source_status.prices.collected_at = '2099-01-01T00:00:00Z';
  assert.equal(view(record).sources[0].stale, true);
  record.item.job.state = 'running';
  assert.equal(view(record).canReview, false);
  record.item.job.state = 'ready';
  record.stock.data_level = 'preview';
  assert.equal(view(record).canReview, false);
});
test('detail tab links whitelist valid sections and reject repeated/unknown query values', () => {
  for (const value of ['price', 'events', 'financials'])
    assert.equal(parseDetailTab(value), value);
  for (const value of [
    undefined,
    ['events', 'price'],
    'sources',
    'javascript:alert(1)',
  ])
    assert.equal(parseDetailTab(value), 'overview');
});
