import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildEvidencePacket,
  aiInput,
  validateExplanation,
} from '../lib/evidence-explanation.ts';
import {
  EvidenceAiService,
  EvidenceAiError,
  packetRevision,
} from '../lib/server/evidence-ai-service.ts';

const config = JSON.parse(readFileSync('research/evidence-ai.json', 'utf8'));
const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
// Latest screening may legitimately have zero Quality candidates. Use an
// existing immutable preview for the unit fixture, not a current pass condition.
const preview = readdirSync('public/data/radar/stocks').filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(`public/data/radar/stocks/${n}`,'utf8'))).find(stock=>stock.radar?.lenses?.quality?.matched && stock.radar.lenses.quality.evidence.length);
assert.ok(preview, 'saved Quality evidence fixture exists');
const now = Date.parse('2026-09-03T08:00:00Z');
const packet = () =>
  buildEvidencePacket(structuredClone(preview), 'quality', config, now);
const answer = (source = packet()) => ({
  status: 'grounded',
  claims: [
    {
      source_ids: [source.facts[0].id],
      explanation:
        '수집된 현금흐름은 회계 이익과 현금 유입의 차이를 대조하는 출발점입니다.',
      question:
        '운전자본 변동이 일시적인 영향을 주었는지 원문에서 확인할 수 있나요?',
    },
  ],
});
const response = (value = answer()) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(value) }],
        },
      ],
      usage: { input_tokens: 500, output_tokens: 100 },
    }),
    { status: 200 },
  );
function directory(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'value-evidence-test-'));
  t.after(() => {
    assert.equal(path.dirname(realpathSync(dir)), realpathSync(tmpdir()));
    assert.ok(path.basename(dir).startsWith('value-evidence-test-'));
    rmSync(dir, { recursive: true });
  });
  return dir;
}

