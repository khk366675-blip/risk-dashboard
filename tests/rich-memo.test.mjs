import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseRichMemo,
  memoPlainText,
  memoNumber,
  pasteMemoCells,
} from '../lib/rich-memo.ts';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ManualEvidenceStore } from '../lib/server/manual-evidence-store.ts';
import { ThesisEvidenceAiService } from '../lib/server/thesis-evidence-ai-service.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';

export const tinyImage =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=';
export const memoFixture = () => ({
  version: 1,
  blocks: [
    { type: 'text', style: 'heading', text: '수기 검토 자료' },
    {
      type: 'text',
      style: 'quote',
      text: '<script>alert(1)</script>는 실행하지 않는 원문 문자열',
    },
    {
      type: 'table',
      title: '분기별 수치',
      unit: '억원',
      chart: 'line',
      rows: [
        ['기간', '매출', '영업이익'],
        ['1Q', '1,200', '0'],
        ['2Q', '1,350', '-10'],
        ['3Q', '', '미확인'],
      ],
    },
    { type: 'image', src: tinyImage, caption: '사용자가 첨부한 그래프 설명' },
  ],
});

test('rich memo preserves exact tables, captions and safe plain-text fallback', () => {
  const document = parseRichMemo(memoFixture());
  assert.deepEqual(document, memoFixture());
  const text = memoPlainText(document);
  assert.match(text, /1Q \| 1,200 \| 0/);
  assert.match(text, /2Q \| 1,350 \| -10/);
  assert.match(text, /내용 자동 판독 안 함/);
  assert.doesNotMatch(text, /data:image|base64/);
  assert.equal(parseRichMemo(undefined), null);
});

test('graphs do not invent zero, coerce units or evaluate spreadsheet formulas', () => {
  for (const [input, expected] of [
    ['0', 0],
    ['-10', -10],
    ['1,234.5', 1234.5],
    ['', null],
    ['-', null],
    ['미확인', null],
    ['10%', null],
    ['2억원', null],
    ['1,2', null],
    ['=SUM(A1)', null],
    ['Infinity', null],
    ['9007199254740992', null],
  ])
    assert.equal(memoNumber(input), expected, input);
});

test('Excel TSV supports quoted tabs/newlines, preserves cells and enforces bounds', () => {
  const result = pasteMemoCells(
    [
      ['항목', '값'],
      ['old', '0'],
    ],
    '기간\t매출\n"상반기\n누적"\t1,200\n',
    0,
    0,
  );
  assert.deepEqual(result, [
    ['기간', '매출'],
    ['상반기\n누적', '1,200'],
  ]);
  assert.deepEqual(
    pasteMemoCells(
      [
        ['A', 'B'],
        ['', ''],
      ],
      '"A\tB"\t"""인용"""',
      1,
      0,
    )[1],
    ['A\tB', '"인용"'],
  );
  assert.throws(() =>
    pasteMemoCells(
      [
        ['A', 'B'],
        ['', ''],
      ],
      'x\t'.repeat(9),
      0,
      0,
    ),
  );
  assert.throws(() =>
    pasteMemoCells(
      [
        ['A', 'B'],
        ['', ''],
      ],
      '"broken',
      0,
      0,
    ),
  );
});

test('reject external images, SVG, oversized/invalid documents and ragged tables', () => {
  for (const src of [
    'https://tracker.example/x.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
  ])
    assert.throws(() =>
      parseRichMemo({
        version: 1,
        blocks: [{ type: 'image', src, caption: '' }],
      }),
    );
  const bad = memoFixture();
  bad.blocks[2].rows[1].pop();
  assert.throws(() => parseRichMemo(bad));
  assert.throws(() =>
    parseRichMemo({
      version: 1,
      blocks: [{ type: 'html', text: '<img onerror=alert(1)>' }],
    }),
  );
  assert.throws(() =>
    parseRichMemo({
      version: 1,
      blocks: Array(25).fill({ type: 'text', style: 'paragraph', text: 'x' }),
    }),
  );
  assert.throws(() =>
    parseRichMemo({
      version: 1,
      blocks: [{ type: 'text', style: 'paragraph', text: 'x'.repeat(6001) }],
    }),
  );
});

test('memo persists atomically, participates in dedupe, archives recoverably, and AI sees only text', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-rich-memo-'));
  const owner = new ResearchStore(directory);
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    rmSync(resolved, { recursive: true });
  });
  const radar = JSON.parse(
    readFileSync('public/data/radar/latest.json', 'utf8'),
  );
  const candidate = radar.candidates[0];
  owner.register(
    candidate,
    radar,
    JSON.parse(
      readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
    ),
  );
  const thesis = new ThesisStore(owner.db).create(
    candidate.code,
    randomUUID(),
    { ...emptyThesis(), body: '격리 검증용' },
  );
  const store = new ManualEvidenceStore(owner.db);
  const input = {
    id: randomUUID(),
    thesis_id: thesis.id,
    thesis_revision: 1,
    relation: 'context',
    source_type: 'memo',
    title: '복합 메모',
    url: '',
    source_name: '수기',
    published_at: '',
    body: '서버가 신뢰하지 않을 임의 본문',
    note: '',
    document: memoFixture(),
  };
  const saved = store.create(candidate.code, input);
  assert.equal(saved.body, memoPlainText(memoFixture()));
  assert.deepEqual(saved.document, memoFixture());
  assert.deepEqual(store.create(candidate.code, input), saved);
  const changed = structuredClone(input);
  changed.document.blocks[2].chart = 'bar';
  assert.throws(() => store.create(candidate.code, changed), { status: 409 });
  const newId = randomUUID();
  assert.throws(() =>
    store.create(candidate.code, { ...changed, id: newId }, () => {
      throw new Error('rollback');
    }),
  );
  assert.equal(
    owner.db
      .prepare('SELECT 1 FROM research_manual_documents WHERE manual_id=?')
      .get(newId),
    undefined,
  );
  const evidence = new ThesisEvidenceAiService(owner.db).evidence(thesis.id);
  assert.match(evidence[0].excerpt, /1,200/);
  assert.doesNotMatch(JSON.stringify(evidence), /data:image|base64/);
  store.archive(candidate.code, saved.id, true);
  assert.equal(store.list(candidate.code).length, 0);
  assert.deepEqual(
    store.list(candidate.code, undefined, true)[0].document,
    memoFixture(),
  );
  store.archive(candidate.code, saved.id, false);
  assert.deepEqual(store.list(candidate.code)[0].document, memoFixture());
});
