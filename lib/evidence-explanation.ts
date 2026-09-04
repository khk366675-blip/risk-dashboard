import type { Lens } from './radar-run';
import type { StockDetail } from './stock-detail';

type Definition = {
  title: string;
  unit: string;
  meaning: string;
  check: string;
};
const definition = (
  title: string,
  unit: string,
  meaning: string,
  check: string,
): Definition => ({ title, unit, meaning, check });
const definitions: Record<string, Definition> = {
  positive_ocf: definition(
    '영업현금흐름',
    '원',
    '영업 활동에서 유입·유출된 현금의 순액입니다. TTM은 최근 네 분기 합계입니다.',
    '매출채권·재고·매입채무 변동과 일시적인 현금 유입을 대조하세요.',
  ),
  profit_persistence: definition(
    '영업흑자 분기 수',
    '개 분기',
    '수집된 최근 분기 중 영업이익이 양수인 분기 수입니다.',
    '분기 누락과 연결·별도 기준 변경, 일회성 항목을 확인하세요.',
  ),
  cash_conversion: definition(
    '영업이익의 현금 전환',
    '배',
    '영업현금흐름을 영업이익으로 나눈 값입니다. 현금과 회계 이익의 차이를 살펴봅니다.',
    '누적 현금흐름을 단독 분기로 환산했는지, 운전자본 효과가 일시적인지 확인하세요.',
  ),
  roe: definition(
    'ROE · 기말 자본 기준',
    '%',
    '최근 네 분기 순이익을 기말 자본으로 나눈 값입니다. 평균 자본 기준 ROE와 다릅니다.',
    '일회성 순이익, 작은 자본 규모, 비지배지분 포함 여부를 확인하세요.',
  ),
  interest_coverage: definition(
    '금융비용 커버리지',
    '배',
    '수집된 영업이익과 금융비용의 비율입니다. 이자비용만을 사용한 배율과 다를 수 있습니다.',
    '금융비용 구성과 실제 이자비용을 재무제표 주석에서 확인하세요.',
  ),
  debt_ratio: definition(
    '부채비율',
    '%',
    '부채총계를 자본으로 나눈 값입니다. 이자부 차입금만의 비율은 아닙니다.',
    '유동부채 구성과 만기, 보증·담보 등을 함께 확인하세요.',
  ),
  positive_margin: definition(
    '영업이익률',
    '%',
    '매출액 대비 영업이익의 비율입니다.',
    '원가율·판매관리비와 일회성 비용, 업종별 차이를 확인하세요.',
  ),
  revenue_growth: definition(
    '분기 매출 증가율',
    '%',
    '수집된 분기 매출을 전년 동기와 비교한 증가율입니다.',
    '동일 회계 기준인지, 기저효과와 연결 범위 변화가 있는지 확인하세요.',
  ),
  operating_profit_growth: definition(
    '분기 영업이익 증가율',
    '%',
    '수집된 분기 영업이익을 전년 동기와 비교한 증가율입니다.',
    '전년 기저와 일시적 비용·수익을 원문에서 대조하세요.',
  ),
  turnaround: definition(
    '흑자전환 분기의 영업이익',
    '원',
    'Radar가 전년 동기 영업적자에서 영업흑자로 바뀐 것으로 기록한 분기의 영업이익입니다.',
    '동일 연결 범위인지, 정상 영업과 일회성 요인의 구분이 가능한지 확인하세요.',
  ),
  loss_narrowing: definition(
    '영업손실 축소율',
    '%',
    '전년 동기 영업손실과 비교한 손실 축소 폭입니다. 흑자전환과는 다릅니다.',
    '현재도 적자인지, 비용 이연·일시적 효과가 있는지 확인하세요.',
  ),
  margin_improvement: definition(
    '영업이익률 변화',
    '%p',
    '전년 동기 대비 영업이익률의 차이입니다. 증가율이 아니라 퍼센트포인트입니다.',
    '가격·물량·제품 구성과 비용 변화를 확인하세요.',
  ),
  ocf_improvement: definition(
    '비교 분기 영업현금흐름',
    '원',
    '현금흐름 개선으로 포착된 분기의 금액입니다. 이 숫자 자체는 전년 대비 증가율이 아닙니다.',
    '전년 동기 원금액과 누적·단독 분기 환산을 확인하세요.',
  ),
  debt_improvement: definition(
    '부채비율 감소 폭',
    '%p',
    '전년 동기 부채비율에서 현재 비율을 뺀 차이입니다.',
    '부채 상환인지 자본 증가인지, 증자 등 원인을 구분해 확인하세요.',
  ),
  ttm_revenue_growth: definition(
    '최근 네 분기 매출 증가율',
    '%',
    '최근 네 분기 매출 합계를 이전 네 분기와 비교한 증가율입니다.',
    '연속 분기와 연결·별도 기준, 사업 범위 변화 여부를 확인하세요.',
  ),
  drawdown: definition(
    '고점 대비 하락률',
    '%',
    'Radar 가격 관측 구간의 고점 대비 하락 폭입니다. 기업가치 할인율은 아닙니다.',
    '가격 조정·주식 수 변동과 사업 실적의 변화를 별도로 확인하세요.',
  ),
  extreme_drawdown: definition(
    '큰 폭의 고점 대비 하락',
    '%',
    '고점 대비 하락률이 별도의 강한 하락 조건도 통과한 기록입니다.',
    '일반 하락률과 같은 가격을 사용하므로 독립된 사업 근거로 중복 계산하지 마세요.',
  ),
  relative_weakness: definition(
    '시장 내 상대 수익률 차이',
    '%p',
    '종목 수익률과 평가 대상 종목군의 기준 수익률 차이입니다. 실제 가격이 아닙니다.',
    '기준 종목군의 구성과 비교 기간이 같은지 확인하세요.',
  ),
  price_position: definition(
    '관측 가격 범위 내 위치',
    '%',
    '관측 구간 최저·최고 가격 사이에서의 위치입니다. 현재 주가나 확률이 아닙니다.',
    '가격 범위 위치만으로 회복 가능성이나 적정가치를 판단할 수 없습니다.',
  ),
  valuation_percentile: definition(
    '가치평가 배율 조건',
    '배',
    '기록된 값은 해당 평가 배율이며, 비교값은 당시 종목군에서 계산한 경계값입니다.',
    '어떤 배율인지 원기록에서 확인하세요. 업종·적자·일회성 이익에 따라 비교가 달라집니다.',
  ),
};
const filing = definition(
  '공시 분류 근거',
  '',
  '공시의 제목·분류와 접수 링크를 근거로 Radar가 포착한 기록입니다. 본문 분석 결과는 아닙니다.',
  '원문에서 규모·기간·조건과 정정 여부를 확인하세요. 내용이나 영향을 제목만으로 단정하지 마세요.',
);
const attention = definition(
  '거래대금 배율',
  '배',
  'Radar에 기록된 거래대금과 비교 기준의 배율입니다. 주가 상승률이나 특정 공시의 인과효과가 아닙니다.',
  '거래대금 비교 기간과 다른 동시 사건을 확인하세요. 공시가 원인이라고 단정하지 마세요.',
);

