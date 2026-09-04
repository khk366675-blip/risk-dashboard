import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { DocumentStore } from '../lib/server/document-store.ts';
import { documentConfig, filingReceipt } from '../lib/filing-documents.ts';
const receipt = '20260814003108';
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-document-store-'));
  const owner = new ResearchStore(directory),
    radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
  const candidate = radar.candidates[0],
    stock = JSON.parse(
      readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
    );
  stock.events = [
    {
      id: `dart:${receipt}`,
      title: '반기보고서 (2026.06)',
      date: '20260814',
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`,
    },
  ];
  owner.register(candidate, radar, stock);
  const service = new DocumentStore(owner.db, directory);
  t.after(() => {
    owner.close();
    assert.equal(path.dirname(realpathSync(directory)), realpathSync(tmpdir()));
    assert.ok(path.basename(directory).startsWith('value-document-store-'));
    rmSync(directory, { recursive: true });
  });
  return { owner, service, code: candidate.code, directory };
}
test('document discovery is receipt-validated, read-only and watchlist-scoped', (t) => {
  const { owner, service, code } = fixture(t);
  assert.equal(service.list(code).items[0].state, 'not_collected');
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM filing_documents').get().n,
    0,
  );
  assert.equal(
    filingReceipt({
      id: `dart:${receipt}`,
      url: `https://evil.invalid/?rcpNo=${receipt}`,
    }),
    null,
  );
  assert.throws(
    () => service.enqueue(code, '00000000000000', randomUUID(), false),
    (e) => e.status === 404,
  );
  owner.remove(code);
  assert.throws(
    () => service.list(code),
    (e) => e.status === 409,
  );
});
test('queue deduplicates, honors cache and exposes expired jobs without GET mutation', (t) => {
  const { owner, service, code } = fixture(t);
  const id = randomUUID();
  assert.equal(service.enqueue(code, receipt, id, false), true);
  assert.equal(service.enqueue(code, receipt, id, false), false);
  assert.equal(service.enqueue(code, receipt, randomUUID(), true), false);
  owner.db
    .prepare("UPDATE filing_documents SET requested_at='2000-01-01T00:00:00Z'")
    .run();
  assert.equal(service.list(code).items[0].state, 'interrupted');
  assert.equal(
    owner.db.prepare('SELECT state FROM filing_documents').get().state,
    'queued',
  );
  assert.equal(service.enqueue(code, receipt, randomUUID(), true), true);
  owner.db
    .prepare("UPDATE filing_documents SET state='ready',checked_at=?")
    .run(new Date().toISOString());
  assert.equal(service.enqueue(code, receipt, randomUUID(), false), false);
});
test('reader validates content hash and pages within one immutable section', (t) => {
  const { owner, service, code, directory } = fixture(t);
  service.enqueue(code, receipt, randomUUID(), false);
  const data = {
    receipt,
    member: `${receipt}.xml`,
    parser_version: documentConfig.parser_version,
    sections: [
      { id: 's0000', title: '단위: 원', group: 'notes', block_count: 50 },
    ],
    blocks: Array.from({ length: 50 }, (_, i) => ({
      id: `b${i}`,
      section_id: 's0000',
      kind: 'text',
      text: `원문 ${i}`,
      source_path: `/DOCUMENT/P[${i + 1}]`,
    })),
    warnings: ['테스트 추출 범위'],
    omitted_members: [],
  };
  const bytes = Buffer.from(JSON.stringify(data)),
    sha = createHash('sha256').update(bytes).digest('hex');
  const relative = `documents/${code}/${receipt}/${sha}.json`;
  mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
  writeFileSync(path.join(directory, relative), bytes);
  owner.db
    .prepare('INSERT INTO filing_document_versions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      code,
      receipt,
      'version-1',
      'a'.repeat(64),
      sha,
      'unused.zip',
      relative,
      documentConfig.parser_version,
      new Date().toISOString(),
      '{}',
    );
  const priorData = {
    ...data,
    blocks: [
      {
        id: 'prior-block',
        section_id: 's0000',
        kind: 'text',
        text: '과거 저장본의 해외 성장 논리 검토 문단',
        source_path: '/DOCUMENT/P[1]',
      },
    ],
    sections: [
      { id: 's0000', title: '단위: 원', group: 'notes', block_count: 1 },
    ],
  };
  const priorBytes = Buffer.from(JSON.stringify(priorData)),
    priorSha = createHash('sha256').update(priorBytes).digest('hex');
  const priorRelative = `documents/${code}/${receipt}/${priorSha}.json`;
  writeFileSync(path.join(directory, priorRelative), priorBytes);
  owner.db
    .prepare('INSERT INTO filing_document_versions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      code,
      receipt,
      'version-0',
      'b'.repeat(64),
      priorSha,
      'unused-prior.zip',
      priorRelative,
      documentConfig.parser_version,
      '2025-01-01T00:00:00.000Z',
      '{}',
    );
  owner.db
    .prepare(
      "UPDATE filing_documents SET current_version='version-1',state='ready'",
    )
    .run();
  assert.equal(
    service.view(code, receipt).blocks.length,
    documentConfig.blocks_per_page,
  );
  assert.equal(
    service.view(code, receipt, undefined, 's0000', 40).blocks.length,
    10,
  );
  const linkedBlockPage = service.view(
    code,
    receipt,
    'version-1',
    's0000',
    0,
    'b45',
  );
  assert.equal(linkedBlockPage.offset, 40);
  assert.equal(
    linkedBlockPage.blocks.some((block) => block.id === 'b45'),
    true,
  );
  assert.throws(
    () => service.view(code, receipt, 'version-1', 's0000', 0, 'b999'),
    (e) => e.status === 404,
  );
  assert.throws(
    () => service.view(code, receipt, undefined, 'not-found'),
    (e) => e.status === 404,
  );
  const currentSearch = service.search(code, {
    query: '원문 45',
    group: 'notes',
  });
  assert.equal(currentSearch.result_count, 1);
  assert.equal(currentSearch.items[0].block_id, 'b45');
  assert.equal(currentSearch.items[0].current, true);
  assert.equal(currentSearch.coverage.status, 'ok');
  assert.equal(
    service.search(code, { query: '과거 성장', versions: 'current' })
      .result_count,
    0,
  );
  const historySearch = service.search(code, {
    query: '과거 성장',
    versions: 'all',
  });
  assert.equal(historySearch.result_count, 1);
  assert.equal(historySearch.items[0].version, 'version-0');
  assert.equal(historySearch.items[0].current, false);
  assert.equal(historySearch.items[0].source_path, '/DOCUMENT/P[1]');
  assert.equal(
    service.search(code, {
      query: '과거 성장',
      group: 'business',
      versions: 'all',
    }).result_count,
    0,
  );
  assert.throws(
    () => service.search(code, { query: '가' }),
    (e) => e.status === 400,
  );
  writeFileSync(path.join(directory, relative), 'corrupted fixture');
  assert.throws(
    () => service.view(code, receipt),
    (e) => e.status === 503,
  );
  const partialSearch = service.search(code, {
    query: '과거',
    versions: 'all',
  });
  assert.equal(partialSearch.result_count, 1);
  assert.equal(partialSearch.coverage.status, 'partial');
  assert.equal(partialSearch.coverage.failed_versions, 1);
  assert.match(partialSearch.warnings[0], /무결성 검사/);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    0,
  );
});

