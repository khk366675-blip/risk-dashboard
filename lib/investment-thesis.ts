import config from '../research/thesis-config.json' with { type: 'json' };

export const thesisConfig = config;
export type ThesisCheck = { id: string; text: string };
export type ThesisContent = {
  title: string;
  body: string;
  timing: string;
  weakens: string;
  source_url: string;
  checks: ThesisCheck[];
};
export type InvestmentThesis = {
  id: string;
  code: string;
  revision: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  content: ThesisContent;
};
export type ThesisSummary = { count: number; title: string | null };
export const emptyThesis = (): ThesisContent => ({
  title: '',
  body: '',
  timing: '',
  weakens: '',
  source_url: '',
  checks: [],
});
export const thesisTitle = (content: ThesisContent) =>
  content.title.trim() || content.body.trim().split(/\r?\n/)[0];
export const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class ThesisError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function validateThesisContent(
  value: unknown,
  stored = false,
): ThesisContent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ThesisError('투자포인트 형식을 확인해 주세요.');
  const v = value as Record<string, unknown>;
  const limits: Record<string, number> = {
    title: config.max_title_chars,
    body: config.max_body_chars,
    timing: config.max_timing_chars,
    weakens: config.max_optional_chars,
    source_url: config.max_url_chars,
  };
  if (
    Object.keys(v).some((k) => ![...Object.keys(limits), 'checks'].includes(k))
  )
    throw new ThesisError('지원하지 않는 투자포인트 항목입니다.');
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof v[key] !== 'string' || (v[key] as string).includes('\0'))
      throw new ThesisError('모든 입력 항목은 텍스트여야 합니다.');
    if (!stored && (v[key] as string).length > limit)
      throw new ThesisError(
        `입력 길이 한도(${limit.toLocaleString()}자)를 초과했습니다. 내용을 줄여 주세요.`,
      );
  }
  if (!(v.body as string).trim())
    throw new ThesisError('투자포인트를 작성해 주세요.');
  if ((v.source_url as string).trim()) {
    try {
      const url = new URL((v.source_url as string).trim());
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      throw new ThesisError(
        '원문 링크는 계정 정보 없는 http 또는 https 주소여야 합니다.',
      );
    }
  }
  if (
    !Array.isArray(v.checks) ||
    (!stored && v.checks.length > config.max_checks)
  )
    throw new ThesisError(
      `검증 항목은 ${config.max_checks}개까지 작성할 수 있습니다.`,
    );
  const ids = new Set<string>();
  for (const item of v.checks) {
    if (
      !item ||
      typeof item !== 'object' ||
      Object.keys(item).some((k) => !['id', 'text'].includes(k)) ||
      typeof item.id !== 'string' ||
      !uuidPattern.test(item.id) ||
      ids.has(item.id) ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.includes('\0') ||
      (!stored && item.text.length > config.max_check_chars)
    )
      throw new ThesisError('검증 항목의 내용·길이·식별자를 확인해 주세요.');
    ids.add(item.id);
  }
  // Preserve the user's original whitespace and text; no generated replacements.
  return {
    title: v.title as string,
    body: v.body as string,
    timing: v.timing as string,
    weakens: v.weakens as string,
    source_url: v.source_url as string,
    checks: v.checks.map((c) => ({ id: c.id, text: c.text })),
  };
}
