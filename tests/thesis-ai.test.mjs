import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ThesisAiService } from '../lib/server/thesis-ai-service.ts';
import { AiRequestGate } from '../lib/server/ai-request-gate.ts';
import { emptyThesis, thesisConfig } from '../lib/investment-thesis.ts';
import { thesisAiConfig, validateSuggestions } from '../lib/thesis-ai.ts';
const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = { ...radar.candidates[0], name: '격리 테스트 기업' };
const stock = JSON.parse(
  readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
);
const code = candidate.code;
const writing = () => ({
  ...emptyThesis(),
  title: '검증용 가설',
  body: '증설 이후 출하 증가가 현금흐름 개선으로 이어질 수 있다.',
  weakens: '비용이 더 크게 늘면 논리가 약해질 수 있다.',
  source_url: 'https://example.com/private-link?token=not-for-ai',
});
export const sampleAnswer = () => ({
  status: 'questions',
  suggestions: [
    {
      kind: 'support',
      anchor_field: 'body',
      anchor_quote: '증설 이후 출하 증가',
      question:
        '증설을 가정할 때 가동 시점과 출하 변화는 어떻게 확인할 수 있나요?',
      why: '가동과 출하의 연결이 성립하는지 확인할 질문입니다.',
      source_kind: 'company_report',
      look_for: '생산능력과 가동률의 기간별 표, 출하 자료가 필요한지 확인',
      weakening_signal: '출하가 늘지 않는다면 가동과 수요의 연결을 재검토',
    },
    {
      kind: 'challenge',
      anchor_field: 'body',
      anchor_quote: '현금흐름 개선',
      question:
        '출하가 늘더라도 재고와 비용 부담으로 현금흐름이 약해질 수 있나요?',
      why: '매출 변화가 현금으로 이어진다는 가정을 점검합니다.',
      source_kind: 'financial_statement',
      look_for: '재고와 매출채권, 영업현금흐름의 같은 기간 비교',
      weakening_signal: '재고·채권 증가로 현금 유입이 늦어진다면 가정 재검토',
    },
  ],
});
const response = (answer = sampleAnswer()) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(answer) }],
        },
      ],
      usage: { input_tokens: 650, output_tokens: 220 },
    }),
  );
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-thesis-ai-test-'));
  const owner = new ResearchStore(directory);
  owner.register(candidate, radar, stock);
  const theses = new ThesisStore(owner.db);
  const point = theses.create(code, randomUUID(), writing());
  let calls = 0;
  const ai = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => 'test-key-never-real',
    async () => {
      calls++;
      return response();
    },
  );
  t.after(() => {
    owner.close();
    assert.equal(path.dirname(realpathSync(directory)), realpathSync(tmpdir()));
    assert.ok(path.basename(directory).startsWith('value-thesis-ai-test-'));
    rmSync(directory, { recursive: true });
  });
  return { owner, theses, point, ai, directory, calls: () => calls };
}
const request = (ai, point, id = randomUUID()) => {
  const v = ai.view(code, point.id);
  return { id, revision: v.revision, signature: v.signature, consent: true };
};

