import assert from 'node:assert/strict';
import test from 'node:test';
import {
  metricValue,
  quarterSeries,
  priceWindow,
  eventCategory,
  classifyFiling,
  filterFilings,
  eventDate,
  safeSourceUrl,
  displayNumber,
} from '../lib/stock-research.ts';

test('financial chart preserves missing, zero, negative and actual units', () => {
  assert.equal(metricValue({}, 'rev'), null);
  assert.equal(metricValue({ rev: null }, 'rev'), null);
  assert.equal(metricValue({ rev: 0 }, 'rev'), 0);
  assert.equal(metricValue({ op: -150_000_000 }, 'op'), -1.5);
  assert.equal(metricValue({ op_margin_pct: 12.3 }, 'op_margin_pct'), 12.3);
  assert.equal(metricValue({ rev: Infinity }, 'rev'), null);
});
test('missing calendar quarter remains a gap across year boundary', () => {
  const rows = quarterSeries([
    { year: 2026, quarter: '1Q', label: '26 1Q', op: 30 },
    { year: 2025, quarter: '3Q', label: '25 3Q', op: 20 },
  ]);
  assert.deepEqual(
    rows.map((q) => q.quarter),
    ['3Q', '4Q', '1Q'],
  );
  assert.equal(metricValue(rows[1], 'op'), null);
  assert.deepEqual(quarterSeries([]), []);
});
test('period switch uses calendar months from latest record, never rebases prices', () => {
  const prices = [
    { date: '2026-08-31', close: 16580 },
    { date: '2026-07-30', close: 14000 },
    { date: '2026-07-31', close: 15000 },
  ];
  assert.deepEqual(
    priceWindow(prices, '1m').map((row) => row.close),
    [15000, 16580],
  );
  assert.equal(priceWindow(prices, 'all').length, 3);
  assert.equal(prices[0].date, '2026-08-31');
  assert.deepEqual(priceWindow([], '1y'), []);
});
test('month-end clamps to the last valid day', () => {
  const prices = [
    { date: '2026-02-28', close: 20 },
    { date: '2026-03-31', close: 30 },
  ];
  assert.equal(priceWindow(prices, '1m').length, 2);
});
test('filing categories and unknown dates use visible fallbacks', () => {
  assert.equal(eventCategory({ importance: 'dilution_risk' }), 'financing');
  assert.equal(eventCategory({ importance: 'buyback' }), 'capital');
  assert.equal(eventCategory({ importance: 'unknown' }), 'other');
  assert.equal(eventDate('20260902'), '2026-09-02');
  assert.equal(eventDate(null), '날짜 미확인');
});
test('source links cannot become javascript or empty anchors', () => {
  assert.equal(safeSourceUrl('javascript:alert(1)'), null);
  assert.equal(safeSourceUrl('#'), null);
  assert.equal(safeSourceUrl(null), null);
  assert.equal(
    safeSourceUrl('https://dart.fss.or.kr/'),
    'https://dart.fss.or.kr/',
  );
  assert.equal(displayNumber(null), '—');
  assert.equal(displayNumber(NaN), '—');
});

const filing = (title, extra = {}) => ({
  id: title,
  title,
  date: '20260902',
  url: 'https://dart.fss.or.kr/',
  importance: null,
  direction: 'review',
  ...extra,
});

