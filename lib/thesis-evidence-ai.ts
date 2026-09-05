import config from '../research/thesis-evidence-ai.json' with { type: 'json' };

export const thesisEvidenceAiConfig = config;

export const evidenceReviewKinds = {
  tension: '충돌 가능성',
  gap: '논리 공백',
  verification: '추가 검증',
} as const;

export type EvidenceReviewKind = keyof typeof evidenceReviewKinds;

export type ThesisEvidenceReviewItem = {
  id: string;
  kind: 'filing' | 'financial' | 'manual';
  relation: 'supports' | 'challenges' | 'context';
  label: string;
  excerpt: string;
  period: string | null;
  source_name: string;
  source_status: string;
  collected_at?: string | null;
  excerpt_truncated?: boolean;
  original_chars?: number;
};

export type ThesisEvidenceAiInput = {
  company: { code: string; name: string };
  point: {
    id: string;
    revision: number;
    title: string;
    body: string;
    timing: string;
    weakens: string;
    existing_questions: string[];
  };
  evidence: ThesisEvidenceReviewItem[];
  focus?: { id: string; question: string; answer: string; unresolved: string };
};

export type ThesisEvidenceFinding = {
  kind: EvidenceReviewKind;
  source_ids: string[];
  point_quote: string;
  explanation: string;
  question: string;
};

export type ThesisEvidenceAiAnswer = {
  status: 'review_ready' | 'insufficient_evidence';
  findings: ThesisEvidenceFinding[];
};

export type ThesisEvidenceAiRun = {
  id: string;
  thesis_id: string;
  thesis_revision: number;
  evidence_signature: string;
  model: string;
  prompt_version: string;
  created_at: string;
  completed_at: string | null;
  state: 'pending' | 'completed' | 'error' | 'interrupted';
  error: string | null;
  input: ThesisEvidenceAiInput;
  answer: ThesisEvidenceAiAnswer | null;
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
};

export type ThesisEvidenceAiView = {
  configured: boolean;
  model: string;
  signature: string;
  revision: number;
  evidence_count: number;
  input: ThesisEvidenceAiInput;
  run: ThesisEvidenceAiRun | null;
};

export function validateEvidenceReview(
  value: unknown,
  input: ThesisEvidenceAiInput,
  limits = thesisEvidenceAiConfig,
): ThesisEvidenceAiAnswer {
  const fail = () => {
    throw new Error('invalid evidence review');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some((key) => !['status', 'findings'].includes(key)) ||
    !['review_ready', 'insufficient_evidence'].includes(
      String(result.status),
    ) ||
    !Array.isArray(result.findings) ||
    result.findings.length > limits.max_findings ||
    (result.status === 'review_ready' && result.findings.length === 0) ||
    (result.status === 'insufficient_evidence' && result.findings.length !== 0)
  )
    return fail();
  const sourceIds = new Set(input.evidence.map((item) => item.id));
  const pointFields = [
    input.point.title,
    input.point.body,
    input.point.timing,
    input.point.weakens,
    input.focus?.question ?? '',
  ];
  const inputNumbers = new Set(
    (JSON.stringify(input).match(/\d+(?:[.,]\d+)*/g) ?? []).map(String),
  );
  for (const raw of result.findings) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
    const finding = raw as Record<string, unknown>;
    if (
      Object.keys(finding).some(
        (key) =>
          ![
            'kind',
            'source_ids',
            'point_quote',
            'explanation',
            'question',
          ].includes(key),
      ) ||
      !Object.hasOwn(evidenceReviewKinds, String(finding.kind)) ||
      !Array.isArray(finding.source_ids) ||
      finding.source_ids.length > limits.max_evidence_items ||
      finding.source_ids.some(
        (id) => typeof id !== 'string' || !sourceIds.has(id),
      ) ||
      new Set(finding.source_ids).size !== finding.source_ids.length ||
      typeof finding.point_quote !== 'string' ||
      !finding.point_quote.trim() ||
      finding.point_quote.length > limits.max_quote_chars ||
      !pointFields.some((field) =>
        field.includes(finding.point_quote as string),
      ) ||
      typeof finding.explanation !== 'string' ||
      !finding.explanation.trim() ||
      finding.explanation.length > limits.max_text_chars ||
      typeof finding.question !== 'string' ||
      !finding.question.trim().endsWith('?') ||
      finding.question.length > limits.max_text_chars
    )
      return fail();
    for (const text of [finding.explanation, finding.question]) {
      if (
        (text as string).includes('\0') ||
        /https?:|www\.|[<>]|매수|매도|목표주가|적정주가|투자\s*추천|\b(buy|sell|hold|price target)\b/i.test(
          text as string,
        ) ||
        ((text as string).match(/\d+(?:[.,]\d+)*/g) ?? []).some(
          (number) => !inputNumbers.has(number),
        )
      )
        return fail();
    }
  }
  return value as ThesisEvidenceAiAnswer;
}