export type EvidenceFact = Definition & {
  id: string;
  key: string;
  value: number | string;
  display: string;
  comparison: string;
  period: string;
  source: string;
  url: string | null;
};
export type EvidencePacket = {
  code: string;
  name: string;
  lens: Lens;
  as_of: string;
  run_id: string | null;
  status: 'available' | 'insufficient_evidence';
  facts: EvidenceFact[];
  contradictions: string[];
  warnings: string[];
  missing: string[];
  source_url: string;
};
export type AiClaim = {
  source_ids: string[];
  explanation: string;
  question: string;
};
export type AiExplanation = {
  status: 'grounded' | 'insufficient_evidence';
  claims: AiClaim[];
};
export type EvidenceAiConfig = {
  model: string;
  prompt_version: string;
  endpoint: string;
  timeout_ms: number;
  max_output_tokens: number;
  max_input_bytes: number;
  max_response_bytes: number;
  cache_dir: string;
  cache_ttl_hours: number;
  max_requests_per_hour: number;
  source_stale_days: number;
  max_facts: number;
  max_claims: number;
  max_explanation_chars: number;
  max_question_chars: number;
};
export type ExplanationResult = {
  answer: AiExplanation;
  model: string;
  generated_at: string;
  cached: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
};

export function isLens(value: unknown): value is Lens {
  return ['quality', 'improvement', 'dislocation', 'event'].includes(
    String(value),
  );
}
function dartUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const receipt = url.searchParams.get('rcpNo');
    return url.protocol === 'https:' &&
      url.hostname === 'dart.fss.or.kr' &&
      url.pathname === '/dsaf001/main.do' &&
      /^\d{14}$/.test(receipt ?? '')
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`
      : null;
  } catch {
    return null;
  }
}
export function buildEvidencePacket(
  stock: StockDetail,
  lens: Lens,
  config: Pick<EvidenceAiConfig, 'source_stale_days' | 'max_facts'>,
  now = Date.now(),
): EvidencePacket {
  const result = stock.radar.lenses[lens];
  const warnings = [
    ...new Set([...(stock.warnings ?? []), ...stock.radar.warnings]),
  ];
  const missing: string[] = [];
  const facts: EvidenceFact[] = [];
  const runId = stock.run_id ?? null;
  if (!runId)
    missing.push('Radar 실행 식별자가 없어 선정 시점을 검증할 수 없습니다.');
  const time = Date.parse(`${stock.radar.as_of}T00:00:00Z`);
  const today = new Date(now).toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Seoul',
  });
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(stock.radar.as_of) &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === stock.radar.as_of;
  if (
    !validDate ||
    stock.radar.as_of > today ||
    Date.parse(`${today}T00:00:00Z`) - time >
      config.source_stale_days * 86_400_000 ||
    stock.radar.freshness === 'stale'
  ) {
    warnings.push(
      '이전 시점이거나 기준일을 확인할 수 없는 Radar 기록입니다. 현재 조건 통과 여부를 뜻하지 않습니다.',
    );
  }
  if (stock.research_run_id)
    warnings.push(
      '상세 보강 자료가 있어도 이 해설은 선정 당시 Radar 기록만 사용합니다. 최신 재무로 다시 판정하지 않습니다.',
    );
  if (stock.quarters.some((q) => q.warnings?.length))
    warnings.push(
      '상세 재무에 분기·현금흐름 관련 주의 사항이 있습니다. Radar 당시 계산을 원문에서 재확인하세요.',
    );
  if (!result?.matched || !stock.radar.matched_lenses.includes(lens))
    missing.push('이 렌즈의 선정 기록이 없습니다.');
  const evidence = result?.matched ? result.evidence : [];
  for (const [index, item] of evidence.entries()) {
    const info = item.key.startsWith('filing:')
      ? filing
      : item.key.startsWith('attention:')
        ? attention
        : definitions[item.key];
    const url = item.key.startsWith('filing:') ? dartUrl(item.value) : null;
    if (
      !info ||
      typeof item.source !== 'string' ||
      !item.source.trim() ||
      typeof item.period !== 'string' ||
      !item.period.trim() ||
      typeof item.comparison !== 'string' ||
      !item.comparison.trim() ||
      (item.key.startsWith('filing:')
        ? !url
        : typeof item.value !== 'number' || !Number.isFinite(item.value))
    ) {
      missing.push(
        `선정 근거 ${index + 1}: 값·출처·계산 정의 중 일부를 확인하지 못했습니다.`,
      );
      continue;
    }
    if (facts.length >= config.max_facts) {
      missing.push('근거 표시 한도를 초과했습니다. 원기록을 확인하세요.');
      break;
    }
    facts.push({
      ...info,
      id: `E${index + 1}`,
      key: item.key,
      value: url ?? item.value!,
      display: url
        ? '접수 원문 확인'
        : `${Number(item.value).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${info.unit}`,
      comparison: item.comparison,
      period: item.period,
      source: item.source,
      url,
    });
  }
  if (!facts.length) missing.push('설명 가능한 선정 근거가 없습니다.');
  return {
    code: stock.code,
    name: stock.name,
    lens,
    as_of: stock.radar.as_of,
    run_id: runId,
    status:
      runId &&
      facts.length &&
      result?.matched &&
      stock.radar.matched_lenses.includes(lens)
        ? 'available'
        : 'insufficient_evidence',
    facts,
    contradictions: [
      ...new Set([
        ...(result?.contradictions ?? []),
        ...stock.radar.contradictions,
      ]),
    ],
    warnings: [...new Set(warnings)],
    missing,
    source_url:
      stock.data_level === 'research'
        ? `/api/watchlist/${stock.code}`
        : `/data/radar/stocks/${stock.code}.json`,
  };
}

// Only a small public evidence package is sent. No watchlist membership, user
// checkpoints, raw filing bodies, local paths, credentials, or collection jobs.
export function aiInput(packet: EvidencePacket) {
  return {
    company: { code: packet.code, name: packet.name },
    lens: packet.lens,
    as_of: packet.as_of,
    evidence: packet.facts.map(
      ({ id, title, display, comparison, period, meaning, check }) => ({
        id,
        title,
        observed_value: display,
        comparison,
        period,
        definition: meaning,
        verification_question: check,
      }),
    ),
    contradictions: packet.contradictions,
    limitations: [...packet.missing, ...packet.warnings],
  };
}

export function validateExplanation(
  value: unknown,
  packet: EvidencePacket,
  config: Pick<
    EvidenceAiConfig,
    'max_claims' | 'max_explanation_chars' | 'max_question_chars'
  >,
): AiExplanation | null {
  if (!value || typeof value !== 'object') return null;
  const answer = value as AiExplanation;
  if (
    !['grounded', 'insufficient_evidence'].includes(answer.status) ||
    !Array.isArray(answer.claims) ||
    answer.claims.length > config.max_claims
  )
    return null;
  if (answer.status === 'insufficient_evidence')
    return answer.claims.length === 0
      ? { status: answer.status, claims: [] }
      : null;
  if (!answer.claims.length || packet.status !== 'available') return null;
  const ids = new Set(packet.facts.map((f) => f.id));
  // Numbers are rendered from the stored facts, never rewritten by the model.
  // This is a citation/format safety gate, not a proof of semantic correctness.
  const prohibited =
    /\p{N}|https?:|www\.|<|>|매수|매도|목표\s*주가|비중|투자\s*추천|수익\s*보장|보유\s*(권고|추천)|\b(buy|sell|hold|allocation|target price|guaranteed)\b/iu;
  for (const claim of answer.claims) {
    if (
      !claim ||
      !Array.isArray(claim.source_ids) ||
      !claim.source_ids.length ||
      claim.source_ids.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(claim.source_ids).size !== claim.source_ids.length
    )
      return null;
    if (
      typeof claim.explanation !== 'string' ||
      !claim.explanation.trim() ||
      claim.explanation.length > config.max_explanation_chars ||
      typeof claim.question !== 'string' ||
      !claim.question.trim() ||
      claim.question.length > config.max_question_chars
    )
      return null;
    if (prohibited.test(claim.explanation) || prohibited.test(claim.question))
      return null;
  }
  return {
    status: answer.status,
    claims: answer.claims.map((c) => ({
      source_ids: c.source_ids,
      explanation: c.explanation.trim(),
      question: c.question.trim(),
    })),
  };
}
