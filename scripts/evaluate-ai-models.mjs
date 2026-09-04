import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  thesisQuestionInstructions,
  thesisQuestionOutputSchema,
} from '../lib/server/thesis-ai-service.ts';
import {
  thesisEvidenceReviewInstructions,
  thesisEvidenceReviewOutputSchema,
} from '../lib/server/thesis-evidence-ai-service.ts';
import {
  thesisAiConfig,
  validateSuggestions,
} from '../lib/thesis-ai.ts';
import {
  thesisEvidenceAiConfig,
  validateEvidenceReview,
} from '../lib/thesis-evidence-ai.ts';

try {
  process.loadEnvFile(resolve('.env.local'));
} catch {}

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error('.env.local의 OPENAI_API_KEY가 필요합니다.');

const modelRates = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-sol': { input: 4, output: 20 },
};

const args = process.argv.slice(2);
const requestedScenarios = args
  .filter((arg) => arg.startsWith('--scenario='))
  .flatMap((arg) => arg.slice('--scenario='.length).split(','))
  .filter(Boolean);
const requestedModels = args.filter((arg) => !arg.startsWith('--scenario='));
const specs = (requestedModels.length
  ? requestedModels
  : ['gpt-5.6-luna:medium', 'gpt-5.6-terra:medium', 'gpt-5.6-sol:medium']
).map((raw) => {
  const [model, effort = 'medium'] = raw.split(':');
  if (!modelRates[model]) throw new Error(`지원하지 않는 비교 모델: ${model}`);
  return { model, effort };
});

const strongQuestionInput = {
  company: { code: '000001', name: '가상소비재' },
  point: {
    title: '수출 채널 확대로 성장과 수익성이 함께 개선된다',
    body: '최근 분기 매출이 전년 동기 대비 30.9% 증가했다. 성장의 원천이 반복 가능한 물량·판가·제품 믹스 변화이고, 고정비 레버리지로 영업이익률과 현금창출력이 함께 개선될 것으로 본다.',
    timing: '향후 2개 분기 실적에서 확인',
    weakens: '매출 성장 둔화와 영업이익률 하락이 동시에 나타나거나 운전자본 부담이 커지는 경우',
  },
  existing_questions: [
    '매출 증가가 특정 고객의 일회성 선주문에 따른 것은 아닌가?',
  ],
};

const vagueQuestionInput = {
  company: { code: '000002', name: '가상산업재' },
  point: {
    title: '해외 진출이 잘될 것 같다',
    body: '해외 시장이 크고 회사도 준비하고 있으니 앞으로 많이 성장할 것 같다.',
    timing: '아직 정하지 않음',
    weakens: '잘 모르겠음',
  },
  existing_questions: [],
};

