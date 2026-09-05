import { localStore } from './research-store';
import { ThesisStore } from './thesis-store';
import { thesisConfig, ThesisError } from '../investment-thesis';
import { isLocalDashboardRequest } from './local-request';

export const thesisJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function thesisRequest(request: Request, code: string, write = false) {
  if (!isLocalDashboardRequest(request, write))
    throw new ThesisError('이 PC의 로컬 대시보드에서 요청해 주세요.', 403);
  if (!/^\d{6}$/.test(code)) throw new ThesisError('종목코드를 확인해 주세요.');
}
export async function thesisBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ThesisError('JSON 요청이 필요합니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new ThesisError('요청 내용이 없습니다.');
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > thesisConfig.max_request_bytes) {
        await reader.cancel();
        throw new ThesisError('요청 크기 한도를 초과했습니다.', 413);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new ThesisError('요청 형식이 올바르지 않습니다.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ThesisError('요청 항목을 확인해 주세요.');
  return body;
}
export function onlyKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((k) => !keys.includes(k)))
    throw new ThesisError('지원하지 않는 요청 항목입니다.');
}
export function withTheses<T>(work: (store: ThesisStore) => T): T {
  const owner = localStore();
  try {
    return work(new ThesisStore(owner.db));
  } finally {
    owner.close();
  }
}
export const thesisFailure = (error: unknown) =>
  error instanceof ThesisError
    ? thesisJson({ error: error.message }, error.status)
    : thesisJson(
        {
          error:
            '투자포인트 저장소를 확인하지 못했습니다. 입력과 기존 자료는 지우지 않았습니다.',
        },
        503,
      );