test('actual financing titles including CB/BW resale and exercise are grouped together', () => {
  for (const title of [
    '주요사항보고서(전환사채권발행결정)',
    '[기재정정]주요사항보고서(신주인수권부사채권발행결정)',
    '기타경영사항(자율공시) (제14회차 신주인수권부사채 만기전 취득 후 재매각)',
    '기타경영사항(자율공시) (자기사채(제13회차 전환사채) 소각 결정)',
    '신주인수권행사',
    '전환청구권행사',
    '전환가액의조정',
    '유상증자결정(종속회사의주요경영사항)',
    '단기차입금증가결정',
    '신주인수권부사채(해외신주인수권부사채포함)발행후만기전사채취득',
  ]) {
    const result = classifyFiling(filing(title));
    assert.equal(result.category, 'financing', title);
    assert.equal(result.priority, 'focus', title);
  }
});
test('specific transactions, financials, returns and contracts take precedence over wrappers', () => {
  for (const [title, category] of [
    ['주요사항보고서(타법인주식및출자증권양수결정)', 'restructuring'],
    ['[첨부추가]주요사항보고서(회사합병결정)', 'restructuring'],
    ['주권관련사채권의취득결정', 'restructuring'],
    ['합병등종료보고서(자산양수도)', 'restructuring'],
    ['금전대여결정', 'restructuring'],
    ['감사보고서제출', 'earnings'],
    ['매출액또는손익구조30%(대규모법인은15%)이상변동', 'earnings'],
    ['[기재정정]분기보고서 (2026.03)', 'earnings'],
    ['현금ㆍ현물배당결정', 'capital'],
    ['주요사항보고서(자기주식취득신탁계약체결결정)', 'capital'],
    ['단일판매ㆍ공급계약체결', 'contract'],
    ['최대주주변경을수반하는주식양수도계약체결', 'governance'],
  ]) {
    assert.equal(classifyFiling(filing(title)).category, category, title);
    assert.equal(classifyFiling(filing(title)).priority, 'focus', title);
  }
});
test('routine ownership and procedural reports remain available, overriding broad legacy hints', () => {
  for (const [title, category] of [
    ['주식등의대량보유상황보고서(일반)', 'governance'],
    ['[기재정정]주식등의대량보유상황보고서(일반)', 'governance'],
    ['임원ㆍ주요주주특정증권등소유상황보고서', 'governance'],
    ['임원ㆍ주요주주특정증권등거래계획보고서', 'governance'],
    ['정기주주총회결과', 'governance'],
    ['주주명부폐쇄기간또는기준일설정', 'routine'],
    ['주주총회소집공고', 'routine'],
    ['기업설명회(IR)개최', 'routine'],
    ['증권발행결과(자율공시)', 'financing'],
    ['자기주식취득결과보고서', 'capital'],
  ]) {
    const result = classifyFiling(filing(title, { importance: 'buyback' }));
    assert.equal(result.category, category, title);
    assert.equal(result.priority, 'reference', title);
    assert.equal(filterFilings([filing(title)], 'all').length, 1);
  }
});
test('risk, withdrawal and cancellation are never hidden by generic reporting rules', () => {
  for (const title of [
    '최대주주변경을수반하는주식담보제공계약체결',
    '주요사항보고서(소송등의제기)',
    '횡령ㆍ배임혐의발생',
    '기타경영사항(자율공시)(상장폐지 관련 안내)',
    '감사보고서제출(감사의견거절)',
    '대출원리금연체사실발생',
    '관리종목지정해제',
    '단일판매ㆍ공급계약해지',
    '[철회]증권발행결과(자율공시)',
    '기업설명회(IR)개최취소',
  ])
    assert.equal(classifyFiling(filing(title)).priority, 'focus', title);
  assert.equal(eventCategory(filing('감사보고서제출')), 'earnings');
  assert.equal(eventCategory(filing('감사보고서제출(감사의견거절)')), 'risk');
});
test('amendments are labeled without changing raw titles or merging repeated filings', () => {
  for (const amendment of ['기재정정', '첨부정정', '첨부추가']) {
    const title = `[${amendment}]주요사항보고서(전환사채권발행결정)`;
    assert.equal(classifyFiling(filing(title)).amendment, amendment);
  }
  const title = '단일판매ㆍ공급계약체결';
  const rows = [
    filing(title, { id: 'a' }),
    filing(title, { id: 'b' }),
    filing(`[기재정정]${title}`, { id: 'c' }),
  ];
  const before = JSON.stringify(rows);
  assert.equal(filterFilings(rows, 'focus').length, 3);
  assert.equal(JSON.stringify(rows), before);
});
test('unknown filings stay visibly unclassified, not declared unimportant', () => {
  for (const title of [null, '', '새로운공시유형']) {
    const result = classifyFiling(filing(title));
    assert.equal(result.category, 'other');
    assert.equal(result.priority, 'unclassified');
    assert.equal(filterFilings([filing(title)], 'unclassified').length, 1);
  }
  const major = filing('주요사항보고서(새로운유형)');
  assert.equal(filterFilings([major], 'focus').length, 1);
  assert.equal(filterFilings([major], 'unclassified').length, 1);
});
test('scopes, categories, tolerant search and date sorting preserve all source records', () => {
  const rows = [
    filing('기업설명회(IR)개최', { date: '20260903' }),
    filing('단기차입금증가결정     ', { date: '20260901' }),
    filing('[기재정정] 단기차입금증가결정', { date: '2026-09-02' }),
    filing('분기보고서', { date: null }),
  ];
  assert.equal(filterFilings(rows, 'all').length, 4);
  assert.equal(filterFilings(rows, 'focus').length, 3);
  assert.equal(filterFilings(rows, 'all', 'all', ' ir ').length, 1);
  assert.deepEqual(
    filterFilings(rows, 'focus', 'financing', '단기 차입금').map(
      (row) => row.date,
    ),
    ['2026-09-02', '20260901'],
  );
  assert.equal(filterFilings(rows, 'all').at(-1).date, null);
  assert.equal(filterFilings(rows, 'focus', 'financing', '없는내용').length, 0);
  assert.deepEqual(filterFilings([], 'focus'), []);
});
