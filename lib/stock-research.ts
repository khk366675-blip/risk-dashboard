import type { StockEvent, StockPrice, StockQuarter } from './stock-detail';

export const financialMetrics = {
  rev: { label: '매출액', unit: '억원', color: 'var(--chart-1)' },
  op: { label: '영업이익', unit: '억원', color: 'var(--chart-1)' },
  ni: { label: '순이익', unit: '억원', color: 'var(--chart-4)' },
  ocf: { label: '영업현금흐름', unit: '억원', color: 'var(--chart-2)' },
  op_margin_pct: { label: '영업이익률', unit: '%', color: 'var(--chart-1)' },
  equity: { label: '자본', unit: '억원', color: 'var(--chart-2)' },
  debt: { label: '부채총계', unit: '억원', color: 'var(--chart-3)' },
  debt_ratio_pct: { label: '부채비율', unit: '%', color: 'var(--chart-3)' },
} as const;
export type FinancialMetric = keyof typeof financialMetrics;
export type PricePeriod = '1m' | '3m' | '1y' | 'all';

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function metricValue(quarter: StockQuarter, metric: FinancialMetric) {
  const value = numberOrNull(quarter[metric]);
  return value === null
    ? null
    : financialMetrics[metric].unit === '%'
      ? value
      : value / 100_000_000;
}

// Fill missing periods with nulls so a line never connects across missing quarters.
export function quarterSeries(quarters: StockQuarter[]): StockQuarter[] {
  const serial = (quarter: StockQuarter) =>
    quarter.year * 4 + Number(quarter.quarter[0]) - 1;
  const valid = quarters.filter(
    (q) => /^([1-4])Q$/.test(q.quarter) && Number.isInteger(q.year),
  );
  if (!valid.length) return [];
  const byPeriod = new Map(valid.map((q) => [serial(q), q]));
  const first = Math.min(...byPeriod.keys());
  const last = Math.max(...byPeriod.keys());
  return Array.from({ length: Math.min(last - first + 1, 80) }, (_, i) => {
    const period = Math.max(first, last - 79) + i;
    const year = Math.floor(period / 4);
    const quarter = `${(period % 4) + 1}Q`;
    return (
      byPeriod.get(period) ?? {
        year,
        quarter,
        label: `${String(year).slice(-2)} ${quarter}`,
      }
    );
  });
}

export function priceWindow(prices: StockPrice[], period: PricePeriod) {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  if (period === 'all' || !sorted.length) return sorted;
  const cutoff = new Date(`${sorted.at(-1)!.date}T00:00:00Z`);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(
    cutoff.getUTCMonth() - (period === '1m' ? 1 : period === '3m' ? 3 : 12),
  );
  const lastDay = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return sorted.filter(
    (price) => price.date >= cutoff.toISOString().slice(0, 10),
  );
}

export const eventCategories = {
  financing: '자금조달',
  earnings: '실적·재무',
  capital: '배당·자기주식',
  contract: '계약·수주',
  restructuring: '인수·투자·재편',
  governance: '지분·지배구조',
  risk: '위험·소송',
  routine: '주총·IR·안내',
  other: '분류 미확인',
} as const;
export type EventCategory = keyof typeof eventCategories;
export type FilingScope = 'focus' | 'all' | 'unclassified';
export type FilingClassification = {
  category: EventCategory;
  priority: 'focus' | 'reference' | 'unclassified';
  reason: string;
  amendment: '기재정정' | '첨부정정' | '첨부추가' | '정정' | null;
};

