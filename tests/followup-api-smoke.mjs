// Run after npm run build. Uses an isolated database and loopback-only server.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ResearchStore } from '../lib/server/research-store.ts';
import { randomUUID } from 'node:crypto';
import { emptyThesis, thesisConfig } from '../lib/investment-thesis.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ThesisAiService } from '../lib/server/thesis-ai-service.ts';
import { thesisAiConfig } from '../lib/thesis-ai.ts';
import { thesisAiWriting, thesisAiResponse } from './fixtures/thesis-ai.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'value-followup-api-'));
const store = new ResearchStore(directory);
let child;
let exited;
try {
  const radar = JSON.parse(
    readFileSync('public/data/radar/latest.json', 'utf8'),
  );
  const candidate = radar.candidates[0];
  const stock = JSON.parse(
    readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
  );
  stock.data_level = 'research';
  stock.events = [
    {
      id: 'test-receipt-1',
      date: '20260901',
      title: '테스트용 사업보고서',
      url: 'https://dart.fss.or.kr/',
      importance: null,
    },
  ];
  stock.quarters = [
    {
      year: 2026,
      quarter: '2Q',
      label: '26 2Q',
      rev: 100,
      op: 10,
      ocf: 5,
      statement_basis: 'CFS',
    },
  ];
  stock.source_status = Object.fromEntries(
    ['prices', 'financials', 'dart_events'].map((key) => [
      key,
      {
        status: 'ok',
        collected_at: new Date().toISOString(),
        as_of: '2026-09-02',
      },
    ]),
  );
  store.register(candidate, radar, stock);
  store.db
    .prepare("UPDATE research_jobs SET state='ready' WHERE code=?")
    .run(candidate.code);
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      'localhost',
      '--port',
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RESEARCH_STORAGE_DIR: directory,
        OPENAI_API_KEY: '',
        DART_API_KEY: '',
        EVIDENCE_AI_CACHE_DIR: path.join(directory, 'evidence-cache'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  exited = once(child, 'exit');
  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    log += chunk.toString();
  });
  const base = `http://localhost:${port}`;
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null)
      throw new Error('Isolated server exited before startup.');
    try {
      if ((await fetch(`${base}/api/watchlist/followup`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(ready, true, log.slice(-1500));
  const thesisUrl = `${base}/api/watchlist/${candidate.code}/theses`;
  const documentsUrl = `${base}/api/watchlist/${candidate.code}/documents`;
  const docsResponse = await fetch(documentsUrl);
  assert.equal(docsResponse.status, 200);
  assert.deepEqual((await docsResponse.json()).items, []);
  const docPost = (body, origin = base) =>
    fetch(documentsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await docPost(
        { receipt: '20260814003108', id: randomUUID(), refresh: false },
        'https://elsewhere.invalid',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await docPost({
        receipt: '20260814003108',
        id: randomUUID(),
        refresh: false,
        url: 'https://elsewhere.invalid',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await docPost({
        receipt: '20260814003108',
        id: randomUUID(),
        refresh: false,
      })
    ).status,
    404,
  );
  assert.equal((await fetch(`${documentsUrl}/20260814003108`)).status, 404);
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM filing_documents').get().n,
    0,
  );
  const thesisList = async () => {
    const res = await fetch(thesisUrl);
    assert.equal(res.status, 200);
    return (await res.json()).items;
  };
  const sendThesis = (suffix, method, body, origin = base) =>
    fetch(thesisUrl + suffix, {
      method: method === 'POST' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  assert.deepEqual(await thesisList(), []);
  const pointRequest = {
    id: randomUUID(),
    content: {
      ...emptyThesis(),
      body: '격리된 테스트 가설',
      checks: [{ id: randomUUID(), text: '원문 확인 질문' }],
    },
  };
  assert.equal(
    (await sendThesis('', 'POST', pointRequest, 'https://elsewhere.invalid'))
      .status,
    403,
  );
  assert.equal(
    (
      await sendThesis('', 'POST', {
        ...pointRequest,
        content: { ...pointRequest.content, body: '' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await sendThesis('', 'POST', {
        ...pointRequest,
        content: {
          ...pointRequest.content,
          body: 'x'.repeat(thesisConfig.max_request_bytes),
        },
      })
    ).status,
    413,
  );
  assert.equal((await sendThesis('', 'POST', pointRequest)).status, 200);
  assert.equal((await sendThesis('', 'POST', pointRequest)).status, 200);
  let thesis = (await thesisList())[0];
  assert.equal((await thesisList()).length, 1);
  assert.equal(
    (
      await sendThesis(`/${thesis.id}`, 'PATCH', {
        revision: 0,
        content: thesis.content,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await sendThesis(`/${thesis.id}`, 'PATCH', {
        revision: thesis.revision,
        content: { ...thesis.content, body: '수정한 테스트 가설' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await sendThesis(`/${thesis.id}`, 'PATCH', {
        revision: thesis.revision,
        archived: true,
      })
    ).status,
    409,
  );
  thesis = (await thesisList())[0];
  assert.equal(
    (
      await sendThesis(`/${thesis.id}`, 'PATCH', {
        revision: thesis.revision,
        archived: true,
      })
    ).status,
    200,
  );
  thesis = (await thesisList())[0];
  assert.equal(thesis.archived, true);
  assert.equal(
    (
      await sendThesis(`/${thesis.id}`, 'PATCH', {
        revision: thesis.revision,
        archived: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/watchlist/000000/theses`)).status,
    404,
  );
  const detailHtml = await (
    await fetch(`${base}/stocks/${candidate.code}`)
  ).text();
  assert.ok(detailHtml.includes('내 투자포인트'));
  assert.ok(
    (await (await fetch(`${base}/watchlist`)).text()).includes(
      '수정한 테스트 가설',
    ),
  );
  const lens = candidate.matched_lenses[0];
  const evidenceUrl = `${base}/api/stocks/${candidate.code}/evidence`;
  const evidenceResponse = await fetch(`${evidenceUrl}?lens=${lens}`);
  assert.equal(evidenceResponse.status, 200);
  const evidence = await evidenceResponse.json();
  assert.equal(evidence.configured, false);
  assert.equal(evidence.result, null);
  assert.equal(evidence.packet.status, 'available');
  assert.ok(evidence.packet.facts.length);
  const explain = (body, origin = base) =>
    fetch(evidenceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await explain(
        { lens, revision: evidence.revision },
        'https://not-this-site.invalid',
      )
    ).status,
    403,
  );
  assert.equal(
    (await explain({ lens, revision: evidence.revision, prompt: 'untrusted' }))
      .status,
    400,
  );
  assert.equal((await explain({ lens, revision: 'missing' })).status, 400);
  assert.equal((await explain({ lens, revision: '0'.repeat(64) })).status, 409);
  assert.equal(
    (await explain({ lens, revision: evidence.revision })).status,
    503,
  );
  assert.equal((await fetch(`${evidenceUrl}?lens=unknown`)).status, 400);
  assert.equal(
    (await fetch(`${base}/api/stocks/not-a-code/evidence?lens=${lens}`)).status,
    400,
  );
  assert.equal(store.reviewBaseline(candidate.code), null);
  // Real HTTP contracts; seeded provider output only, no external AI request.
  const aiPoint = new ThesisStore(store.db).create(
    candidate.code,
    randomUUID(),
    thesisAiWriting(),
  );
  const aiUrl = `${thesisUrl}/${aiPoint.id}/analysis`;
  const previewResponse = await fetch(aiUrl);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.configured, false);
  assert.equal(preview.run, null);
  const aiRequest = {
    id: randomUUID(),
    revision: preview.revision,
    signature: preview.signature,
    consent: true,
  };
  const sendAi = (body, suffix = '', origin = base) =>
    fetch(aiUrl + suffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await sendAi(aiRequest, '', 'https://elsewhere.invalid')).status,
    403,
  );
  assert.equal((await sendAi({ ...aiRequest, consent: false })).status, 400);
  assert.equal(
    (await sendAi({ ...aiRequest, prompt: 'do not allow override' })).status,
    400,
  );
  assert.equal(
    (await sendAi({ ...aiRequest, signature: '0'.repeat(64) })).status,
    409,
  );
  assert.equal((await sendAi(aiRequest)).status, 503);
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    0,
  );
  const mockedAi = new ThesisAiService(
    store.db,
    thesisAiConfig,
    () => 'mock-key-not-real',
    async () => thesisAiResponse(),
  );
  const mockedRun = await mockedAi.generate(
    candidate.code,
    aiPoint.id,
    aiRequest,
  );
  const loadedAi = await (await fetch(aiUrl)).json();
  assert.equal(loadedAi.run.id, mockedRun.id);
  assert.equal(loadedAi.run.state, 'completed');
  const selected = {
    revision: aiPoint.revision,
    questions: [
      { suggestion_index: 1, text: '현금 유입을 방해할 조건은 무엇인가요?' },
    ],
  };
  const adoptSuffix = `/${mockedRun.id}/adopt`;
  assert.equal(
    (await sendAi(selected, adoptSuffix, 'https://elsewhere.invalid')).status,
    403,
  );
  assert.equal(
    (await sendAi({ ...selected, revision: 99 }, adoptSuffix)).status,
    409,
  );
  const accepted = await sendAi(selected, adoptSuffix);
  assert.equal(accepted.status, 200);
  const adopted = await accepted.json();
  assert.equal(adopted.item.content.body, aiPoint.content.body);
  assert.equal(adopted.item.content.checks.length, 1);
  assert.equal((await sendAi(selected, adoptSuffix)).status, 200);
  assert.equal(
    new ThesisStore(store.db)
      .list(candidate.code)
      .find((p) => p.id === aiPoint.id).revision,
    aiPoint.revision + 1,
  );
  assert.equal(store.reviewBaseline(candidate.code), null);
  const read = async () => {
    const response = await fetch(`${base}/api/watchlist/followup`);
    assert.equal(response.status, 200);
    return (await response.json()).items[0];
  };
  const review = (revision, origin = base) =>
    fetch(`${base}/api/watchlist/${candidate.code}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ revision }),
    });
  let row = await read();
  assert.equal(row.filings.newCount, null);
  assert.equal(store.reviewBaseline(candidate.code), null);
  assert.equal(
    (await review(row.revision, 'https://not-this-site.invalid')).status,
    403,
  );
  assert.equal((await review('missing')).status, 400);
  assert.equal((await review('0'.repeat(64))).status, 409);
  for (const route of [
    '/watchlist',
    `/stocks/${candidate.code}?tab=thesis`,
    `/stocks/${candidate.code}?tab=price`,
    `/stocks/${candidate.code}?tab=financials`,
    `/stocks/${candidate.code}?tab=events&scope=all`,
  ]) {
    assert.equal((await fetch(base + route)).status, 200, route);
  }
  assert.equal((await review(row.revision)).status, 200);
  assert.equal((await review(row.revision)).status, 409);
  row = await read();
  assert.equal(row.filings.newCount, 0);
  assert.ok(row.checked_at);
  stock.events.push({
    id: 'test-receipt-2',
    date: '20260902',
    title: '테스트용 유상증자결정',
    url: 'https://dart.fss.or.kr/',
  });
  stock.quarters[0].op = 20;
  store.db
    .prepare('UPDATE watchlist SET detail_json=? WHERE code=?')
    .run(JSON.stringify(stock), candidate.code);
  assert.equal((await review(row.revision)).status, 409);
  row = await read();
  assert.equal(row.filings.newCount, 1);
  assert.equal(row.filings.focusCount, 1);
  assert.equal(row.financials.changes[0].kind, 'revised');
  assert.equal((await review(row.revision)).status, 200);
  assert.equal((await read()).hasChanges, false);
  console.log(
    'PASS: isolated thesis CRUD, AI preview/consent/key/origin/conflict guards, mocked-result adoption/idempotency, source-review persistence and evidence routes; no external AI calls.',
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await exited;
  }
  store.close();
  const resolved = realpathSync(directory);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('value-followup-api-'));
  rmSync(resolved, { recursive: true });
}
