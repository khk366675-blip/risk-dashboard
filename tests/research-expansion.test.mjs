import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ResearchStore} from '../lib/server/research-store.ts';
import {ThesisStore} from '../lib/server/thesis-store.ts';
import {ManualEvidenceStore} from '../lib/server/manual-evidence-store.ts';
import {emptyThesis} from '../lib/investment-thesis.ts';
import {recoverInterrupted} from '../lib/server/dashboard-jobs.ts';
import {periodRows} from '../lib/financial-analysis.ts';
test('TTM uses four adjacent quarters with matching basis and never fills missing with zero',()=>{
 const stock={quarters:[1,2,3,4].map(q=>({year:2025,quarter:`${q}Q`,statement_basis:'CFS',rev:q*10,ocf:0,equity:200}))};
 assert.equal(periodRows(stock,'ttm')[3].rev,100);assert.equal(periodRows(stock,'ttm')[2].rev,null);assert.equal(periodRows(stock,'ttm')[3].ocf,0);assert.equal(periodRows(stock,'ttm')[3].equity,200);
 stock.quarters[1].rev=null;assert.equal(periodRows(stock,'ttm')[3].rev,null);
 stock.quarters[1].statement_basis='OFS';assert.equal(periodRows(stock,'ttm')[3].ocf,null);
 assert.deepEqual(periodRows(stock,'annual'),[]);
 stock.annual_financials=[{year:2023,quarter:'4Q',rev:100},{year:2025,quarter:'4Q',rev:200}];assert.equal(periodRows(stock,'annual')[1].year,2024);assert.equal(periodRows(stock,'annual')[1].rev,undefined);
});
test('background states recover stale jobs and evidence annotation callback rolls back atomically',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'value-expansion-unit-'));const store=new ResearchStore(directory);
 try{
  store.db.prepare("INSERT INTO dashboard_jobs(id,kind,state,step,started_at,updated_at) VALUES('old','radar','running','x','2020','2020')").run();
  recoverInterrupted(store.db);assert.equal(store.db.prepare('SELECT state FROM dashboard_jobs').get().state,'error');
  const radar=JSON.parse(readFileSync('public/data/radar/latest.json','utf8')),candidate=radar.candidates[0],stock=JSON.parse(readFileSync(`public/data/radar/stocks/${candidate.code}.json`,'utf8'));
  store.register(candidate,radar,stock);const point=new ThesisStore(store.db).create(candidate.code,randomUUID(),{...emptyThesis(),body:'격리 테스트 투자포인트'});
  const evidence=new ManualEvidenceStore(store.db),raw={id:randomUUID(),thesis_id:point.id,thesis_revision:point.revision,relation:'context',source_type:'other',title:'PDF',url:'http://localhost:3000/stocks/000001/pdf',source_name:'첨부 PDF',published_at:'',body:'발췌',note:''};
  assert.throws(()=>evidence.create(candidate.code,raw,()=>{throw new Error('annotation failed');}),/annotation failed/);
  assert.equal(evidence.list(candidate.code).length,0);
  evidence.create(candidate.code,raw);assert.equal(evidence.list(candidate.code).length,1);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