// Ordered title rules are navigation hints, never a content-level materiality judgment.
// Specific decisions precede generic report wrappers; routine filings stay accessible.
const filingRules: {
  pattern: RegExp;
  category: EventCategory;
  priority: 'focus' | 'reference';
  reason: string;
}[] = [
  {
    pattern:
      /횡령|배임|부도|파산|회생절차|자본잠식|상장폐지|관리종목|불성실공시|거래정지|매매거래정지|감사의견|감사범위제한|계속기업|소송|중재|가처분|채무불이행|원리금.*미지급|원리금.*연체|채무보증|담보제공|영업정지|생산중단/,
    category: 'risk',
    priority: 'focus',
    reason:
      '위험·법적 쟁점 또는 보증·담보 관련 제목입니다. 발생 여부와 조건을 확인하세요.',
  },
  {
    pattern:
      /최대주주변경|최대주주.*변경.*계약|경영권.*변경|경영권.*분쟁|공개매수|경영지배인/,
    category: 'governance',
    priority: 'focus',
    reason: '지배구조·경영권 변동과 관련된 공시입니다.',
  },
  {
    pattern:
      /타법인주식|출자증권|회사합병|회사분할|분할합병|합병등|영업양수|영업양도|영업양수도|유형자산|신규시설투자|금전대여|주권관련사채권의취득|주권관련사채권의처분/,
    category: 'restructuring',
    priority: 'focus',
    reason: '인수·투자·자산 거래 또는 사업 재편의 규모와 조건을 확인하세요.',
  },
  {
    pattern: /증권발행결과|증권발행실적보고|증권신고서.*정정.*제출기한/,
    category: 'financing',
    priority: 'reference',
    reason:
      '발행 결과·절차 보고입니다. 당초 결정과 실제 납입 결과를 대조하세요.',
  },
  {
    pattern:
      /유상증자|무상증자|유무상증자|전환사채|신주인수권부사채|교환사채|자기사채|사채권발행|증권신고서|투자설명서|소액공모|차입금|차입결정|전환가액|행사가액|전환청구|신주인수권행사|감자결정|감자완료/,
    category: 'financing',
    priority: 'focus',
    reason:
      '자금조달·상환 또는 주식 수 변동 관련 공시입니다. 규모·조건·희석 여부를 확인하세요.',
  },
  {
    pattern: /자기주식.*(결과|상황보고)|자기주식신탁.*상황보고/,
    category: 'capital',
    priority: 'reference',
    reason:
      '자기주식 집행·현황 보고입니다. 결정 내용과 실제 집행을 대조하세요.',
  },
  {
    pattern:
      /자기주식|주식소각|현금.*배당|주식배당|배당결정|배당정책|주주환원|기업가치제고/,
    category: 'capital',
    priority: 'focus',
    reason: '배당·자기주식·주주환원 관련 결정이나 계획을 확인하세요.',
  },
  {
    pattern: /단일판매|공급계약|수주계약|기술이전|기술도입|라이선스.*계약/,
    category: 'contract',
    priority: 'focus',
    reason: '계약 규모·기간·조건과 변경 여부를 확인하세요.',
  },
  {
    pattern:
      /매출액또는손익|잠정.*실적|영업.*잠정|실적.*공정공시|영업실적|사업보고서|반기보고서|분기보고서|감사보고서|검토보고서|연결재무제표|손익구조/,
    category: 'earnings',
    priority: 'focus',
    reason:
      '실적·정기 재무 자료입니다. 대상 기간과 연결·별도 기준을 확인하세요.',
  },
  {
    pattern:
      /대량보유|임원.*소유상황|임원.*거래계획|최대주주.*소유주식|주식소유현황|대표이사변경|사외이사|감사.*선임/,
    category: 'governance',
    priority: 'reference',
    reason:
      '지분·임원 변동 보고입니다. 변동 규모와 보유 목적은 원문에서 확인하세요.',
  },
  {
    pattern: /주주총회.*결과/,
    category: 'governance',
    priority: 'reference',
    reason: '주주총회 결과입니다. 의안별 승인 여부와 후속 결정을 확인하세요.',
  },
  {
    pattern:
      /주주총회|주주명부|의결권대리|기업설명회|IR개최|결산실적.*예고|공시규정.*공시사항.*진행|정기공시.*제출기한/,
    category: 'routine',
    priority: 'reference',
    reason:
      '주총·IR 또는 제출 절차 안내입니다. 일정과 안건은 원문에서 확인하세요.',
  },
  {
    pattern: /조회공시|풍문|보도.*해명|주요사항보고서/,
    category: 'other',
    priority: 'focus',
    reason:
      '조회·해명 또는 세부 유형이 미확인인 주요사항 공시입니다. 원문 확인이 필요합니다.',
  },
];

