// Run after npm run build. Uses an isolated database and loopback-only server.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ResearchStore } from '../lib/server/research-store.ts';

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
      env: { ...process.env, RESEARCH_STORAGE_DIR: directory },
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
    'PASS: isolated API persistence, source-update conflict, origin/validation guards, and four route responses.',
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