test('only selected writing enters AI input; links, other points and collected data are excluded', async (t) => {
  const { owner, theses, point } = fixture(t);
  theses.create(code, randomUUID(), {
    ...writing(),
    body: 'OTHER_PRIVATE_POINT',
  });
  let sent;
  const before = owner.get(code).stock;
  const sourceRevision = owner.followup(code).revision;
  const ai = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => 'secret-test',
    async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      sent = JSON.parse(init.body);
      return response();
    },
  );
  const run = await ai.generate(code, point.id, request(ai, point));
  assert.equal(run.state, 'completed');
  const input = JSON.parse(sent.input[1].content);
  assert.deepEqual(Object.keys(input), [
    'company',
    'point',
    'existing_questions',
  ]);
  assert.equal(JSON.stringify(sent).includes('OTHER_PRIVATE_POINT'), false);
  assert.equal(JSON.stringify(sent).includes('not-for-ai'), false);
  assert.equal(sent.store, false);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(owner.get(code).stock, before);
  assert.equal(owner.followup(code).revision, sourceRevision);
  assert.deepEqual(
    theses.list(code).find((p) => p.id === point.id),
    point,
  );
});
test('no consent, missing key, stale revision/config and oversized input cause zero paid requests', async (t) => {
  const { owner, point, ai, calls } = fixture(t);
  await assert.rejects(
    ai.generate(code, point.id, { ...request(ai, point), consent: false }),
    { status: 400 },
  );
  await assert.rejects(
    ai.generate(code, point.id, { ...request(ai, point), revision: 999 }),
    { status: 409 },
  );
  await assert.rejects(
    ai.generate(code, point.id, {
      ...request(ai, point),
      signature: '0'.repeat(64),
    }),
    { status: 409 },
  );
  const noKey = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => '',
    () => assert.fail('called without key'),
  );
  await assert.rejects(noKey.generate(code, point.id, request(noKey, point)), {
    status: 503,
  });
  const small = new ThesisAiService(
    owner.db,
    { ...thesisAiConfig, max_input_bytes: 5 },
    () => 'key',
    () => assert.fail('oversize sent'),
  );
  await assert.rejects(small.generate(code, point.id, request(small, point)), {
    status: 413,
  });
  assert.equal(calls(), 0);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    0,
  );
});
test('quote linkage, new numbers, URLs, trading text and missing counter-questions fail closed', (t) => {
  const { ai, point } = fixture(t);
  const input = ai.view(code, point.id).input;
  assert.deepEqual(validateSuggestions(sampleAnswer(), input), sampleAnswer());
  for (const change of [
    (s) => (s.anchor_quote = '원문에 없는 인용'),
    (s) => (s.why = '2029년까지 확인합니다.'),
    (s) => (s.look_for = 'https://invented.com'),
    (s) => (s.why = '매수를 추천합니다'),
    (s) => (s.question = '단정하는 문장입니다'),
    (s) => (s.kind = 'unknown'),
  ]) {
    const answer = sampleAnswer();
    change(answer.suggestions[0]);
    assert.throws(() => validateSuggestions(answer, input));
  }
  const oneSide = sampleAnswer();
  oneSide.suggestions = oneSide.suggestions.slice(0, 1);
  assert.throws(() => validateSuggestions(oneSide, input));
  const unclear = {
    status: 'needs_clarification',
    suggestions: [{ ...sampleAnswer().suggestions[0], kind: 'clarification' }],
  };
  assert.doesNotThrow(() => validateSuggestions(unclear, input));
});
test('completed runs and input version survive reopening; same and new request IDs reuse success', async (t) => {
  const { ai, point, owner, directory, calls } = fixture(t);
  const req = request(ai, point);
  const original = await ai.generate(code, point.id, req);
  const second = new ResearchStore(directory);
  try {
    const restarted = new ThesisAiService(
      second.db,
      thesisAiConfig,
      () => 'key',
      () => assert.fail('duplicate paid request'),
    );
    assert.deepEqual(await restarted.generate(code, point.id, req), original);
    assert.equal(
      (await restarted.generate(code, point.id, request(restarted, point))).id,
      original.id,
    );
    await assert.rejects(
      restarted.generate(code, point.id, { ...req, signature: 'f'.repeat(64) }),
      { status: 409 },
    );
  } finally {
    second.close();
  }
  assert.equal(calls(), 1);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    1,
  );
});
test('two connections deduplicate pending work; another point and legacy route share the paid gate', async (t) => {
  const { owner, theses, point, directory } = fixture(t);
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const ai = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => 'key',
    async () => {
      await blocked;
      return response();
    },
  );
  const req = request(ai, point);
  const first = ai.generate(code, point.id, req);
  const second = new ResearchStore(directory);
  try {
    const other = new ThesisAiService(
      second.db,
      thesisAiConfig,
      () => 'key',
      () => assert.fail('parallel duplicate'),
    );
    assert.equal((await other.generate(code, point.id, req)).state, 'pending');
    assert.equal(
      (await other.generate(code, point.id, request(other, point))).id,
      req.id,
    );
    const next = theses.create(code, randomUUID(), writing());
    await assert.rejects(other.generate(code, next.id, request(other, next)), {
      status: 429,
    });
    assert.throws(
      () =>
        new ThesisStore(second.db).transaction(() =>
          new AiRequestGate(second.db).reserve(
            randomUUID(),
            'radar_explanation',
          ),
        ),
      { status: 429 },
    );
  } finally {
    release();
    await first;
    second.close();
  }
});
test('editing during generation preserves old result but blocks adoption into the new version', async (t) => {
  const { owner, point, theses } = fixture(t);
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const ai = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => 'key',
    async () => {
      await blocked;
      return response();
    },
  );
  const generating = ai.generate(code, point.id, request(ai, point));
  const edited = theses.update(code, point.id, 1, {
    content: { ...point.content, title: '사용자의 새 가설' },
  });
  release();
  const run = await generating;
  assert.equal(run.thesis_revision, 1);
  assert.equal(ai.view(code, point.id).revision, 2);
  assert.throws(
    () =>
      ai.adopt(code, point.id, run.id, edited.revision, [
        { suggestion_index: 0, text: run.answer.suggestions[0].question },
      ]),
    { status: 409 },
  );
  assert.deepEqual(theses.list(code)[0], edited);
});
test('edited selected questions append atomically; retry never duplicates, original text and versions remain', async (t) => {
  const { ai, point, theses, owner } = fixture(t);
  const run = await ai.generate(code, point.id, request(ai, point));
  const selected = [
    { suggestion_index: 1, text: '사용자가 수정한 확인 질문?' },
  ];
  const adopted = ai.adopt(code, point.id, run.id, 1, selected);
  assert.equal(adopted.item.revision, 2);
  assert.equal(adopted.item.content.body, point.content.body);
  assert.equal(adopted.item.content.checks.length, 1);
  assert.equal(adopted.item.content.checks[0].text, selected[0].text);
  assert.equal(ai.adopt(code, point.id, run.id, 1, selected).item.revision, 2);
  assert.throws(
    () =>
      ai.adopt(code, point.id, run.id, 2, [
        { suggestion_index: 0, text: '다른 선택?' },
      ]),
    { status: 409 },
  );
  assert.equal(
    owner.db
      .prepare(
        'SELECT count(*) AS n FROM investment_thesis_revisions WHERE thesis_id=?',
      )
      .get(point.id).n,
    2,
  );
  assert.deepEqual(theses.list(code)[0], adopted.item);
});
test('check limit, duplicate indexes and archived/inactive points cannot be silently mutated', async (t) => {
  const { ai, point, theses, owner } = fixture(t);
  const full = theses.update(code, point.id, 1, {
    content: {
      ...point.content,
      checks: Array.from({ length: thesisConfig.max_checks }, () => ({
        id: randomUUID(),
        text: '기존 질문?',
      })),
    },
  });
  const run = await ai.generate(code, point.id, request(ai, full));
  const selected = [{ suggestion_index: 0, text: '추가 질문?' }];
  assert.throws(
    () => ai.adopt(code, point.id, run.id, full.revision, selected),
    { status: 400 },
  );
  assert.throws(
    () =>
      ai.adopt(code, point.id, run.id, full.revision, [
        ...selected,
        ...selected,
      ]),
    { status: 400 },
  );
  assert.equal(ai.view(code, point.id).run.adoption, null);
  theses.update(code, point.id, full.revision, { archived: true });
  await assert.rejects(ai.generate(code, point.id, request(ai, point)), {
    status: 409,
  });
  owner.remove(code);
  assert.throws(() => ai.view(code, point.id), { status: 409 });
});
test('failure/refusal/incomplete/invalid/oversized responses retain writing and never auto retry', async (t) => {
  const { owner, point, theses } = fixture(t);
  const bad = [
    () => new Response('secret-provider-body', { status: 401 }),
    () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'secret-provider-body' }],
            },
          ],
        }),
      ),
    () =>
      new Response(
        JSON.stringify({
          status: 'incomplete',
          output: [],
          usage: { input_tokens: 123, output_tokens: 45 },
        }),
      ),
    () => response({ status: 'questions', suggestions: [] }),
    () => new Response('x'.repeat(thesisAiConfig.max_response_bytes + 1)),
    () => {
      throw new Error('secret-provider-error');
    },
  ];
  for (const fn of bad) {
    let calls = 0;
    const ai = new ThesisAiService(
      owner.db,
      thesisAiConfig,
      () => 'key',
      async () => {
        calls++;
        return fn();
      },
    );
    const req = request(ai, point);
    const run = await ai.generate(code, point.id, req);
    assert.equal(run.state, 'error');
    assert.equal(run.answer, null);
    assert.equal(run.error.includes('secret-provider'), false);
    await ai.generate(code, point.id, req);
    assert.equal(calls, 1);
  }
  assert.deepEqual(theses.list(code)[0], point);
});
test('expired unanswered request is visible and same ID never re-sends after restart', async (t) => {
  const { owner, point } = fixture(t);
  let release;
  let clock = 100000;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const ai = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => 'key',
    async () => {
      await pending;
      return response();
    },
    () => clock,
  );
  const req = request(ai, point);
  const original = ai.generate(code, point.id, req);
  clock += 100000;
  const resumed = new ThesisAiService(
    owner.db,
    thesisAiConfig,
    () => 'key',
    () => assert.fail('uncertain request retried'),
    () => clock,
  );
  assert.equal(
    (await resumed.generate(code, point.id, req)).state,
    'interrupted',
  );
  release();
  await original;
});
test('persisted request counts include both routes and failures and enforce one-hour limit', (t) => {
  const { owner } = fixture(t);
  let clock = 10000000;
  const gate = new AiRequestGate(owner.db, () => clock);
  const tx = new ThesisStore(owner.db);
  for (let i = 0; i < 12; i++) {
    const id = randomUUID();
    tx.transaction(() =>
      gate.reserve(id, i % 2 ? 'thesis_questions' : 'radar_explanation'),
    );
    gate.finish(id);
  }
  assert.throws(
    () =>
      tx.transaction(() =>
        new AiRequestGate(owner.db, () => clock).reserve(
          randomUUID(),
          'thesis_questions',
        ),
      ),
    { status: 429 },
  );
  clock += 3600001;
  assert.doesNotThrow(() =>
    tx.transaction(() => gate.reserve(randomUUID(), 'thesis_questions')),
  );
});