export function classifyFiling(event: StockEvent): FilingClassification {
  const title = (event.title ?? '').replace(/\s+/g, '');
  const amendment = title.includes('[기재정정]')
    ? '기재정정'
    : title.includes('[첨부정정]')
      ? '첨부정정'
      : title.includes('[첨부추가]')
        ? '첨부추가'
        : /\[[^\]]*정정\]/.test(title)
          ? '정정'
          : null;
  const rule = filingRules.find(({ pattern }) => pattern.test(title));
  if (rule) {
    // Withdrawal/cancellation must not disappear behind a routine-report rule.
    const changed = /철회|취소|해지|중단/.test(title);
    return {
      category: rule.category,
      priority: changed ? 'focus' : rule.priority,
      reason: changed
        ? '철회·취소·해지·중단 관련 내용이 있습니다. 기존 공시와 변경 내용을 대조하세요.'
        : rule.reason,
      amendment,
    };
  }
  const legacy: Record<string, EventCategory> = {
    positive_contract: 'contract',
    buyback: 'capital',
    dilution_risk: 'financing',
  };
  const category = legacy[event.importance ?? ''];
  if (category)
    return {
      category,
      priority: 'focus',
      reason:
        '기존 수집기의 유형 분류입니다. 구체적인 내용은 원문 확인이 필요합니다.',
      amendment,
    };
  return {
    category: 'other',
    priority: 'unclassified',
    reason:
      '제목만으로 유형을 분류하지 못했습니다. 중요하지 않다는 뜻은 아닙니다.',
    amendment,
  };
}

export function eventCategory(event: StockEvent): EventCategory {
  return classifyFiling(event).category;
}

export function filterFilings(
  events: StockEvent[],
  scope: FilingScope,
  category: EventCategory | 'all' = 'all',
  query = '',
) {
  const search = query.replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  return events
    .filter((event) => {
      const classification = classifyFiling(event);
      return (
        (scope === 'all' ||
          (scope === 'unclassified'
            ? classification.category === 'other'
            : classification.priority === 'focus')) &&
        (category === 'all' || classification.category === category) &&
        (event.title ?? '')
          .replace(/\s+/g, '')
          .toLocaleLowerCase('ko-KR')
          .includes(search)
      );
    })
    .sort((a, b) => {
      const dateKey = (date: string | null) =>
        /^\d{4}-?\d{2}-?\d{2}$/.test(date ?? '')
          ? date!.replaceAll('-', '')
          : '';
      return dateKey(b.date).localeCompare(dateKey(a.date));
    });
}

export const eventChecks: Record<EventCategory, string[]> = {
  contract: [
    '계약 금액과 최근 연간 매출을 비교하세요.',
    '계약 기간·조건, 해지 및 정정 공시를 확인하세요.',
  ],
  capital: [
    '결정·계획인지 실제 집행 결과인지 구분하세요.',
    '배당 기준일·지급일, 자기주식 취득·처분·소각 조건과 재원을 확인하세요.',
  ],
  financing: [
    '조달 규모·사용 목적과 기존 주식 수 대비 희석 가능성을 확인하세요.',
    '발행가·전환가 조정 조건, 납입일과 만기를 확인하세요.',
  ],
  earnings: [
    '대상 기간과 연결·별도 기준, 잠정치인지 확정치인지 확인하세요.',
    '전년 동기 실적·현금흐름과 비교하고 감사·검토 의견을 원문에서 확인하세요.',
  ],
  restructuring: [
    '인수·투자·자산 거래의 금액, 상대방과 자금 출처를 확인하세요.',
    '거래 조건·완료 일정과 종속회사 거래 여부, 후속 정정을 확인하세요.',
  ],
  governance: [
    '보유 목적·지분 변동 규모, 경영권 관련 계약과 조건을 확인하세요.',
    '주총 의안·승인 결과와 이사회 구성 변경 여부를 확인하세요.',
  ],
  risk: [
    '발생 사실·진행 단계와 회사의 입장을 구분하고 원문을 확인하세요.',
    '금액·담보·보증의 범위, 재무 영향과 후속 공시를 확인하세요.',
  ],
  routine: [
    '개최·기준 일정과 대상 주주, 주총 안건 또는 IR 자료를 확인하세요.',
    '일정 변경과 후속 결과 공시를 확인하세요.',
  ],
  other: [
    '원문에서 대상 기간과 결정 사항을 확인하세요.',
    '후속 공시와 정정 여부를 확인하세요.',
  ],
};

export function eventDate(date: string | null) {
  if (!date) return '날짜 미확인';
  return /^\d{8}$/.test(date)
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;
}
export function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function displayNumber(value: unknown, unit = '') {
  const number = numberOrNull(value);
  return number === null
    ? '—'
    : `${number.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${unit}`;
}
