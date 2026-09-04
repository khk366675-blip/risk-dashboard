import { withDocuments, startDocumentWorker } from '@/lib/server/local-documents';
import { thesisRequest, thesisBody, onlyKeys, thesisJson, thesisFailure } from '@/lib/server/thesis-http';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{code:string}>}) {
  try {const {code}=await context.params;thesisRequest(request,code);return thesisJson(withDocuments(s=>s.list(code)));}catch(e){return thesisFailure(e);}
}
export async function POST(request:Request,context:{params:Promise<{code:string}>}) {
  try {
    const {code}=await context.params;thesisRequest(request,code,true);
    const body=await thesisBody(request);onlyKeys(body,['receipt','id','refresh']);
    const receipt=body.receipt as string,id=body.id as string;
    const started=withDocuments(s=>s.enqueue(code,receipt,id,body.refresh as boolean));
    if(started)await startDocumentWorker(code,receipt,id);
    return thesisJson({...withDocuments(s=>s.list(code)),started},started?202:200);
  }catch(e){return thesisFailure(e);}
}
