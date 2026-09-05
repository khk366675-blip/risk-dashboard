// Explicit opt-in production HTTP regression: node --experimental-strip-types tests/question-flow.integration.mjs
// Uses a new temporary database and mocked AI response; never writes the user's research store.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ThesisAiService } from '../lib/server/thesis-ai-service.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';

const directory = mkdtempSync(path.join(tmpdir(), 'value-question-http-'));
let server;
let owner;
try {
  owner = new ResearchStore(directory);
  const radar = JSON.parse(
    readFileSync('public/data/radar/latest.json', 'utf8'),
  );
  const candidate = radar.candidates[0];
  const stock = JSON.parse(
    readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
  );
  owner.register(candidate, radar, stock);
  const point = new ThesisStore(owner.db).create(candidate.code, randomUUID(), {
    ...emptyThesis(),
    title: '격리 질문 흐름 테스트',
    body: '해외 채널 확대가 매출 성장으로 이어지는지 확인한다.',
    checks: [{ id: randomUUID(), text: '내가 직접 작성한 질문' }],
  });
  let aiCalls = 0;
  const ai = new ThesisAiService(
    owner.db,
    undefined,
    () => 'fake-key',
    async () => {
      aiCalls++;
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'questions',
                  suggestions: [
                    {
                      kind: 'challenge',
                      anchor_field: 'body',
                      anchor_quote: '해외 채널 확대',
                      question:
                        '해외 채널 확대가 매출 성장으로 이어지지 않을 가능성은 어떻게 확인할까요?',
                      why: '채널과 매출 사이 가정의 검증이 필요합니다.',
                      source_kind: 'company_report',
                      look_for: '해외 채널 매출의 같은 기간 비교',
                      weakening_signal: '확대와 매출 기여가 연결되지 않는 경우',
                    },
                  ],
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    },
  );
  const view = ai.view(candidate.code, point.id);
  const run = await ai.generate(candidate.code, point.id, {
    id: randomUUID(),
    revision: view.revision,
    signature: view.signature,
    consent: true,
  });
  assert.equal(run.state, 'completed');
  owner.close();
  owner = null;
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '-p',
      String(port),
      '-H',
      '127.0.0.1',
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        RESEARCH_STORAGE_DIR: directory,
        VERCEL: '',
        OPENAI_API_KEY: '',
        THESIS_AI_API_KEY: '',
      },
    },
  );
  const base = `http://127.0.0.1:${port}`;
  const endpoint = `/api/watchlist/${candidate.code}/theses`;
  let ready = false;
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(base + endpoint)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error('Isolated server exited');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'isolated production server ready');
  const items = await (await fetch(base + endpoint)).json();
  assert.equal(items.items.length, 1);
  assert.equal(
    items.items[0].id,
    point.id,
    'verify isolated store before any write',
  );
  async function write(
    suffix,
    data,
    host = '127.0.0.1',
    method = 'POST',
    origin,
  ) {
    const response = await fetch(`http://${host}:${port}` + suffix, {
      method: method === 'PATCH' ? 'PATCH' : 'POST',
      headers: {
        Host: `${host}:${port}`,
        Origin: origin ?? `http://${host}:${port}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    return { status: response.status, body };
  }
  const adoptPath = `${endpoint}/${point.id}/analysis/${run.id}/adopt`;
  const payload = {
    revision: point.revision,
    questions: [
      { suggestion_index: 0, text: run.answer.suggestions[0].question },
    ],
  };
  const denied = await write(
    adoptPath,
    payload,
    '127.0.0.1',
    'POST',
    `http://localhost:${port}`,
  );
  assert.equal(denied.status, 403);
  const adopted = await write(adoptPath, payload);
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.item.content.checks.length, 2);
  const repeated = await write(adoptPath, payload, 'localhost');
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
  assert.equal(repeated.body.item.content.checks.length, 2);
  const revision = adopted.body.item.revision;
  const source = await write(
    `/api/watchlist/${candidate.code}/manual-evidence`,
    {
      id: randomUUID(),
      thesis_id: point.id,
      thesis_revision: revision,
      relation: 'context',
      source_type: 'broker_report',
      title: '격리 테스트 리포트',
      url: 'https://example.com/report',
      source_name: '테스트',
      published_at: '2026-09-05',
      body: '매장 확대는 확인했으나 매출 기여는 미확인.',
      note: '테스트 메모',
    },
  );
  assert.equal(source.status, 200, JSON.stringify(source.body));
  const content = structuredClone(adopted.body.item.content);
  const question = content.checks[1];
  Object.assign(question, {
    answer: '매장 확대 확인, 매출 기여 확인 필요',
    unresolved: '채널별 실적 자료 확인',
    status: 'reviewing',
    evidence_ids: [`manual:${source.body.item.id}`],
  });
  const saved = await write(
    `${endpoint}/${point.id}`,
    { revision, content },
    'localhost',
    'PATCH',
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const reread = await (await fetch(base + endpoint)).json();
  assert.deepEqual(reread.items[0].content.checks[1], question);
  assert.deepEqual(reread.items[0].content.checks[0], point.content.checks[0]);
  const conflict = await write(
    `${endpoint}/${point.id}`,
    { revision, content },
    '127.0.0.1',
    'PATCH',
  );
  assert.equal(conflict.status, 409);
  assert.equal(
    aiCalls,
    1,
    'adoption and answers make no additional AI request',
  );
  console.log(
    'PASS: both local hosts adopt, retry deduplicates, manual evidence + answer persist, stale/cross-origin writes rejected; no real AI calls.',
  );
} finally {
  owner?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  const resolved = realpathSync(directory);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('value-question-http-'));
  rmSync(resolved, { recursive: true });
}
