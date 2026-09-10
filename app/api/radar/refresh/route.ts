import { isLocalDashboardRequest } from '@/lib/server/local-request';
import { startDashboardJob } from '@/lib/server/dashboard-jobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!isLocalDashboardRequest(request,true))return Response.json({error:'이 PC의 로컬 대시보드에서 요청해 주세요.'},{status:403});
 try{return Response.json({ok:true,job:await startDashboardJob('radar')},{status:202,headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'수집을 시작하지 못했습니다.'},{status:503});}
}
