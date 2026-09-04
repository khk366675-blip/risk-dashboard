"""Optional, explicit live DART smoke. Private notes/active database are never read."""
import io
import json
import os
import sqlite3
import tempfile
import uuid
import zipfile
from pathlib import Path
from dotenv import load_dotenv
from lxml import etree
from research.documents import ROOT
from scripts.collect_filing_document import collect

directory=Path(tempfile.mkdtemp(prefix='value-documents-live-'))
code,receipt='043260','20260814003108'
data=json.loads((ROOT/f'public/data/radar/stocks/{code}.json').read_text(encoding='utf-8'))
data['name']='[원문 테스트] 성호전자'
data['data_level']='research'
data['events']=[{'id':'dart:'+receipt,'date':'20260814','title':'반기보고서 (2026.06)','url':f'https://dart.fss.or.kr/dsaf001/main.do?rcpNo={receipt}','importance':None,'direction':None}]
db=sqlite3.connect(directory/'watchlist.sqlite')
db.executescript((ROOT/'research/schema.sql').read_text(encoding='utf-8'))
job=str(uuid.uuid4())
with db:
    db.execute('INSERT INTO watchlist VALUES(?,?,?,?,?,?,?,?)',(code,'[원문 테스트] 성호전자',json.dumps(data['radar']),'test','2026-09-03','2026-09-03',1,json.dumps(data)))
    db.execute('INSERT INTO filing_documents(code,receipt,title,filing_date,job_id,state,requested_at) VALUES(?,?,?,?,?,?,?)',(code,receipt,'반기보고서 (2026.06)','20260814',job,'queued','2026-09-03T00:00:00.000Z'))
    db.execute('INSERT INTO research_jobs VALUES(?,?,?,?,?,?,?,?)',(code,'fixture','ready','all','격리된 원문 검증 자료 · 사용자 관심종목과 무관',None,'2026-09-03',None))
load_dotenv(ROOT.parent/'ai-invest/.env',override=False)
if os.getenv('DOCUMENT_TEST_ARCHIVE'):
    collect(directory,code,receipt,job,lambda *_:Path(os.environ['DOCUMENT_TEST_ARCHIVE']).read_bytes())
else:
    collect(directory,code,receipt,job)
row=db.execute('SELECT state,error FROM filing_documents').fetchone()
print(json.dumps({'directory':str(directory),'state':row[0],'error':row[1]},ensure_ascii=True))
for file in directory.rglob('*.zip'):
    with zipfile.ZipFile(file) as z:
        name=next(n for n in z.namelist() if n.endswith('.xml'))
        raw=z.read(name)
        p=etree.XMLParser(resolve_entities=False,no_network=True,load_dtd=False,recover=False)
        try:
            etree.fromstring(raw,p)
        except etree.XMLSyntaxError:
            print(json.dumps({'member':name,'prefix':raw[:160].decode('utf-8','replace'),'errors':[{'line':e.line,'type':e.type_name,'message':e.message} for e in p.error_log][:8]},ensure_ascii=True))
for file in directory.rglob('*.json'):
    d=json.loads(file.read_text(encoding='utf-8'))
    print(json.dumps({'sections':len(d['sections']),'blocks':len(d['blocks']),'groups':{g:sum(s['group']==g for s in d['sections']) for g in ['business','notes','financials','other']}},ensure_ascii=True))
db.close()
