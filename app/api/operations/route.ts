import { isLocalDashboardRequest } from '@/lib/server/local-request';
import { listDashboardJobs } from '@/lib/server/dashboard-jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!isLocalDashboardRequest(request))
    return Response.json(
      { error: '로컬 대시보드에서 확인해 주세요.' },
      { status: 403 },
    );
  try {
    return Response.json(listDashboardJobs(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: '수집 상태를 읽지 못했습니다.' },
      { status: 503 },
    );
  }
}
