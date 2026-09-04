// Browser QA only: isolated local database, clearly labeled fixture, no collectors.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ResearchStore } from '../lib/server/research-store.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ThesisAiService } from '../lib/server/thesis-ai-service.ts';
import { thesisAiConfig } from '../lib/thesis-ai.ts';
import { thesisAiWriting, thesisAiResponse } from './fixtures/thesis-ai.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'value-thesis-ui-'));
const store = new ResearchStore(directory);
const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = {
  ...radar.candidates[0],
  name: '[화면 테스트] ' + radar.candidates[0].name,
};
const stock = JSON.parse(
  readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
);
stock.name = candidate.name;
stock.data_level = 'research';
stock.warnings = [
  '격리된 화면 테스트 자료입니다. 사용자 관심종목에 저장되지 않습니다.',
];
stock.research_run_id = 'isolated-financial-ui-run';
stock.collected_at = '2026-09-04T00:00:00.000Z';
stock.quarters = [
  {
    year: 2025,
    quarter: '2Q',
    label: '25 2Q',
    rev: 8_400_000_000,
    op: 520_000_000,
    op_margin_pct: 6.2,
    statement_basis: 'CFS',
    receipt_no: '20250814000001',
  },
  {
    year: 2025,
    quarter: '3Q',
    label: '25 3Q',
    rev: 9_100_000_000,
    op: 640_000_000,
    op_margin_pct: 7,
    statement_basis: 'CFS',
    receipt_no: '20251114000001',
  },
  {
    year: 2025,
    quarter: '4Q',
    label: '25 4Q',
    rev: 9_800_000_000,
    op: 760_000_000,
    op_margin_pct: 7.8,
    statement_basis: 'CFS',
    receipt_no: '20260331000001',
  },
  {
    year: 2026,
    quarter: '1Q',
    label: '26 1Q',
    rev: 10_200_000_000,
    op: 810_000_000,
    op_margin_pct: 7.9,
    statement_basis: 'CFS',
    receipt_no: '20260515000001',
  },
];
stock.source_status.financials = {
  status: 'ok',
  source: '격리된 화면 테스트 재무',
  as_of: '2026 1Q',
  collected_at: stock.collected_at,
  run_id: stock.research_run_id,
};
store.register(candidate, radar, stock);
store.db
  .prepare(
    "UPDATE research_jobs SET state='ready',step='격리된 UI 검증용 자료 · 실제 수집 실행 안 함' WHERE code=?",
  )
  .run(candidate.code);
const thesisStore = new ThesisStore(store.db);
const point = thesisStore.create(
  candidate.code,
  randomUUID(),
  thesisAiWriting(),
);
const ai = new ThesisAiService(
  store.db,
  thesisAiConfig,
  () => 'mock-key-not-real',
  async () => thesisAiResponse(),
);
const preview = ai.view(candidate.code, point.id);
await ai.generate(candidate.code, point.id, {
  id: randomUUID(),
  revision: preview.revision,
  signature: preview.signature,
  consent: true,
});
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const child = spawn(
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
    windowsHide: true,
    env: {
      ...process.env,
      RESEARCH_STORAGE_DIR: directory,
      OPENAI_API_KEY: '',
      DART_API_KEY: '',
      EVIDENCE_AI_CACHE_DIR: path.join(directory, 'ai-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let announced = false;
child.stdout.on('data', (chunk) => {
  if (!announced && chunk.toString().includes('Ready')) {
    announced = true;
    console.log(
      `UI_TEST_URL=http://localhost:${port}/stocks/${candidate.code}`,
    );
    console.log(`UI_TEST_STORAGE=${directory}`);
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
try {
  await once(child, 'exit');
} finally {
  store.close();
  const resolved = realpathSync(directory);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('value-thesis-ui-'));
  rmSync(resolved, { recursive: true });
}
