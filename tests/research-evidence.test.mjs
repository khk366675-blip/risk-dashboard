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
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { DocumentStore } from '../lib/server/document-store.ts';
import { ResearchEvidenceStore } from '../lib/server/research-evidence-store.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';
import { documentConfig } from '../lib/filing-documents.ts';

const receipt = '20260814003108';
const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-evidence-test-'));
  const owner = new ResearchStore(directory);
  const stock = JSON.parse(
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
  const documents = new DocumentStore(owner.db, directory);
  documents.enqueue(candidate.code, receipt, randomUUID(), false);
  const extraction = {
    receipt,
    member: `${receipt}.xml`,
    parser_version: documentConfig.parser_version,
    sections: [
      {
        id: 's0001',
        title: '1. 사업의 개요',
        group: 'business',
        block_count: 2,
      },
    ],
    blocks: [
      {
        id: 'b10',
        section_id: 's0001',
        kind: 'text',
        text: '사용자가 직접 확인한 원문 문단',
        source_path: '/DOCUMENT/SECTION[1]/P[1]',
      },
      {
        id: 'b11',
        section_id: 's0001',
        kind: 'table',
        text: '매출액 100',
        source_path: '/DOCUMENT/SECTION[1]/TABLE[1]',
        rows: [
          [
            { text: '매출액', header: true, rowspan: 1, colspan: 1 },
            { text: '100', header: false, rowspan: 1, colspan: 1 },
          ],
        ],
      },
    ],
    warnings: [],
    omitted_members: [],
  };
  const bytes = Buffer.from(JSON.stringify(extraction));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const relative = `documents/${candidate.code}/${receipt}/${sha}.json`;
  mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
  writeFileSync(path.join(directory, relative), bytes);
  owner.db
    .prepare('INSERT INTO filing_document_versions VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(
      candidate.code,
      receipt,
      'version-1',
      'a'.repeat(64),
      sha,
      'unused.zip',
      relative,
      documentConfig.parser_version,
      '2026-09-04T00:00:00.000Z',
      '{}',
    );
  owner.db
    .prepare(
      "UPDATE filing_documents SET current_version='version-1',state='ready'",
    )
    .run();
  const thesis = new ThesisStore(owner.db).create(
    candidate.code,
    randomUUID(),
    {
      ...emptyThesis(),
      body: '제품 구성 변화가 수익성에 연결되는지 확인한다.',
    },
  );
  const evidence = new ResearchEvidenceStore(owner.db, directory);
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    rmSync(resolved, { recursive: true });
  });
  return { owner, thesis, evidence };
}

function request(thesis, change = {}) {
  return {
    id: randomUUID(),
    thesis_id: thesis.id,
    thesis_revision: thesis.revision,
    relation: 'supports',
    note: '수익성 연결 여부를 추가 확인',
    receipt,
    document_version: 'version-1',
    section_id: 's0001',
    block_id: 'b11',
    ...change,
  };
}

test('manual link preserves exact immutable source and remains separate from thesis text', (t) => {
  const { owner, thesis, evidence } = fixture(t);
  const before = new ThesisStore(owner.db).list(candidate.code)[0];
  const linked = evidence.create(candidate.code, request(thesis));
  assert.equal(linked.relation, 'supports');
  assert.equal(linked.section_title, '1. 사업의 개요');
  assert.equal(linked.excerpt.rows[0][1].text, '100');
  assert.equal(linked.source_path, '/DOCUMENT/SECTION[1]/TABLE[1]');
  assert.deepEqual(new ThesisStore(owner.db).list(candidate.code)[0], before);
  assert.equal(owner.reviewBaseline(candidate.code), null);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM ai_request_attempts').get().n,
    0,
  );
});

test('linking validates current thesis and source, deduplicates, and archives without deletion', (t) => {
  const { owner, thesis, evidence } = fixture(t);
  const linked = evidence.create(candidate.code, request(thesis));
  assert.throws(() => evidence.create(candidate.code, request(thesis)), {
    status: 409,
  });
  const edited = new ThesisStore(owner.db).update(
    candidate.code,
    thesis.id,
    1,
    {
      content: { ...thesis.content, body: '수정한 투자포인트' },
    },
  );
  assert.throws(
    () => evidence.create(candidate.code, request(thesis, { block_id: 'b10' })),
    { status: 409 },
  );
  assert.equal(evidence.list(candidate.code, thesis.id)[0].thesis_revision, 1);
  assert.equal(edited.revision, 2);
  assert.throws(
    () =>
      evidence.create(candidate.code, request(edited, { block_id: 'missing' })),
    { status: 404 },
  );
  evidence.archive(candidate.code, linked.id, true);
  assert.equal(evidence.list(candidate.code, thesis.id).length, 0);
  assert.equal(evidence.list(candidate.code, thesis.id, true).length, 1);
  assert.equal(
    owner.db.prepare('SELECT count(*) AS n FROM research_evidence').get().n,
    1,
  );
});
