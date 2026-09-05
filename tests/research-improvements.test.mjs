import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readCurrentRadar } from '../lib/server/current-snapshots.ts';
import { completePreviewPrices } from '../lib/server/price-history.ts';
import { priceWindow } from '../lib/stock-research.ts';
import { financialCsv, csvCell } from '../lib/research-export.ts';
import { researchMarkdown } from '../lib/server/research-export.ts';
import { searchResearch } from '../lib/server/research-search.ts';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ResearchSystemStore } from '../lib/server/research-system-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { emptyThesis, validateThesisContent } from '../lib/investment-thesis.ts';

function temporary(t){const dir=mkdtempSync(path.join(tmpdir(),'risk-improvements-'));t.after(()=>{assert.equal(path.dirname(realpathSync(dir)),realpathSync(tmpdir()));rmSync(dir,{recursive:true});});return dir;}
test('Radar re-reads updated files without rebuilding; mismatched counters are rejected',t=>{
  const root=temporary(t);mkdirSync(path.join(root,'public/data/radar'),{recursive:true});const file=path.join(root,'public/data/radar/latest.json');
  const save=n=>writeFileSync(file,JSON.stringify({run_id:`test-${n}`,summary:{candidate_unique_count:n},candidates:Array.from({length:n},(_,i)=>({code:String(i)}))}));
  save(33);assert.equal(readCurrentRadar(root).candidates.length,33);save(27);assert.equal(readCurrentRadar(root).summary.candidate_unique_count,27);
  writeFileSync(file,JSON.stringify({run_id:'broken',summary:{candidate_unique_count:33},candidates:[]}));assert.throws(()=>readCurrentRadar(root),/일치/);
});
test('old 65-session preview expands to real full history; 1m/3m/1y/all differ',t=>{
  const root=temporary(t), file=path.join(root,'prices.db');const db=new DatabaseSync(file);db.exec('CREATE TABLE prices(code TEXT,date TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL)');
  const rows=Array.from({length:500},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:10000+i,high:11000+i,low:9000+i,close:10500+i,volume:100}));
  for(const p of rows)db.prepare('INSERT INTO prices VALUES(?,?,?,?,?,?,?)').run('000001',p.date,p.open,p.high,p.low,p.close,p.volume);db.close();
  const stock={code:'000001',prices:rows.slice(-65)};
  const expanded=completePreviewPrices(stock,file);assert.equal(expanded.length,500);assert.equal(Object.getPrototypeOf(expanded[0]),Object.prototype);
  const sizes=['1m','3m','1y','all'].map(period=>priceWindow(expanded,period).length);assert.ok(sizes.every((n,i)=>i===0||n>sizes[i-1]));assert.equal(expanded[0].close,10500);
  const mismatch={...stock,prices:stock.prices.map(p=>({...p,close:p.close+1}))};assert.equal(completePreviewPrices(mismatch,file).length,65);
  assert.equal(completePreviewPrices(stock,path.join(root,'missing.db')).length,65);
});
test('question notes roundtrip, search and Markdown retain user sources; CSV stays actual units',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'risk-improvements-')),owner=new ResearchStore(dir);t.after(()=>{owner.close();assert.equal(path.dirname(realpathSync(dir)),realpathSync(tmpdir()));rmSync(dir,{recursive:true});});
  const radar=JSON.parse(readFileSync('public/data/radar/latest.json','utf8')),candidate=radar.candidates[0];
  const stock=JSON.parse(readFileSync(`public/data/radar/stocks/${candidate.code}.json`,'utf8'));owner.register(candidate,radar,stock);
  const content={...emptyThesis(),body:'테스트 투자 가설',checks:[{id:randomUUID(),text:'마진이 유지되는가?',answer:'원가율 비교 기록',unresolved:'다음 분기 확인',status:'reviewing',evidence_ids:[]}]};
  const theses=new ThesisStore(owner.db),point=theses.create(candidate.code,randomUUID(),content);assert.deepEqual(theses.list(candidate.code)[0].content,content);
  assert.ok(searchResearch(owner.db,'원가율').some(item=>item.href.includes(point.id)));
  new ResearchSystemStore(owner.db).saveLearning({title:'독서 확인 테스트',kind:'book',status:'reading',summary:'학습의 적용',linked_codes:[]});assert.equal(searchResearch(owner.db,'독서 확인').length,1);
  const md=researchMarkdown(owner.db,stock);assert.match(md,/원가율 비교 기록/);assert.match(md,/다음 분기 확인/);
  const csv=financialCsv({...stock,quarters:[{year:2026,quarter:'2Q',rev:100_000_000,op:-200_000_000,statement_basis:'CFS',receipt_no:'20260904000123'}]});assert.match(csv,/"100000000","원"/);assert.match(csv,/"-200000000"/);assert.match(csv,/rcpNo=20260904000123/);assert.equal(csvCell('=cmd'),'"\'=cmd"');
  assert.throws(()=>validateThesisContent({...content,checks:[{...content.checks[0],status:'bought'}]}));
  assert.throws(()=>theses.update(candidate.code,point.id,1,{content:{...content,checks:[{...content.checks[0],evidence_ids:[`manual:${randomUUID()}`]}]}}),/다른 투자포인트/);
});