const evidenceInput = {
  company: { code: '000003', name: '가상식품소재' },
  point: {
    id: '00000000-0000-4000-8000-000000000003',
    revision: 1,
    title: '매출 성장과 고마진 구조의 지속성',
    body: '최근 분기 매출이 전년 동기 대비 30.9% 증가했고 최근 4분기 영업이익률 16.3%, ROE 25.8%, 영업현금흐름/영업이익 1.63배를 기록했다. 성장의 원천이 반복 가능한 물량·판가·제품 믹스 변화인지 확인한다.',
    timing: '향후 2개 분기 실적에서 확인',
    weakens: '매출 성장 둔화와 영업이익률 하락이 동시에 나타나거나 현금전환이 악화되는 경우',
    existing_questions: [],
  },
  evidence: [
    {
      id: 'financial:sales-current',
      kind: 'financial',
      relation: 'supports',
      label: '매출액',
      excerpt: '{"value":499.2,"unit":"억원","statement_basis":"연결"}',
      period: '2026 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
    {
      id: 'financial:sales-prior',
      kind: 'financial',
      relation: 'context',
      label: '매출액',
      excerpt: '{"value":381.3,"unit":"억원","statement_basis":"연결"}',
      period: '2025 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
    {
      id: 'financial:margin-current',
      kind: 'financial',
      relation: 'supports',
      label: '영업이익률',
      excerpt: '{"value":16.6,"unit":"%","statement_basis":"연결"}',
      period: '2026 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
    {
      id: 'manual:channel-note',
      kind: 'manual',
      relation: 'supports',
      label: '수출 채널 메모',
      excerpt: '주요 고객향 주문이 늘어난 것으로 추정되지만 원문과 기간은 아직 확인하지 못했다.',
      period: null,
      source_name: '사용자 메모',
      source_status: 'unverified',
    },
  ],
};

const turnaroundQuestionInput = {
  company: { code: '000004', name: '가상화학' },
  point: {
    title: '원재료 부담 완화로 수익성이 회복된다',
    body: '원재료 가격이 정상화되고 고부가 제품 비중이 늘면서 영업이익률이 회복될 것으로 본다. 다만 최근 판매량은 줄고 재고는 늘었다.',
    timing: '다음 반기까지 확인',
    weakens: '판가 하락이 원가 하락보다 빠르거나 재고 부담이 이어지는 경우',
  },
  existing_questions: ['원재료 가격 하락분이 손익에 반영되는 시차는 얼마인가?'],
};

const capacityQuestionInput = {
  company: { code: '000005', name: '가상부품' },
  point: {
    title: '신공장 증설이 신규 고객 매출로 연결된다',
    body: '회사는 생산능력을 늘리고 있다. 고객 승인이 완료되면 가동률 상승과 매출 성장이 나타나고 규모의 경제로 수익성도 개선될 것으로 본다.',
    timing: '2027년 양산 이후 확인',
    weakens: '고객 승인 지연, 낮은 가동률, 추가 차입 부담이 발생하는 경우',
  },
  existing_questions: [],
};

const contradictoryEvidenceInput = {
  company: { code: '000006', name: '가상장비' },
  point: {
    id: '00000000-0000-4000-8000-000000000006',
    revision: 1,
    title: '고객 다변화로 매출과 이익률이 함께 개선된다',
    body: '신규 고객 매출이 기존 고객의 부진을 상쇄해 전체 매출이 성장하고 영업이익률도 개선될 것으로 본다.',
    timing: '향후 2개 분기 실적에서 확인',
    weakens: '전체 매출 감소가 이어지거나 신규 고객 관련 비용으로 이익률이 하락하는 경우',
    existing_questions: [],
  },
  evidence: [
    {
      id: 'financial:sales-now',
      kind: 'financial',
      relation: 'supports',
      label: '매출액',
      excerpt: '{"value":820,"unit":"억원","statement_basis":"연결"}',
      period: '2026 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
    {
      id: 'financial:sales-before',
      kind: 'financial',
      relation: 'context',
      label: '매출액',
      excerpt: '{"value":910,"unit":"억원","statement_basis":"연결"}',
      period: '2025 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
    {
      id: 'financial:margin-now',
      kind: 'financial',
      relation: 'supports',
      label: '영업이익률',
      excerpt: '{"value":12.1,"unit":"%","statement_basis":"연결"}',
      period: '2026 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
    {
      id: 'financial:margin-before',
      kind: 'financial',
      relation: 'context',
      label: '영업이익률',
      excerpt: '{"value":8.4,"unit":"%","statement_basis":"연결"}',
      period: '2025 Q2',
      source_name: 'DART 재무 snapshot',
      source_status: 'ok',
    },
  ],
};

const thinEvidenceInput = {
  company: { code: '000007', name: '가상플랫폼' },
  point: {
    id: '00000000-0000-4000-8000-000000000007',
    revision: 1,
    title: '신사업이 큰 폭의 이익 성장을 만든다',
    body: '새로운 서비스의 고객 반응이 좋아 본업보다 높은 수익성을 만들 것으로 본다.',
    timing: '다음 연간 실적에서 확인',
    weakens: '유료 고객과 이익 기여가 확인되지 않는 경우',
    existing_questions: [],
  },
  evidence: [
    {
      id: 'manual:rumor',
      kind: 'manual',
      relation: 'supports',
      label: '산업 메모',
      excerpt: '업계에서 수요가 좋다는 이야기를 들었지만 출처와 대상 회사는 확인하지 못했다.',
      period: null,
      source_name: '사용자 메모',
      source_status: 'unverified',
    },
  ],
};

const scenarios = [
  {
    id: 'questions-causal',
    task: 'questions',
    input: strongQuestionInput,
    instructions: thesisQuestionInstructions,
    schema: thesisQuestionOutputSchema(thesisAiConfig),
    maxOutputTokens: thesisAiConfig.max_output_tokens,
    validate: (value) => validateSuggestions(value, strongQuestionInput),
  },
  {
    id: 'questions-vague',
    task: 'questions',
    input: vagueQuestionInput,
    instructions: thesisQuestionInstructions,
    schema: thesisQuestionOutputSchema(thesisAiConfig),
    maxOutputTokens: thesisAiConfig.max_output_tokens,
    validate: (value) => validateSuggestions(value, vagueQuestionInput),
  },
  {
    id: 'evidence-mixed',
    task: 'evidence',
    input: evidenceInput,
    instructions: thesisEvidenceReviewInstructions,
    schema: thesisEvidenceReviewOutputSchema(thesisEvidenceAiConfig),
    maxOutputTokens: thesisEvidenceAiConfig.max_output_tokens,
    validate: (value) =>
      validateEvidenceReview(value, evidenceInput, thesisEvidenceAiConfig),
  },
  {
    id: 'questions-turnaround',
    task: 'questions',
    input: turnaroundQuestionInput,
    instructions: thesisQuestionInstructions,
    schema: thesisQuestionOutputSchema(thesisAiConfig),
    maxOutputTokens: thesisAiConfig.max_output_tokens,
    validate: (value) => validateSuggestions(value, turnaroundQuestionInput),
  },
  {
    id: 'questions-capacity',
    task: 'questions',
    input: capacityQuestionInput,
    instructions: thesisQuestionInstructions,
    schema: thesisQuestionOutputSchema(thesisAiConfig),
    maxOutputTokens: thesisAiConfig.max_output_tokens,
    validate: (value) => validateSuggestions(value, capacityQuestionInput),
  },
  {
    id: 'evidence-contradictory',
    task: 'evidence',
    input: contradictoryEvidenceInput,
    instructions: thesisEvidenceReviewInstructions,
    schema: thesisEvidenceReviewOutputSchema(thesisEvidenceAiConfig),
    maxOutputTokens: thesisEvidenceAiConfig.max_output_tokens,
    validate: (value) =>
      validateEvidenceReview(
        value,
        contradictoryEvidenceInput,
        thesisEvidenceAiConfig,
      ),
  },
  {
    id: 'evidence-thin',
    task: 'evidence',
    input: thinEvidenceInput,
    instructions: thesisEvidenceReviewInstructions,
    schema: thesisEvidenceReviewOutputSchema(thesisEvidenceAiConfig),
    maxOutputTokens: thesisEvidenceAiConfig.max_output_tokens,
    validate: (value) =>
      validateEvidenceReview(value, thinEvidenceInput, thesisEvidenceAiConfig),
  },
];

const selectedScenarios = requestedScenarios.length
  ? scenarios.filter((scenario) => requestedScenarios.includes(scenario.id))
  : scenarios;
if (!selectedScenarios.length) throw new Error('실행할 시나리오가 없습니다.');

function extractText(result) {
  return (result.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text ?? '')
    .join('');
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function scoreAnswer(scenario, answer) {
  const notes = [];
  let score = 2; // API + schema + local provenance validator passed.
  if (scenario.id === 'questions-causal') {
    if (answer.status === 'questions') score += 1;
    else notes.push('구체적 가설을 명료화 필요로 오판');
    if (answer.suggestions.length >= 4) score += 1;
    else notes.push('질문 수가 적음');
    if (answer.suggestions.some((item) => item.kind === 'challenge')) score += 1;
    else notes.push('대안 설명 질문 없음');
    if (new Set(answer.suggestions.map((item) => item.source_kind)).size >= 3)
      score += 1;
    else notes.push('필요 자료 유형이 편중됨');
    const text = JSON.stringify(answer);
    for (const terms of [
      ['물량', '판가', '제품 믹스', '고객'],
      ['영업이익률', '고정비', '마진'],
      ['현금', '운전자본'],
      ['일회성', '선주문', '대안'],
    ]) {
      if (includesAny(text, terms)) score += 1;
      else notes.push(`${terms.join('/')} 관점 누락`);
    }
  } else if (scenario.id === 'questions-vague') {
    if (answer.status === 'needs_clarification') score += 2;
    else notes.push('모호한 가설인데 검증 질문으로 바로 진행');
    const clarificationCount = answer.suggestions.filter(
      (item) => item.kind === 'clarification',
    ).length;
    if (clarificationCount >= 3) score += 2;
    else notes.push('구체화 질문이 충분하지 않음');
    const text = JSON.stringify(answer);
    for (const terms of [
      ['국가', '시장', '지역'],
      ['제품', '서비스', '고객'],
      ['매출', '수익', '경제성'],
      ['시점', '기간', '확인'],
    ]) {
      if (includesAny(text, terms)) score += 1;
      else notes.push(`${terms.join('/')} 구체화 누락`);
    }
  } else if (scenario.id === 'evidence-mixed') {
    if (answer.status === 'review_ready') score += 1;
    else notes.push('검토 가능한 연결 자료를 불충분으로 오판');
    if (answer.findings.length >= 4) score += 1;
    else notes.push('핵심 공백을 충분히 분해하지 못함');
    if (answer.findings.some((item) => item.kind === 'gap')) score += 1;
    else notes.push('논리 공백 지적 없음');
    const text = JSON.stringify(answer);
    for (const terms of [
      ['ROE', '자기자본이익률'],
      ['현금흐름', '현금전환'],
      ['최근 4분기', '기간', '누적', '동일 기준'],
      ['물량', '판가', '제품 믹스'],
      ['미확인', '검증되지', '사용자 메모', '원문'],
    ]) {
      if (includesAny(text, terms)) score += 1;
      else notes.push(`${terms.join('/')} 검토 누락`);
    }
  } else if (scenario.id === 'questions-turnaround') {
    if (answer.status === 'questions') score += 1;
    if (answer.suggestions.length >= 4) score += 1;
    if (answer.suggestions.some((item) => item.kind === 'challenge')) score += 1;
    const text = JSON.stringify(answer);
    for (const terms of [
      ['원재료', '원가'],
      ['재고', '시차'],
      ['판가', '가격'],
      ['판매량', '물량'],
      ['현금', '운전자본'],
    ]) {
      if (includesAny(text, terms)) score += 1;
      else notes.push(`${terms.join('/')} 관점 누락`);
    }
  } else if (scenario.id === 'questions-capacity') {
    if (answer.status === 'questions') score += 1;
    if (answer.suggestions.length >= 4) score += 1;
    if (answer.suggestions.some((item) => item.kind === 'challenge')) score += 1;
    const text = JSON.stringify(answer);
    for (const terms of [
      ['고객 승인', '수주'],
      ['가동률', '생산능력'],
      ['차입', '자금', '현금'],
      ['규모의 경제', '단위', '고정비'],
      ['지연', '양산'],
    ]) {
      if (includesAny(text, terms)) score += 1;
      else notes.push(`${terms.join('/')} 관점 누락`);
    }
  } else if (scenario.id === 'evidence-contradictory') {
    if (answer.status === 'review_ready') score += 1;
    const salesIds = new Set(['financial:sales-now', 'financial:sales-before']);
    if (
      answer.findings.some(
        (item) =>
          item.kind === 'tension' &&
          item.source_ids.filter((id) => salesIds.has(id)).length === 2,
      )
    )
      score += 4;
    else notes.push('매출 감소와 성장 가설의 직접 충돌을 두 기간 근거로 연결하지 못함');
    const text = JSON.stringify(answer);
    if (includesAny(text, ['고객', '다변화', '신규'])) score += 2;
    else notes.push('고객 다변화 인과 근거 공백 누락');
    if (includesAny(text, ['기준', '기간', '동일'])) score += 1;
    else notes.push('기간·기준 비교 확인 누락');
  } else if (scenario.id === 'evidence-thin') {
    if (answer.status === 'insufficient_evidence' && !answer.findings.length) {
      score = 8;
      notes.push('안전하게 중단했지만 다음 확인 행동은 제안하지 않음');
    } else {
      const text = JSON.stringify(answer);
      const grounded = answer.findings.every(
        (item) =>
          item.source_ids.length === 0 ||
          item.source_ids.every((id) => id === 'manual:rumor'),
      );
      if (grounded) score += 2;
      else notes.push('공급되지 않은 출처를 인용함');
      if (includesAny(text, ['출처', '원출처']) && includesAny(text, ['대상 회사', '해당 회사']))
        score += 3;
      else notes.push('메모의 출처·대상 불명확성을 충분히 지적하지 않음');
      if (includesAny(text, ['유료', '비용', '이익', '수익성'])) score += 3;
      else notes.push('수요에서 경제성으로 가는 논리 공백을 지적하지 않음');
    }
  }
  return { score: Math.min(10, score), notes };
}

async function run(spec, scenario) {
  const started = performance.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: spec.model,
      store: false,
      reasoning: { effort: spec.effort },
      max_output_tokens: scenario.maxOutputTokens,
      input: [
        { role: 'developer', content: scenario.instructions },
        { role: 'user', content: JSON.stringify(scenario.input) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: scenario.task === 'questions' ? 'thesis_questions' : 'thesis_evidence_review',
          strict: true,
          schema: scenario.schema,
        },
      },
    }),
  });
  const raw = await response.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    return {
      model: spec.model,
      effort: spec.effort,
      scenario: scenario.id,
      passed: false,
      latency_ms: latencyMs,
      error: `HTTP ${response.status}`,
    };
  }
  const result = JSON.parse(raw);
  const usage = {
    input_tokens: result.usage?.input_tokens ?? 0,
    output_tokens: result.usage?.output_tokens ?? 0,
  };
  const rates = modelRates[spec.model];
  const estimatedCostUsd =
    (usage.input_tokens * rates.input + usage.output_tokens * rates.output) /
    1_000_000;
  try {
    const answer = scenario.validate(JSON.parse(extractText(result)));
    return {
      model: spec.model,
      effort: spec.effort,
      scenario: scenario.id,
      passed: true,
      latency_ms: latencyMs,
      usage,
      estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
      rubric: scoreAnswer(scenario, answer),
      answer,
    };
  } catch (error) {
    return {
      model: spec.model,
      effort: spec.effort,
      scenario: scenario.id,
      passed: false,
      latency_ms: latencyMs,
      usage,
      estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
      error: error instanceof Error ? error.message : 'validation failed',
      raw_output: extractText(result),
    };
  }
}

const results = [];
for (const spec of specs) {
  for (const scenario of selectedScenarios) {
    process.stdout.write(`RUN ${spec.model}:${spec.effort} ${scenario.id}\n`);
    const result = await run(spec, scenario);
    results.push(result);
    process.stdout.write(
      `${result.passed ? 'PASS' : 'FAIL'} score=${result.rubric?.score ?? 0} cost=$${result.estimated_cost_usd ?? 0} latency=${result.latency_ms}ms\n`,
    );
  }
}

const summary = specs.map((spec) => {
  const rows = results.filter(
    (item) => item.model === spec.model && item.effort === spec.effort,
  );
  return {
    model: spec.model,
    effort: spec.effort,
    passed: rows.filter((item) => item.passed).length,
    scenarios: rows.length,
    mean_score: Number(
      (
        rows.reduce((sum, item) => sum + (item.rubric?.score ?? 0), 0) /
        rows.length
      ).toFixed(2),
    ),
    total_cost_usd: Number(
      rows.reduce((sum, item) => sum + (item.estimated_cost_usd ?? 0), 0).toFixed(6),
    ),
    mean_latency_ms: Math.round(
      rows.reduce((sum, item) => sum + item.latency_ms, 0) / rows.length,
    ),
  };
});

const report = {
  generated_at: new Date().toISOString(),
  note: 'Synthetic fixed-input comparison. USD estimates use uncached standard token rates and exclude taxes.',
  summary,
  results,
};
const outputPath = resolve('work/ai-evals/latest.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nSAVED ${outputPath}\n`);