test('document comparison aligns sections, exposes changes and preserves both source locations', (t) => {
  const { owner, service, code, directory } = fixture(t);
  const olderReceipt = '20250515001234';
  const store = (reportReceipt, version, title, filingDate, texts) => {
    const extraction = {
      receipt: reportReceipt,
      member: `${reportReceipt}.xml`,
      parser_version: documentConfig.parser_version,
      sections: [
        {
          id: 's-business',
          title: '1. 사업 현황',
          group: 'business',
          block_count: texts.length,
        },
      ],
      blocks: texts.map((text, index) => ({
        id: `b${index}`,
        section_id: 's-business',
        kind: 'text',
        text,
        source_path: `/DOCUMENT/SECTION[1]/P[${index + 1}]`,
      })),
      warnings: [],
      omitted_members: [],
    };
    const bytes = Buffer.from(JSON.stringify(extraction));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const relative = `documents/${code}/${reportReceipt}/${sha}.json`;
    mkdirSync(path.dirname(path.join(directory, relative)), {
      recursive: true,
    });
    writeFileSync(path.join(directory, relative), bytes);
    owner.db
      .prepare(
        "INSERT INTO filing_documents(code,receipt,title,filing_date,job_id,state,requested_at,checked_at,current_version) VALUES(?,?,?,?,?,'ready',?,?,?)",
      )
      .run(
        code,
        reportReceipt,
        title,
        filingDate,
        randomUUID(),
        '2026-09-04T00:00:00.000Z',
        '2026-09-04T00:00:00.000Z',
        version,
      );
    owner.db
      .prepare(
        'INSERT INTO filing_document_versions VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        code,
        reportReceipt,
        version,
        'a'.repeat(64),
        sha,
        'unused.zip',
        relative,
        documentConfig.parser_version,
        '2026-09-04T00:00:00.000Z',
        '{}',
      );
  };
  store(olderReceipt, 'old-v1', '분기보고서 (2025.03)', '20250515', [
    '동일한 소개 문단',
    '해외 매장 10개를 운영합니다.',
    '동일한 중간 문단',
    '이전 보고서에서 제외될 문구',
    '동일한 마지막 문단',
  ]);
  store(receipt, 'new-v1', '반기보고서 (2026.06)', '20260814', [
    '동일한 소개 문단',
    '해외 매장 20개를 운영합니다.',
    '동일한 중간 문단',
    '동일한 마지막 문단',
    '최근 보고서에 새로 등장한 문구',
  ]);
  const compared = service.compare(code, {
    fromReceipt: olderReceipt,
    toReceipt: receipt,
    group: 'business',
  });
  assert.deepEqual(compared.counts, { added: 1, removed: 1, changed: 1 });
  assert.equal(compared.coverage.status, 'ok');
  assert.equal(compared.coverage.aligned_sections, 1);
  const changed = compared.items.find((item) => item.kind === 'changed');
  assert.equal(changed.before.receipt, olderReceipt);
  assert.equal(changed.before.block_id, 'b1');
  assert.equal(changed.after.receipt, receipt);
  assert.equal(changed.after.block_id, 'b1');
  assert.equal(
    service.compare(code, {
      fromReceipt: olderReceipt,
      toReceipt: receipt,
      group: 'business',
      query: '해외 매장',
    }).items.length,
    1,
  );
  assert.deepEqual(
    service.compare(code, {
      fromReceipt: olderReceipt,
      toReceipt: receipt,
      group: 'notes',
    }).counts,
    { added: 0, removed: 0, changed: 0 },
  );
});
