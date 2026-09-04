import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildEvidencePacket,
  isLens,
  type EvidenceAiConfig,
} from '@/lib/evidence-explanation';
import {
  EvidenceAiError,
  EvidenceAiService,
  packetRevision,
} from '@/lib/server/evidence-ai-service';
import { localStore } from '@/lib/server/research-store';
import { withLocalAiBudget } from '@/lib/server/local-ai-budget';
import { ThesisError } from '@/lib/investment-thesis';
import { readPreview, readRadar } from '@/lib/server/research-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let service: EvidenceAiService | undefined;
async function aiService() {
  if (!service) {
    const config = JSON.parse(
      await readFile(
        path.join(process.cwd(), 'research/evidence-ai.json'),
        'utf8',
      ),
    ) as EvidenceAiConfig;
    config.model = process.env.EVIDENCE_AI_MODEL?.trim() || config.model;
    service ??= new EvidenceAiService(
      config,
      path.resolve(process.env.EVIDENCE_AI_CACHE_DIR || config.cache_dir),
      () => process.env.OPENAI_API_KEY,
      fetch,
      Date.now,
      withLocalAiBudget,
    );
  }
  return service;
}
type Context = { params: Promise<{ code: string }> };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function localRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (
    process.env.VERCEL ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new EvidenceAiError(
      'AI 해설은 이 PC의 로컬 화면에서만 사용할 수 있습니다.',
      403,
    );
  if (
    mutation &&
    (request.headers.get('origin') !== url.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site')
  )
    throw new EvidenceAiError('로컬 대시보드 화면에서 요청해 주세요.', 403);
}
async function packetFor(
  code: string,
  lens: unknown,
  config: EvidenceAiConfig,
) {
  if (!/^\d{6}$/.test(code) || !isLens(lens))
    throw new EvidenceAiError('종목 또는 렌즈가 올바르지 않습니다.', 400);
  const store = localStore();
  let record;
  try {
    record = store.get(code);
  } finally {
    store.close();
  }
  const stock = record?.item.active
    ? record.stock
    : await readPreview(code, await readRadar());
  if (!stock)
    throw new EvidenceAiError('이 종목의 Radar 근거를 찾지 못했습니다.', 404);
  return buildEvidencePacket(stock, lens, config);
}
function failure(error: unknown) {
  return error instanceof EvidenceAiError || error instanceof ThesisError
    ? json({ error: error.message }, error.status)
    : json(
        {
          error:
            '근거 자료 또는 AI 저장소를 읽지 못했습니다. 기존 자료는 변경하지 않았습니다.',
        },
        503,
      );
}
export async function GET(request: Request, context: Context) {
  try {
    localRequest(request);
    const { code } = await context.params;
    const ai = await aiService();
    const packet = await packetFor(
      code,
      new URL(request.url).searchParams.get('lens'),
      ai.config,
    );
    return json({
      packet,
      revision: packetRevision(packet),
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      model: ai.config.model,
      result: await ai.cached(packet),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    localRequest(request, true);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new EvidenceAiError('JSON 요청이 필요합니다.', 400);
    const text = await request.text();
    if (text.length > 1024)
      throw new EvidenceAiError('요청이 너무 큽니다.', 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new EvidenceAiError('요청 형식이 올바르지 않습니다.', 400);
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Object.keys(body).some((key) => !['lens', 'revision'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(body.revision ?? '')
    )
      throw new EvidenceAiError('화면 근거 버전이 필요합니다.', 400);
    const { code } = await context.params;
    const ai = await aiService();
    const packet = await packetFor(code, body.lens, ai.config);
    if (packetRevision(packet) !== body.revision)
      throw new EvidenceAiError(
        '근거가 변경됐습니다. 패널을 다시 열고 확인해 주세요.',
        409,
      );
    const result = await ai.generate(packet);
    if (
      packetRevision(await packetFor(code, body.lens, ai.config)) !==
      body.revision
    )
      throw new EvidenceAiError(
        '설명 생성 중 근거가 변경됐습니다. 이전 답변은 새 자료에 표시하지 않습니다.',
        409,
      );
    return json({ result, revision: body.revision });
  } catch (error) {
    return failure(error);
  }
}
