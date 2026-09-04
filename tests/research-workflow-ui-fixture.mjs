// Isolated local fixture for manual evidence and filing-comparison browser QA.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const directory = mkdtempSync(path.join(tmpdir(), 'value-research-ui-'));
const code = '043260';
const reports = [
  {
    receipt: '20250515001234',
    title: '분기보고서 (2025.03)',
    filingDate: '20250515',
    texts: [
      '동일한 사업 소개 문단',
      '해외 매장 10개를 운영하고 있습니다.',
      '동일한 제품 설명 문단',
      '이전 보고서에서 제외될 시험 사업 문구',
      '동일한 마지막 문단',
    ],
  },
  {
    receipt: '20260814003108',
    title: '반기보고서 (2026.06)',
    filingDate: '20260814',
    texts: [
      '동일한 사업 소개 문단',
      '해외 매장 20개를 운영하고 있습니다.',
      '동일한 제품 설명 문단',
      '동일한 마지막 문단',
      '최근 보고서에 새 브랜드 출시 계획이 등장했습니다.',
    ],
  },
];
const radar = JSON.parse(
  readFileSync(path.join(root, 'public/data/radar/latest.json'), 'utf8'),
);
const candidate = radar.candidates.find((item) => item.code === code);
const stock = JSON.parse(
  readFileSync(
    path.join(root, `public/data/radar/stocks/${code}.json`),
    'utf8',
  ),
);
stock.name = '[격리 검토] 성호전자';
stock.events = reports.map((report) => ({
  id: `dart:${report.receipt}`,
  date: report.filingDate,
  title: report.title,
  url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${report.receipt}`,
}));
const db = new DatabaseSync(path.join(directory, 'watchlist.sqlite'));
db.exec(readFileSync(path.join(root, 'research/schema.sql'), 'utf8'));
db.prepare('INSERT INTO watchlist VALUES(?,?,?,?,?,?,?,?)').run(
  code,
  stock.name,
  JSON.stringify(candidate),
  radar.run_id,
  radar.as_of,
  new Date().toISOString(),
  1,
  JSON.stringify(stock),
);
db.prepare('INSERT INTO research_jobs VALUES(?,?,?,?,?,?,?,?)').run(
  code,
  randomUUID(),
  'ready',
  'all',
  '격리된 화면 검증 자료',
  null,
  new Date().toISOString(),
  null,
);
const thesisId = randomUUID();
const content = JSON.stringify({
  title: '해외 채널 확장',
  body: '해외 매장 확대가 매출 성장으로 연결되는지 확인한다.',
  timing: '다음 반기보고서',
  weakens: '매장 확대에도 해외 매출이 정체되는 경우',
  source_url: '',
  checks: [],
});
db.prepare('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)').run(
  thesisId,
  code,
  1,
  0,
  new Date().toISOString(),
  new Date().toISOString(),
  content,
);
db.prepare('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)').run(
  thesisId,
  1,
  0,
  new Date().toISOString(),
  content,
);
for (const report of reports) {
  const version = createHash('sha256')
    .update(`${report.receipt}:fixture`)
    .digest('hex');
  const extraction = {
    receipt: report.receipt,
    member: `${report.receipt}.xml`,
    parser_version: 'dart-xml-v3',
    sections: [
      {
        id: 's-business',
        title: '1. 사업 현황',
        group: 'business',
        block_count: report.texts.length,
      },
    ],
    blocks: report.texts.map((text, index) => ({
      id: `b${index}`,
      section_id: 's-business',
      kind: 'text',
      text,
      source_path: `/DOCUMENT/SECTION[1]/P[${index + 1}]`,
    })),
    warnings: ['격리된 화면 검증용 문서입니다. 실제 공시가 아닙니다.'],
    omitted_members: [],
    status: 'partial',
  };
  const bytes = Buffer.from(JSON.stringify(extraction));
  const extractedHash = createHash('sha256').update(bytes).digest('hex');
  const relative = `documents/${code}/${report.receipt}/${extractedHash}.json`;
  mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
  writeFileSync(path.join(directory, relative), bytes);
  db.prepare(
    "INSERT INTO filing_documents(code,receipt,title,filing_date,job_id,state,requested_at,checked_at,current_version) VALUES(?,?,?,?,?,'partial',?,?,?)",
  ).run(
    code,
    report.receipt,
    report.title,
    report.filingDate,
    randomUUID(),
    new Date().toISOString(),
    new Date().toISOString(),
    version,
  );
  db.prepare(
    'INSERT INTO filing_document_versions VALUES(?,?,?,?,?,?,?,?,?,?)',
  ).run(
    code,
    report.receipt,
    version,
    'a'.repeat(64),
    extractedHash,
    `documents/${code}/${report.receipt}/${'a'.repeat(64)}.zip`,
    relative,
    'dart-xml-v3',
    new Date().toISOString(),
    JSON.stringify({ warnings: extraction.warnings }),
  );
}
db.close();

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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', (bytes) => {
  if (bytes.toString().includes('Ready'))
    console.log(
      `RESEARCH_WORKFLOW_UI_URL=http://localhost:${port}/stocks/${code}?tab=documents`,
    );
});
child.stderr.on('data', (bytes) => process.stderr.write(bytes));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill());
await once(child, 'exit');
rmSync(directory, { recursive: true, force: true });
