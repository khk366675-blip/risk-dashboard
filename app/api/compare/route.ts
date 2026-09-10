import { randomUUID } from 'node:crypto';
import {
  thesisBody,
  thesisRequest,
  thesisFailure,
  thesisJson,
} from '@/lib/server/thesis-http';
import { ThesisError, uuidPattern } from '@/lib/investment-thesis';
import { localStore, ResearchStore } from '@/lib/server/research-store';
import {
  comparisonSnapshot,
  peerDirectory,
} from '@/lib/server/comparison-store';
import { findListedStock } from '@/lib/server/listing-store';
import {
  manualCandidate,
  manualPreview,
  readRadar,
  startResearchWorker,
} from '@/lib/server/research-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    thesisRequest(request, '000000');
    return thesisJson(comparisonSnapshot());
  } catch (e) {
    return thesisFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    thesisRequest(request, '000000', true);
    const body = await thesisBody(request);
    const code = typeof body.code === 'string' ? body.code : '';
    if (body.refresh !== undefined && typeof body.refresh !== 'boolean')
      throw new ThesisError('자료 갱신 요청을 확인해 주세요.');
    if (
      !/^\d{6}$/.test(code) ||
      (body.retry !== undefined && typeof body.retry !== 'boolean')
    )
      throw new ThesisError('종목과 재시도 요청을 확인해 주세요.');
    const listing = findListedStock(code);
    if (!listing) throw new ThesisError('상장종목을 찾지 못했습니다.', 404);
    const radar = await readRadar(),
      owner = new ResearchStore(peerDirectory);
    let jobId: string | null = null;
    try {
      if ((body.retry || body.refresh) && !owner.get(code)?.item.active)
        throw new ThesisError('비교 기업을 먼저 추가해 주세요.', 404);
      jobId =
        body.retry || body.refresh
          ? owner.queue(code, body.refresh ? 'all' : 'retry')
          : owner.register(
              manualCandidate(listing, radar),
              radar,
              manualPreview(listing, radar),
            ).jobId;
    } finally {
      owner.close();
    }
    if (jobId) await startResearchWorker(code, jobId, peerDirectory);
    return thesisJson(comparisonSnapshot(), 202);
  } catch (e) {
    return thesisFailure(e);
  }
}
export async function PUT(request: Request) {
  try {
    thesisRequest(request, '000000', true);
    const body = await thesisBody(request);
    const codes = body.codes;
    if (
      !Array.isArray(codes) ||
      codes.length < 2 ||
      codes.length > 5 ||
      new Set(codes).size !== codes.length ||
      codes.some((c) => typeof c !== 'string' || !/^\d{6}$/.test(c))
    )
      throw new ThesisError('서로 다른 기업 2~5개를 선택해 주세요.');
    if (
      typeof body.title !== 'string' ||
      (body.reason !== undefined && typeof body.reason !== 'string') ||
      (body.id !== undefined && typeof body.id !== 'string')
    )
      throw new ThesisError('조합 이름과 비교 이유를 확인해 주세요.');
    const title = body.title.trim(),
      reason = (body.reason ?? '').trim(),
      id = body.id === undefined ? randomUUID() : body.id;
    if (
      !title ||
      title.length > 100 ||
      reason.length > 4000 ||
      !uuidPattern.test(id)
    )
      throw new ThesisError('조합 이름과 비교 이유를 확인해 주세요.');
    const available = new Set(
      comparisonSnapshot().items.map((item) => item.stock.code),
    );
    if (codes.some((c) => !available.has(c)))
      throw new ThesisError('먼저 비교 기업을 추가해 주세요.');
    const owner = localStore(),
      now = new Date().toISOString();
    try {
      owner.db
        .prepare(
          'INSERT INTO comparison_sets(id,title,reason,codes_json,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,reason=excluded.reason,codes_json=excluded.codes_json,updated_at=excluded.updated_at',
        )
        .run(id, title, reason, JSON.stringify(codes), now, now);
    } finally {
      owner.close();
    }
    return thesisJson(comparisonSnapshot());
  } catch (e) {
    return thesisFailure(e);
  }
}
