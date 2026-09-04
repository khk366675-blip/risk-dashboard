import io
import json
import sqlite3
import tempfile
import unittest
import uuid
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from research.documents import CONFIG, ROOT, DocumentError, digest, parse_archive
from scripts.collect_filing_document import collect, download
from scripts.local_backup import create_backup, restore_backup, verify_archive, BackupError

RECEIPT='20260814003108'


def archive(xml=None, extra=None):
    xml=xml or '<DOCUMENT><TITLE>II. 사업의 내용</TITLE><P>가동률 83.1% / R&amp;D / 단위: 백만원</P><TITLE>3. 연결재무제표 주석</TITLE><P>제 20기 반기, 제 19기 반기</P><TABLE><TR><TH COLSPAN="2">연결 · 단위: 원</TH></TR><TR><TD>매출</TD><TD>(1,200)</TD></TR></TABLE></DOCUMENT>'
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr(RECEIPT+'.xml',xml.encode('utf-8'))
        for name,content in (extra or {}).items():z.writestr(name,content)
    return output.getvalue()


class DocumentTests(unittest.TestCase):
    def test_nested_notes_keep_their_group_despite_financial_subheading(self):
        xml='<DOCUMENT><SECTION-1><TITLE>III. 재무에 관한 사항</TITLE><SECTION-2><TITLE>5. 재무제표 주석</TITLE><SECTION-3><TITLE>2. 재무제표 작성기준</TITLE><P>연결 기준</P></SECTION-3></SECTION-2></SECTION-1></DOCUMENT>'
        self.assertEqual([s['group'] for s in parse_archive(archive(xml),RECEIPT)['sections']],['financials','notes','notes'])

    def test_sections_tables_units_periods_and_quote_anchors_are_preserved(self):
        d=parse_archive(archive(),RECEIPT)
        self.assertEqual(d['status'],'ready')
        self.assertEqual([s['group'] for s in d['sections']],['business','notes'])
        table=next(b for b in d['blocks'] if b['kind']=='table')
        self.assertEqual(table['rows'][0][0]['colspan'],2)
        self.assertEqual(table['rows'][1][1]['text'],'(1,200)')
        self.assertIn('단위: 원',table['text'])
        self.assertTrue(all(b['source_path'].startswith('/DOCUMENT/') for b in d['blocks']))
        self.assertEqual(len({b['id'] for b in d['blocks']}),len(d['blocks']))

    def test_real_dart_literal_notation_is_visible_and_cdata_is_not_rewritten(self):
        d=parse_archive(archive('<DOCUMENT><P>R&D &lt;기준&gt; <한글 표제></P><P><![CDATA[R&D <예시>]]></P></DOCUMENT>'),RECEIPT)
        self.assertEqual(d['blocks'][0]['text'],'R&D <기준> <한글 표제>')
        self.assertEqual(d['blocks'][1]['text'],'R&D <예시>')
        self.assertEqual(d['normalization'],{'bare_ampersands':1,'literal_captions':1})
        self.assertEqual(d['status'],'partial')

    def test_unsafe_entities_traversal_wrong_root_and_broken_nesting_fail_closed(self):
        for raw in [archive('<!DOCTYPE DOCUMENT [<!ENTITY a SYSTEM "file:///secret">]><DOCUMENT><P>&a;</P></DOCUMENT>'),archive('<DOCUMENT><P>x</DOCUMENT>'),archive('<html>not DART XML</html>'),archive(extra={'../unsafe.xml':'bad'})]:
            with self.subTest(raw=raw[:10]),self.assertRaises(DocumentError):parse_archive(raw,RECEIPT)

    def test_provider_200_error_and_missing_key_do_not_become_documents(self):
        for code in ['010','013','014','020','800']:
            with self.assertRaises(DocumentError):parse_archive(f'<result><status>{code}</status><message>private raw error</message></result>'.encode(),RECEIPT)
        with patch('scripts.collect_filing_document.requests.get') as request:
            with self.assertRaises(DocumentError):download(RECEIPT,'')
            request.assert_not_called()

    def test_limits_and_attachments_are_explicit(self):
        d=parse_archive(archive(extra={'appendix.pdf':b'not interpreted'}),RECEIPT)
        self.assertEqual(d['omitted_members'],['appendix.pdf'])
        self.assertEqual(d['status'],'partial')
        with patch.dict(CONFIG,{'max_unpacked_bytes':10}):
            with self.assertRaises(DocumentError):parse_archive(archive(),RECEIPT)

    def fixture(self):
        temporary=tempfile.TemporaryDirectory(prefix='value-documents-test-')
        self.addCleanup(temporary.cleanup)
        root=Path(temporary.name)/'project'
        (root/'research').mkdir(parents=True)
        for name in ['config.json','schema.sql','backup-config.json','thesis-config.json','thesis-ai.json','ai-request-policy.json','documents-config.json']:
            (root/'research'/name).write_bytes((ROOT/'research'/name).read_bytes())
        directory=root/'data/research';directory.mkdir(parents=True)
        db=sqlite3.connect(directory/'watchlist.sqlite');self.addCleanup(db.close)
        db.executescript((ROOT/'research/schema.sql').read_text(encoding='utf-8'))
        job=str(uuid.uuid4())
        with db:
            db.execute('INSERT INTO watchlist VALUES(?,?,?,?,?,?,?,?)',('000001','격리 테스트','{}','radar','date','date',1,'{}'))
            db.execute('INSERT INTO filing_documents(code,receipt,title,filing_date,job_id,state,requested_at) VALUES(?,?,?,?,?,?,?)',('000001',RECEIPT,'반기보고서','20260814',job,'queued','2026-09-03T00:00:00Z'))
        return root,directory,db,job

    def test_worker_deduplication_versioning_and_failure_preserve_sources_and_writing(self):
        root,directory,db,job=self.fixture()
        calls=[]
        def fetcher(*_):calls.append(1);return archive()
        collect(directory,'000001',RECEIPT,job,fetcher)
        collect(directory,'000001',RECEIPT,job,fetcher)
        self.assertEqual(len(calls),1)
        before=db.execute('SELECT current_version FROM filing_documents').fetchone()[0]
        with db:db.execute("UPDATE filing_documents SET state='queued',job_id='second'")
        collect(directory,'000001',RECEIPT,'second',lambda *_:b'<result><status>020</status></result>')
        self.assertEqual(db.execute('SELECT state,current_version FROM filing_documents').fetchone(),('error',before))
        with db:db.execute("UPDATE filing_documents SET state='queued',job_id='third'")
        collect(directory,'000001',RECEIPT,'third',lambda *_:archive('<DOCUMENT><P>정정 전후는 별개 원문</P></DOCUMENT>'))
        self.assertEqual(db.execute('SELECT count(*) FROM filing_document_versions').fetchone()[0],2)
        self.assertEqual(db.execute('SELECT detail_json FROM watchlist').fetchone()[0],'{}')
        self.assertEqual(db.execute('SELECT count(*) FROM ai_request_attempts').fetchone()[0],0)

    def test_backup_preserves_originals_and_requires_all_referenced_files(self):
        root,directory,db,job=self.fixture()
        collect(directory,'000001',RECEIPT,job,lambda *_:archive())
        with patch.dict('os.environ',{'RESEARCH_STORAGE_DIR':'','DASHBOARD_BACKUP_DIR':''}):
            file=create_backup(root)
            manifest=verify_archive(file)
            self.assertEqual(manifest['counts']['document_versions'],1)
            restored=restore_backup(file,root.parent/'restored',root)
            for relative,sha in db.execute('SELECT archive_path,archive_sha256 FROM filing_document_versions'):
                self.assertEqual(digest((restored/relative).read_bytes()),sha)
                (directory/relative).write_bytes(b'corrupted fixture')
            with self.assertRaises(BackupError):create_backup(root)

    def test_restore_pending_document_job_never_auto_resumes(self):
        root,directory,db,job=self.fixture()
        with patch.dict('os.environ',{'RESEARCH_STORAGE_DIR':'','DASHBOARD_BACKUP_DIR':''}):
            restored=restore_backup(create_backup(root),root.parent/'restored',root)
        with closing(sqlite3.connect(restored/'watchlist.sqlite')) as copy:
            state,error=copy.execute('SELECT state,error FROM filing_documents').fetchone()
        self.assertEqual(state,'error');self.assertIn('자동 재개하지 않습니다',error)
        self.assertEqual(db.execute('SELECT state FROM filing_documents').fetchone()[0],'queued')


if __name__=='__main__':unittest.main()