test('published candidates retain numeric values and never change Radar decisions', () => {
  const before = JSON.stringify(radar);
  for (const candidate of radar.candidates) {
    const stock = JSON.parse(
      readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
    );
    for (const lens of candidate.matched_lenses) {
      const prepared = buildEvidencePacket(stock, lens, config, now);
      assert.equal(prepared.status, 'available');
      for (const fact of prepared.facts) {
        const original = stock.radar.lenses[lens].evidence.find(
          (e) => e.key === fact.key,
        );
        if (typeof original.value === 'number')
          assert.equal(fact.value, original.value);
        assert.ok(fact.source && fact.period && fact.meaning);
      }
    }
  }
  assert.equal(JSON.stringify(radar), before);
});
test('unknown, missing and nonfinite evidence is visible and not invented', () => {
  const stock = structuredClone(preview);
  const evidence = stock.radar.lenses.quality.evidence[0];
  stock.radar.lenses.quality.evidence = [
    { ...evidence, value: NaN },
    { ...evidence, key: 'unknown', value: 1 },
    { ...evidence, source: '' },
  ];
  const result = buildEvidencePacket(stock, 'quality', config, now);
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.facts.length, 0);
  assert.ok(result.missing.length >= 3);
});
test('historical, mismatched and untraceable runs stay explicit', () => {
  const stock = structuredClone(preview);
  stock.research_run_id = 'new-enrichment';
  stock.radar.as_of = '2020-01-01';
  stock.radar.contradictions = ['기록된 반대 근거'];
  const result = buildEvidencePacket(stock, 'quality', config, now);
  assert.ok(result.warnings.some((v) => v.includes('이전 시점')));
  assert.ok(result.warnings.some((v) => v.includes('최신 재무로 다시')));
  assert.ok(result.contradictions.includes('기록된 반대 근거'));
  delete stock.run_id;
  assert.equal(
    buildEvidencePacket(stock, 'quality', config, now).status,
    'insufficient_evidence',
  );
  stock.radar.lenses.quality.matched = false;
  assert.equal(
    buildEvidencePacket(stock, 'quality', config, now).facts.length,
    0,
  );
});
test('Korean calendar day is not treated as a future observation before UTC midnight', () => {
  const stock = structuredClone(preview);
  stock.radar.as_of = '2026-09-03';
  const result = buildEvidencePacket(
    stock,
    'quality',
    config,
    Date.parse('2026-09-02T23:00:00Z'),
  );
  assert.ok(!result.warnings.some((v) => v.includes('이전 시점이거나')));
});
test('DART link validation removes URL injection and event description does not claim body analysis', () => {
  const stock = structuredClone(preview);
  stock.radar.matched_lenses = ['event'];
  stock.radar.lenses.event = {
    ...stock.radar.lenses.quality,
    matched: true,
    evidence: [
      {
        key: 'filing:1',
        source: 'DART 원문',
        comparison: '제목 분류',
        period: '20260903',
        value:
          'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260903000001&inject=bad',
      },
    ],
  };
  const result = buildEvidencePacket(stock, 'event', config, now);
  assert.equal(
    result.facts[0].url,
    'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260903000001',
  );
  assert.ok(result.facts[0].meaning.includes('본문 분석 결과는 아닙니다'));
  stock.radar.lenses.event.evidence[0].value = 'javascript:alert(1)';
  assert.equal(
    buildEvidencePacket(stock, 'event', config, now).facts.length,
    0,
  );
});
test('only allowlisted public evidence enters the model input', () => {
  const source = packet();
  source.review_note = 'PRIVATE-NOTE';
  source.watchlist = ['PRIVATE-WATCHLIST'];
  source.raw_credentials = 'SECRET';
  const text = JSON.stringify(aiInput(source));
  assert.ok(!text.includes('PRIVATE') && !text.includes('SECRET'));
  assert.ok(!text.includes('source_url') && !text.includes('research_run_id'));
});
test('citations, numbers, trading text, malformed and incomplete answers fail closed', () => {
  assert.ok(validateExplanation(answer(), packet(), config));
  for (const value of [
    { status: 'grounded', claims: [] },
    { status: 'grounded', claims: [{ ...answer().claims[0], source_ids: [] }] },
    {
      status: 'grounded',
      claims: [{ ...answer().claims[0], source_ids: ['unknown'] }],
    },
    ...[
      '수익률이 100%입니다.',
      '지금 매수하세요.',
      '수익 １００％ 보장',
      'https://attacker.example',
      '<script>bad</script>',
    ].map((explanation) => ({
      status: 'grounded',
      claims: [{ ...answer().claims[0], explanation }],
    })),
    { status: 'insufficient_evidence', claims: answer().claims },
  ])
    assert.equal(validateExplanation(value, packet(), config), null);
  assert.deepEqual(
    validateExplanation(
      { status: 'insufficient_evidence', claims: [] },
      packet(),
      config,
    ),
    { status: 'insufficient_evidence', claims: [] },
  );
});
test('changed evidence and warnings invalidate request revisions', () => {
  const original = packet();
  const changed = structuredClone(original);
  changed.facts[0].value = -999;
  assert.notEqual(packetRevision(original), packetRevision(changed));
  changed.warnings.push('재확인 필요');
  assert.notEqual(packetRevision(original), packetRevision(changed));
});
test('missing API key and insufficient sources make no external requests', async (t) => {
  let count = 0;
  const service = new EvidenceAiService(
    config,
    directory(t),
    () => undefined,
    async () => {
      count++;
      return response();
    },
    () => now,
  );
  await assert.rejects(service.generate(packet()), /API 키/);
  await assert.rejects(
    service.generate({ ...packet(), status: 'insufficient_evidence' }),
    /근거가 부족/,
  );
  assert.equal(count, 0);
});
test('same evidence deduplicates in-flight calls and reuses validated disk cache', async (t) => {
  let count = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const dir = directory(t);
  const service = new EvidenceAiService(
    config,
    dir,
    () => 'fake-test-key',
    async (_url, request) => {
      count++;
      const body = JSON.parse(request.body);
      assert.equal(body.store, false);
      assert.ok(body.text.format.strict);
      assert.equal(body.model, config.model);
      assert.equal(body.tools, undefined);
      await gate;
      return response();
    },
    () => now,
  );
  const first = service.generate(packet());
  const second = service.generate(packet());
  release();
  const results = await Promise.all([first, second]);
  assert.equal(count, 1);
  assert.deepEqual(results[0].answer, results[1].answer);
  const reopened = new EvidenceAiService(
    config,
    dir,
    () => undefined,
    async () => {
      throw new Error('cache should not fetch');
    },
    () => now,
  );
  assert.equal((await reopened.generate(packet())).cached, true);
});
test('API errors, refusals, incomplete output and invalid claims never produce a cached answer', async (t) => {
  for (const fetcher of [
    async () => new Response('secret-provider-body', { status: 401 }),
    async () =>
      new Response(JSON.stringify({ status: 'incomplete', output: [] })),
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal' }] }],
        }),
      ),
    async () =>
      response({
        ...answer(),
        claims: [{ ...answer().claims[0], source_ids: ['NOT-EXISTING'] }],
      }),
    async () => {
      throw new Error('secret-network-message');
    },
  ]) {
    const service = new EvidenceAiService(
      config,
      directory(t),
      () => 'fake',
      fetcher,
      () => now,
    );
    await assert.rejects(
      service.generate(packet()),
      (error) =>
        error instanceof EvidenceAiError && !error.message.includes('secret'),
    );
    assert.equal(await service.cached(packet()), null);
  }
});
test('persisted request budget includes failures and survives restart', async (t) => {
  const dir = directory(t);
  const limited = { ...config, max_requests_per_hour: 1 };
  const service = new EvidenceAiService(
    limited,
    dir,
    () => 'fake',
    async () => new Response('', { status: 429 }),
    () => now,
  );
  await assert.rejects(service.generate(packet()));
  const next = new EvidenceAiService(
    limited,
    dir,
    () => 'fake',
    async () => {
      throw new Error('must not call');
    },
    () => now,
  );
  await assert.rejects(next.generate(packet()), /시간당/);
  writeFileSync(path.join(dir, 'usage.json'), 'malformed');
  await assert.rejects(next.generate(packet()), /비용 발생을 차단/);
});
test('expired or malformed cached output is not served as valid', async (t) => {
  const dir = directory(t);
  const service = new EvidenceAiService(
    config,
    dir,
    () => 'fake',
    async () => response(),
    () => now,
  );
  await service.generate(packet());
  const future = new EvidenceAiService(
    config,
    dir,
    () => undefined,
    async () => response(),
    () => now + 25 * 3_600_000,
  );
  assert.equal(await future.cached(packet()), null);
  writeFileSync(
    path.join(dir, `${service.key(packet())}.json`),
    '{"corrupt":true}',
  );
  assert.equal(await service.cached(packet()), null);
});
