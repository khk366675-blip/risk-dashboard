// Isolated production UI/API test; no real collection or AI calls.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,realpathSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {ResearchStore} from '../lib/server/research-store.ts';
import {ThesisStore} from '../lib/server/thesis-store.ts';
import {emptyThesis} from '../lib/investment-thesis.ts';
const directory=mkdtempSync(path.join(tmpdir(),'value-expansion-http-'));
let server,owner;
try{
 owner=new ResearchStore(directory);
 const radar=JSON.parse(readFileSync('public/data/radar/latest.json','utf8'));
 const candidate=radar.candidates.find(c=>existsSync(`data/research/raw/${c.code}`))??radar.candidates[0];
 const stock=JSON.parse(readFileSync(`public/data/radar/stocks/${candidate.code}.json`,'utf8'));
 stock.name=`[격리 검증용] ${stock.name}`;
 if(existsSync(`data/research/raw/${candidate.code}`)){
  const financials=JSON.parse(execFileSync('.venv/Scripts/python.exe',['-c',"import json,sys;from pathlib import Path;from research.financials import normalize_financials,annual_financials,PARSER_VERSION;docs=[json.loads(p.read_text(encoding='utf-8')) for p in Path(sys.argv[1]).glob('*.json')];print(json.dumps({'quarters':normalize_financials(docs,24),'annual_financials':annual_financials(docs)[-5:],'financial_parser_version':PARSER_VERSION}))",`data/research/raw/${candidate.code}`],{encoding:'utf8'}));
  Object.assign(stock,financials);
  stock.source_status.financials={status:'ok',source:'격리 검증 · 저장된 DART 원자료',as_of:`${stock.quarters.at(-1).year} ${stock.quarters.at(-1).quarter}`,collected_at:stock.quarters.at(-1).collected_at};
 }
 owner.register({...candidate,name:stock.name},radar,stock);
 owner.db.prepare("UPDATE research_jobs SET state='ready',step='격리 자료 준비 완료'").run();
 const point=new ThesisStore(owner.db).create(candidate.code,randomUUID(),{...emptyThesis(),title:'PDF 연결·재무 검증용 투자포인트',body:'격리된 테스트입니다. 선택한 보고서의 원문과 수치를 대조한다.',checks:[{id:randomUUID(),text:'발췌와 원자료가 일치하는가?'}]});
 owner.close();owner=null;
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{cwd:process.cwd(),windowsHide:true,stdio:'ignore',env:{...process.env,RESEARCH_STORAGE_DIR:directory,VERCEL:'',OPENAI_API_KEY:'',THESIS_AI_API_KEY:'',RADAR_PYTHON_EXECUTABLE:path.join(directory,'no-worker'),MARKET_PYTHON_EXECUTABLE:path.join(directory,'no-worker'),PDF_PYTHON_EXECUTABLE:path.resolve('.venv/Scripts/python.exe')}});
 const base=`http://127.0.0.1:${port}`;
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/api/compare')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 assert.ok(ready,'production server ready');
 async function request(url,method='GET',body,extra={}){const response=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await response.json();}catch{data=null;}return {response,data};}
 const job=await request('/api/markets/refresh','POST');assert.equal(job.response.status,202);assert.equal(job.data.job.state,'error','missing executable is visible, not a fake success');
 owner=new ResearchStore(directory);const id=randomUUID(),now=new Date().toISOString();owner.db.prepare("INSERT INTO dashboard_jobs(id,kind,state,step,started_at,updated_at) VALUES(?,'radar','queued','격리 중복 실행 검증',?,?)").run(id,now,now);owner.close();owner=null;
 const duplicate=await request('/api/radar/refresh','POST');assert.equal(duplicate.data.job.id,id,'active run is reused, no collector is spawned');
 const hostile=await request('/api/radar/refresh','POST',undefined,{Origin:'https://external.example'});assert.equal(hostile.response.status,403);
 const peerCode=candidate.code==='005930'?'000660':'005930';
 const peer=await request('/api/compare','POST',{code:peerCode});assert.equal(peer.response.status,202,JSON.stringify(peer.data));assert.ok(peer.data.items.some(x=>x.stock.code===peerCode&&x.peer));
 owner=new ResearchStore(directory);assert.equal(owner.list().length,1,'peer must not enter actual watchlist');owner.close();owner=null;
 const saved=await request('/api/compare','PUT',{codes:[candidate.code,peerCode],title:'검증용 비교 조합',reason:'동일 기간 수치 대조'});assert.equal(saved.response.status,200);assert.equal(saved.data.sets[0].reason,'동일 기간 수치 대조');
 assert.equal((await request('/api/compare','PUT',{codes:[candidate.code,candidate.code],title:'invalid'})).response.status,400);
 const pdfResponse=await fetch('https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/tracemonkey.pdf');assert.ok(pdfResponse.ok,'official PDF.js test PDF fetched');const pdfBytes=await pdfResponse.arrayBuffer();
 const endpoint=`/api/stocks/${candidate.code}/pdf`;
 async function upload(){const response=await fetch(base+endpoint+'?title=PDF.js%20public%20test%20document',{method:'POST',headers:{Origin:base,'Content-Type':'application/pdf'},body:pdfBytes});return{response,data:await response.json()};}
 const uploaded=await upload();assert.equal(uploaded.response.status,201,JSON.stringify(uploaded.data));const documentId=uploaded.data.item.id;assert.ok(uploaded.data.item.page_count>1);assert.equal((await upload()).data.item.id,documentId,'same PDF is deduplicated');
 const downloaded=await fetch(base+endpoint+'/'+documentId);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(pdfBytes));
 const annotation={id:randomUUID(),thesis_id:point.id,thesis_revision:point.revision,page:1,quote:'Trace-based Just-in-Time Type Specialization for Dynamic Languages',note:'공개 테스트 PDF의 제목을 연결한 검증용 기록',relation:'context',rectangles:[]};
 const annotationPath=endpoint+'/'+documentId+'/annotations';
 const created=await request(annotationPath,'POST',annotation);assert.equal(created.response.status,201,JSON.stringify(created.data));
 assert.equal((await request(annotationPath,'POST',annotation)).response.status,201,'idempotent annotation save');
 assert.equal((await request(annotationPath,'POST',{...annotation,rectangles:[[0,0,.1,.1]]})).response.status,409,'changed annotation cannot reuse id');
 assert.equal((await request(annotationPath,'POST',{...annotation,id:randomUUID(),page:99999})).response.status,400);
 assert.equal((await request(annotationPath,'POST',{...annotation,id:randomUUID(),thesis_revision:99})).response.status,409);
 const linked=await request(`/api/watchlist/${candidate.code}/manual-evidence`);assert.equal(linked.data.items.length,1);assert.equal(linked.data.items[0].body,annotation.quote);assert.equal(linked.data.items[0].source_status,'user_supplied');
 assert.equal((await request(annotationPath)).data.items.length,1);
 const bytesDenied=await fetch(base+`/api/stocks/${peerCode}/pdf/${documentId}`);assert.equal(bytesDenied.status,404,'cross-stock document access rejected');
 assert.equal((await fetch(base+'/api/pdf-worker')).status,200);
 assert.equal((await fetch(base+'/api/pdf-assets/cmaps/Adobe-Korea1-UCS2.bcmap')).status,200);
 const wasm=readdirSync('node_modules/pdfjs-dist/wasm').find(n=>n.endsWith('.wasm'));assert.equal((await fetch(base+'/api/pdf-assets/wasm/'+wasm)).status,200);
 console.log('PASS: jobs duplicate/origin/error states; peer isolation and saved set; PDF upload/read/dedupe/page limits/revision/atomic annotation/evidence linkage; worker/Korean CMap/WASM assets. No real Radar/Markets/AI execution.');
 if(process.env.EXPANSION_UI==='1'){
  console.log(`UI_READY ${base}/stocks/${candidate.code}/pdf?document=${documentId} | financials=${base}/stocks/${candidate.code}?tab=financials | compare=${base}/compare`);
  console.log('Press Enter to close the isolated UI server.');
  await new Promise(resolve=>{process.stdin.resume();process.stdin.once('data',resolve);});
  process.stdin.pause();
 }
}finally{
 owner?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}
 const resolved=realpathSync(directory);assert.equal(path.dirname(resolved),realpathSync(tmpdir()));assert.ok(path.basename(resolved).startsWith('value-expansion-http-'));rmSync(resolved,{recursive:true});
}
