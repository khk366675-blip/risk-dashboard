// Production HTTP/UI verification in a disposable research store. No live collectors or AI.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';
const directory = mkdtempSync(path.join(tmpdir(), 'value-memo-http-'));
let server, owner;
try {
  owner = new ResearchStore(directory);
  const radar = JSON.parse(
    readFileSync('public/data/radar/latest.json', 'utf8'),
  );
  const candidate = radar.candidates[0];
  const stock = JSON.parse(
    readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
  );
  stock.name = `[격리 검증용] ${stock.name}`;
  owner.register(candidate, radar, stock);
  owner.db
    .prepare(
      "UPDATE research_jobs SET state='ready',step='검증용 수집 완료'",
    )
    .run();
  const thesis = new ThesisStore(owner.db).create(
    candidate.code,
    randomUUID(),
    {
      ...emptyThesis(),
      title: '다양한 자료 메모 검증',
      body: '테스트 전용 투자포인트. 실제 사용자 기록과 분리되어 있습니다.',
    },
  );
  owner.close();
  owner = null;
  const socket = createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const base = `http://127.0.0.1:${port}`;
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
      env: {
        ...process.env,
        RESEARCH_STORAGE_DIR: directory,
        RADAR_PYTHON_EXECUTABLE: path.join(directory, 'disabled-collector.exe'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  server.stdout.on('data', (v) => (logs += v));
  server.stderr.on('data', (v) => (logs += v));
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/operations')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, logs);
  const endpoint = `/api/watchlist/${candidate.code}/manual-evidence`;
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=';
  const document = {
    version: 1,
    blocks: [
      { type: 'text', style: 'heading', text: '수기 분기 자료' },
      {
        type: 'table',
        title: '직접 입력한 매출',
        unit: '억원',
        chart: 'bar',
        rows: [
          ['분기', '매출'],
          ['1Q', '100'],
          ['2Q', '120'],
          ['3Q', ''],
        ],
      },
      {
        type: 'image',
        src: image,
        caption: '테스트 이미지 — 자동 판독하지 않음',
      },
    ],
  };
  const input = {
    id: randomUUID(),
    thesis_id: thesis.id,
    thesis_revision: thesis.revision,
    relation: 'context',
    source_type: 'memo',
    title: '표·그래프·이미지 HTTP 검증',
    url: '',
    source_name: '격리 검증',
    published_at: '',
    body: 'ignored body',
    note: '원수치 확인',
    document,
  };
  async function request(value, origin = base) {
    const res = await fetch(base + endpoint, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return { status: res.status, data: await res.json() };
  }
  const saved = await request(input);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.item.document, document);
  assert.match(saved.data.item.body, /1Q \| 100/);
  assert.doesNotMatch(saved.data.item.body, /base64|ignored/);
  assert.equal((await request(input)).data.item.id, saved.data.item.id);
  assert.equal((await request(input, 'https://external.example')).status, 403);
  const altered = structuredClone(input);
  altered.document.blocks[1].rows[1][1] = '101';
  assert.equal((await request(altered)).status, 409);
  const invalid = structuredClone(input);
  invalid.id = randomUUID();
  invalid.document.blocks[2].src = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.equal((await request(invalid)).status, 400);
  assert.equal(
    (await request({ ...input, padding: 'x'.repeat(1800000) })).status,
    413,
  );
  const list = await (await fetch(base + endpoint)).json();
  assert.equal(list.items.length, 1);
  assert.deepEqual(list.items[0].document, document);
  const snapshot = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        "import {buildLocalMobileSnapshot} from './lib/server/local-mobile-snapshot.ts';process.stdout.write(JSON.stringify(buildLocalMobileSnapshot()));",
      ],
      {
        env: { ...process.env, RESEARCH_STORAGE_DIR: directory },
        encoding: 'utf8',
        maxBuffer: 8000000,
      },
    ),
  );
  assert.deepEqual(
    snapshot.stocks[0].theses[0].evidence[0].document,
    document,
    'mobile snapshot retains table, graph and embedded image without upload',
  );
  console.log(
    'PASS: rich memo HTTP save/read/idempotency/conflict/origin/size/safe raster; mobile snapshot retains full memo. No external publication or AI.',
  );
  if (process.env.MEMO_UI === '1') {
    console.log(`UI_READY ${base}/stocks/${candidate.code}?tab=thesis`);
    console.log('Press Enter to close the isolated UI server.');
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });
    process.stdin.pause();
  }
} finally {
  owner?.close();
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((r) => server.once('exit', r));
  }
  const resolved = realpathSync(directory);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('value-memo-http-'));
  rmSync(resolved, { recursive: true });
}
