import { withDocuments } from '@/lib/server/local-documents';
import { thesisRequest, thesisJson, thesisFailure } from '@/lib/server/thesis-http';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{code:string;receipt:string}>}) {
  try {
    const {code,receipt}=await context.params;thesisRequest(request,code);
    const q=new URL(request.url).searchParams;
    return thesisJson(withDocuments(s=>s.view(code,receipt,q.get('version')||undefined,q.get('section')||undefined,Number(q.get('offset')||0),q.get('block')||undefined)));
  }catch(e){return thesisFailure(e);}
}
