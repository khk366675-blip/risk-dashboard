import io,json,os,sqlite3,sys,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch,Mock
from scripts import dashboard_job as jobs

class DashboardJobTests(unittest.TestCase):
    def exercise(self, returncode=0, status='ok', claimed=True):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            db=sqlite3.connect(root/'watchlist.sqlite')
            db.executescript((jobs.config.ROOT/'research/schema.sql').read_text(encoding='utf-8'))
            db.execute("INSERT INTO dashboard_jobs(id,kind,state,step,started_at,updated_at) VALUES('test','markets',?,'準備','2026','2026')",('queued' if claimed else 'completed',));db.commit()
            output=root/'result.json';output.write_text(json.dumps({'status':status}),encoding='utf-8')
            child=Mock();child.stdout=io.StringIO('source finished\n');child.poll.return_value=returncode;child.returncode=returncode
            with patch.dict(os.environ,{'RESEARCH_STORAGE_DIR':directory}),patch.object(sys,'argv',['worker','--id','test','--kind','markets']),patch.object(jobs.subprocess,'Popen',return_value=child) as spawn,patch.object(jobs.config,'PUBLIC_MARKET_PATH',output):
                exitcode=jobs.main()
            row=db.execute('SELECT state,error FROM dashboard_jobs').fetchone();db.close()
            return exitcode,row,spawn.call_count
    def test_success_and_partial_are_persisted(self):
        self.assertEqual(self.exercise()[:2],(0,('completed',None)))
        self.assertEqual(self.exercise(status='partial')[:2],(0,('partial',None)))
    def test_failed_process_cannot_be_marked_success(self):
        code,row,_=self.exercise(returncode=1);self.assertEqual(code,1);self.assertEqual(row[0],'error')
    def test_duplicate_or_already_completed_worker_never_starts_collector(self):
        self.assertEqual(self.exercise(claimed=False)[2],0)

if __name__=='__main__':unittest.main()
