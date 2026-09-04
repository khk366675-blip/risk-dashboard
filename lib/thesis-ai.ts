import config from '../research/thesis-ai.json' with { type: 'json' };
import type { ThesisContent } from './investment-thesis.ts';
export const thesisAiConfig = config;
export type ThesisAiConfig = typeof config;
export const questionKinds = {
  support: '성립 조건',
  challenge: '반증·다른 설명',
  clarification: '가설 구체화',
};
export const sourceKinds = {
  company_report: '사업보고서·공시 본문',
  financial_statement: '재무제표·주석',
  ir_material: '기업 IR 자료',
  industry_data: '산업·경쟁 자료',
  user_clarification: '내 가설 구체화',
};
export type ThesisAiInput = {
  company: { code: string; name: string };
  point: Pick<ThesisContent, 'title' | 'body' | 'timing' | 'weakens'>;
  existing_questions: string[];
};
export type ThesisSuggestion = {
  kind: keyof typeof questionKinds;
  anchor_field: keyof ThesisAiInput['point'];
  anchor_quote: string;
  question: string;
  why: string;
  source_kind: keyof typeof sourceKinds;
  look_for: string;
  weakening_signal: string;
};
export type ThesisSuggestions = {
  status: 'questions' | 'needs_clarification';
  suggestions: ThesisSuggestion[];
};
export type ThesisAiRun = {
  id: string;
  thesis_id: string;
  thesis_revision: number;
  model: string;
  prompt_version: string;
  created_at: string;
  completed_at: string | null;
  state: 'pending' | 'completed' | 'error' | 'interrupted';
  error: string | null;
  input: ThesisAiInput;
  answer: ThesisSuggestions | null;
  usage: { input_tokens: number | null; output_tokens: number | null } | null;
  adoption: {
    revision: number;
    checks: { suggestion_index: number; check_id: string; text: string }[];
  } | null;
};
export type ThesisAiView = {
  configured: boolean;
  model: string;
  signature: string;
  input: ThesisAiInput;
  revision: number;
  run: ThesisAiRun | null;
};
export function thesisAiInput(
  code: string,
  name: string,
  content: ThesisContent,
): ThesisAiInput {
  return {
    company: { code, name },
    point: {
      title: content.title,
      body: content.body,
      timing: content.timing,
      weakens: content.weakens,
    },
    existing_questions: content.checks.map((c) => c.text),
  };
}
const keysExactly = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => k in v);
// Structural/provenance checks are not a guarantee that a model's interpretation is correct.
export function validateSuggestions(
  value: unknown,
  input: ThesisAiInput,
  limits = config,
): ThesisSuggestions {
  const fail = () => {
    throw new Error('AI 질문의 형식·인용·표현 검사에 통과하지 못했습니다.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const v = value as Record<string, unknown>;
  if (
    !keysExactly(v, ['status', 'suggestions']) ||
    !['questions', 'needs_clarification'].includes(String(v.status)) ||
    !Array.isArray(v.suggestions) ||
    !v.suggestions.length ||
    v.suggestions.length > limits.max_suggestions
  )
    return fail();
  const questions = new Set<string>();
  const inputNumbers = new Set(
    JSON.stringify(input.point).match(/\d+(?:[.,]\d+)*/g) ?? [],
  );
  for (const s of v.suggestions) {
    if (
      !s ||
      typeof s !== 'object' ||
      !keysExactly(s, [
        'kind',
        'anchor_field',
        'anchor_quote',
        'question',
        'why',
        'source_kind',
        'look_for',
        'weakening_signal',
      ])
    )
      return fail();
    if (
      !Object.hasOwn(questionKinds, s.kind) ||
      !Object.hasOwn(sourceKinds, s.source_kind) ||
      !Object.hasOwn(input.point, s.anchor_field)
    )
      return fail();
    if (
      typeof s.anchor_quote !== 'string' ||
      !s.anchor_quote.trim() ||
      s.anchor_quote.length > limits.max_quote_chars ||
      !input.point[s.anchor_field as keyof ThesisAiInput['point']].includes(
        s.anchor_quote,
      )
    )
      return fail();
    for (const field of ['question', 'why', 'look_for', 'weakening_signal']) {
      const text = s[field];
      if (
        typeof text !== 'string' ||
        !text.trim() ||
        text.length >
          (field === 'question'
            ? limits.max_question_chars
            : limits.max_detail_chars) ||
        text.includes('\0') ||
        /https?:|www\.|[<>]|매수|매도|목표주가|적정주가|투자\s*추천|\b(buy|sell|hold|price target)\b/i.test(
          text,
        )
      )
        return fail();
      if (
        (text.match(/\d+(?:[.,]\d+)*/g) ?? []).some(
          (n: string) => !inputNumbers.has(n),
        )
      )
        return fail();
    }
    if (!s.question.trim().endsWith('?') || questions.has(s.question.trim()))
      return fail();
    questions.add(s.question.trim());
  }
  if (
    v.status === 'questions' &&
    !v.suggestions.some((s) => s.kind === 'challenge')
  )
    return fail();
  if (
    v.status === 'needs_clarification' &&
    !v.suggestions.some((s) => s.kind === 'clarification')
  )
    return fail();
  return value as ThesisSuggestions;
}
