import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts.local_backup import (
    ROOT, BackupError, backup_path, create_backup, digest, research_path,
    restore_backup, settings, verify_archive,
)


class LocalBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='value-backup-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.root.mkdir()
        (self.root / 'research').mkdir()
        for file in ['config.json', 'schema.sql', 'backup-config.json', 'thesis-config.json', 'thesis-ai.json', 'thesis-evidence-ai.json', 'ai-request-policy.json', 'documents-config.json', 'evidence-config.json', 'workbench-config.json']:
            (self.root / 'research' / file).write_bytes((ROOT / 'research' / file).read_bytes())
        self.env = patch.dict('os.environ', {'RESEARCH_STORAGE_DIR': '', 'DASHBOARD_BACKUP_DIR': ''})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.directory, self.database_name = research_path(self.root)
        self.directory.mkdir(parents=True)
        self.db = sqlite3.connect(self.directory / self.database_name)
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript((ROOT / 'research/schema.sql').read_text(encoding='utf-8'))
        for code, active in [('000001', 1), ('000002', 0)]:
            self.db.execute('INSERT INTO watchlist VALUES(?,?,?,?,?,?,?,?)', (code, '테스트', '{}', 'radar', '2026-09-02', '2026-09-03', active, '{"prices":[{"close":1234}],"events":[]}'))
        self.db.execute('INSERT INTO watchlist_reviews VALUES(?,?,?)', ('000001', '2026-09-03', '{"checked_at":"2026-09-03","events":{"keys":["receipt-1"]}}'))
        self.db.commit()
        raw = self.directory / 'raw/000001'
        raw.mkdir(parents=True)
        (raw / '2026_11012.json').write_text('{"basis":"CFS","rows":[]}', encoding='utf-8')
        (self.root / '.env.local').write_text('DART_API_KEY=never-export-this', encoding='utf-8')
        (self.directory / 'notes-secret.txt').write_text('not included', encoding='utf-8')

    def create(self):
        return create_backup(self.root)

    def verify(self, file):
        return verify_archive(file, settings(self.root))

    def rewrite(self, file, transform):
        with zipfile.ZipFile(file) as source:
            members = {name: source.read(name) for name in source.namelist()}
        transform(members)
        rewritten = file.parent / 'modified.zip'
        with zipfile.ZipFile(rewritten, 'w') as target:
            for name, content in members.items():
                target.writestr(name, content)
        return rewritten

    def test_wal_snapshot_preserves_registered_removed_and_review_data(self):
        self.assertTrue((self.directory / (self.database_name + '-wal')).exists())
        file = self.create()
        manifest = self.verify(file)
        self.assertEqual(manifest['counts'], {'registered': 1, 'retained': 2, 'reviews': 1, 'theses': 0, 'theses_retained': 0, 'thesis_versions': 0, 'ai_runs': 0, 'ai_attempts': 0, 'ai_pending': 0, 'documents': 0, 'document_versions': 0, 'evidence_links': 0, 'evidence_links_retained': 0, 'financial_evidence_links': 0, 'financial_evidence_links_retained': 0, 'manual_evidence_links': 0, 'manual_evidence_links_retained': 0, 'update_states': 0, 'open_updates': 0, 'thesis_statuses': 0, 'evidence_ai_runs': 0, 'evidence_ai_pending': 0, 'research_kpis': 0, 'research_kpi_observations': 0, 'research_journal_entries': 0, 'learning_items': 0, 'learning_links': 0})
        self.assertIn('research/raw/000001/2026_11012.json', manifest['files'])
        with zipfile.ZipFile(file) as source:
            self.assertFalse(any('.env' in name or 'secret' in name or name.endswith(('-wal', '-shm')) for name in source.namelist()))
            self.assertNotIn(b'never-export-this', b''.join(source.read(name) for name in source.namelist()))
        self.assertEqual(self.db.execute('SELECT count(*) FROM watchlist').fetchone()[0], 2)
        self.assertFalse(file.is_relative_to(self.root))

    def test_restore_is_separate_and_preserves_all_user_rows(self):
        file = self.create()
        self.db.execute('UPDATE watchlist SET name=? WHERE code=?', ('새 이름', '000001'))
        self.db.commit()
        target = self.root.parent / 'recovered-copy'
        restored = restore_backup(file, target, self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT name FROM watchlist WHERE code=?', ('000001',)).fetchone()[0], '테스트')
            self.assertEqual(db.execute('SELECT count(*) FROM watchlist_reviews').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT active FROM watchlist WHERE code=?', ('000002',)).fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT name FROM watchlist WHERE code=?', ('000001',)).fetchone()[0], '새 이름')
        self.assertTrue((target / 'context/research/config.json').exists())
        self.assertTrue((target / 'restore-info.json').exists())

    def test_running_job_raw_cache_is_omitted_and_never_restarted(self):
        self.db.execute('INSERT INTO research_jobs VALUES(?,?,?,?,?,?,?,?)', ('000001', 'old-job', 'running', 'all', 'collecting', None, '2026-09-03', 9999))
        self.db.commit()
        file = self.create()
        manifest = self.verify(file)
        self.assertTrue(manifest['warnings'])
        self.assertNotIn('research/raw/000001/2026_11012.json', manifest['files'])
        restored = restore_backup(file, self.root.parent / 'recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            row = db.execute('SELECT state,pid,error FROM research_jobs').fetchone()
        self.assertEqual(row[:2], ('error', None))
        self.assertIn('자동 재개하지 않습니다', row[2])
        self.assertEqual(self.db.execute('SELECT state FROM research_jobs').fetchone()[0], 'running')

    def test_existing_directory_even_empty_is_never_overwritten(self):
        file = self.create()
        target = self.root.parent / 'existing'
        target.mkdir()
        with self.assertRaises(BackupError):
            restore_backup(file, target, self.root)
        self.assertEqual(list(target.iterdir()), [])

    def test_restore_inside_active_data_is_blocked(self):
        with self.assertRaises(BackupError):
            restore_backup(self.create(), self.directory / 'recovered', self.root)

    def test_checksum_damage_blocks_restore_without_creating_target(self):
        file = self.rewrite(self.create(), lambda members: members.update({'research/raw/000001/2026_11012.json': b'{"tampered":true}'}))
        target = self.root.parent / 'must-not-exist'
        with self.assertRaises(BackupError):
            restore_backup(file, target, self.root)
        self.assertFalse(target.exists())

    def test_zip_traversal_and_unexpected_secret_entries_rejected(self):
        original = self.create()
        for name in ['../outside', '/absolute', 'C:/outside', 'research\\..\\outside', 'context/.env.local', 'research/raw/000001/../../outside']:
            with self.subTest(name=name):
                file = self.rewrite(original, lambda members: members.update({name: b'bad'}))
                with self.assertRaises(BackupError):
                    self.verify(file)

    def test_db_corruption_rejected_even_with_updated_hash(self):
        def corrupt(members):
            name = 'research/' + self.database_name
            members[name] = b'not a sqlite file'
            manifest = json.loads(members['manifest.json'])
            manifest['files'][name] = {'bytes': len(members[name]), 'sha256': digest(members[name])}
            members['manifest.json'] = json.dumps(manifest).encode()
        with self.assertRaises(sqlite3.DatabaseError):
            self.verify(self.rewrite(self.create(), corrupt))

    def test_missing_db_does_not_create_empty_store(self):
        missing = self.root.parent / 'missing-data'
        self.assertIsNone(create_backup(self.root, directory=missing, automatic=True))
        self.assertFalse(missing.exists())
        with self.assertRaises(BackupError):
            create_backup(self.root, directory=missing)

    def test_invalid_source_does_not_publish_a_backup(self):
        self.db.execute("UPDATE watchlist SET detail_json='broken'")
        self.db.commit()
        with self.assertRaises(ValueError):
            self.create()
        self.assertFalse(list(backup_path(self.root).glob('backup-*.zip')))
        self.assertEqual(self.db.execute('SELECT detail_json FROM watchlist LIMIT 1').fetchone()[0], 'broken')

    def test_size_limit_and_version_validation(self):
        file = self.create()
        config = settings(self.root)
        config['max_total_bytes'] = 1
        with self.assertRaises(BackupError):
            verify_archive(file, config)
        config = settings(self.root)
        config['format_version'] = 999
        with self.assertRaises(BackupError):
            verify_archive(file, config)

    def test_repeated_backups_preserve_previous_archives(self):
        first, second = self.create(), self.create()
        self.assertNotEqual(first, second)
        self.assertTrue(first.exists() and second.exists())
        self.verify(first)
        self.verify(second)

    def test_override_paths_and_backup_recursion_guard(self):
        with patch.dict('os.environ', {'RESEARCH_STORAGE_DIR': str(self.directory), 'DASHBOARD_BACKUP_DIR': str(self.root.parent / 'custom-backups')}):
            self.assertEqual(self.create().parent, self.root.parent / 'custom-backups')
        with self.assertRaises(BackupError):
            create_backup(self.root, destination=self.directory / 'backups')

    def test_thesis_versions_checks_and_archived_points_survive_restore(self):
        content = json.dumps({'title': '가설', 'body': '  사용자가 적은\n원문  ', 'timing': '', 'weakens': '', 'source_url': '', 'checks': [{'id': 'check-1', 'text': '원문에서 확인할 질문'}]}, ensure_ascii=False)
        self.db.execute('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)', ('thesis-1', '000002', 2, 1, '2026-09-03', '2026-09-03', content))
        for version, archived in [(1, 0), (2, 1)]:
            self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('thesis-1', version, archived, '2026-09-03', content))
        self.db.commit()
        file = self.create()
        self.assertEqual(self.verify(file)['counts']['thesis_versions'], 2)
        restored = restore_backup(file, self.root.parent / 'thesis-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT content_json FROM investment_theses').fetchone()[0], content)
            self.assertEqual(db.execute('SELECT count(*) FROM investment_thesis_revisions').fetchone()[0], 2)
        self.db.execute("UPDATE investment_theses SET revision=3")
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()

    def test_old_backup_without_thesis_tables_remains_restorable(self):
        self.db.executescript('DROP TABLE research_manual_evidence; DROP TABLE research_financial_evidence; DROP TABLE research_evidence; DROP TABLE thesis_ai_runs; DROP TABLE ai_request_attempts; DROP TABLE investment_thesis_revisions; DROP TABLE investment_theses;')
        file = self.create()
        self.assertNotIn('theses', self.verify(file)['counts'])
        restored = restore_backup(file, self.root.parent / 'legacy-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM watchlist').fetchone()[0], 2)

    def test_financial_evidence_snapshot_survives_restore_and_is_validated(self):
        content = json.dumps({'title': '재무 가설', 'body': '매출과 이익률을 확인한다.', 'timing': '', 'weakens': '', 'source_url': '', 'checks': []}, ensure_ascii=False)
        self.db.execute('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)', ('point-finance', '000001', 1, 0, 'now', 'now', content))
        self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('point-finance', 1, 0, 'now', content))
        self.db.execute(
            'INSERT INTO research_financial_evidence(id,code,thesis_id,thesis_revision,relation,note,metric,metric_label,unit,year,quarter,value_json,statement_basis,receipt_no,source_run_id,source_collected_at,source_status_json,snapshot_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ('finance-link', '000001', 'point-finance', 1, 'context', '변화 확인', 'rev', '매출액', '억원', 2026, '2Q', '{"value":100,"raw_value":10000000000}', 'CFS', '20260814003108', 'run-1', '2026-09-04', '{"status":"ok","as_of":"2026 2Q"}', 'a' * 64, 'now'),
        )
        self.db.commit()
        file = self.create()
        self.assertEqual(self.verify(file)['counts']['financial_evidence_links'], 1)
        restored = restore_backup(file, self.root.parent / 'financial-evidence-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT value_json FROM research_financial_evidence').fetchone()[0], '{"value":100,"raw_value":10000000000}')
        self.db.execute("UPDATE research_financial_evidence SET value_json='{}'")
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()

    def test_manual_evidence_snapshot_survives_restore_and_is_validated(self):
        content = json.dumps({'title': '외부 자료 가설', 'body': '시장 자료를 확인한다.', 'timing': '', 'weakens': '', 'source_url': '', 'checks': []}, ensure_ascii=False)
        self.db.execute('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)', ('point-manual', '000001', 1, 0, 'now', 'now', content))
        self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('point-manual', 1, 0, 'now', content))
        self.db.execute(
            'INSERT INTO research_manual_evidence(id,code,thesis_id,thesis_revision,relation,source_type,title,url,source_name,published_at,body,note,source_status,snapshot_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ('manual-link', '000001', 'point-manual', 1, 'context', 'news', '시장 기사', 'https://example.com/news', '테스트 매체', '2026-09-04', '사용자 기록', '재확인', 'user_supplied', 'b' * 64, 'now'),
        )
        self.db.commit()
        file = self.create()
        self.assertEqual(self.verify(file)['counts']['manual_evidence_links'], 1)
        restored = restore_backup(file, self.root.parent / 'manual-evidence-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT body FROM research_manual_evidence').fetchone()[0], '사용자 기록')
        self.db.execute("UPDATE research_manual_evidence SET snapshot_hash='broken'")
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()

    def test_workbench_state_and_evidence_ai_survive_restore(self):
        content = json.dumps({'title': '검토판 가설', 'body': '연결 자료를 검토한다.', 'timing': '', 'weakens': '', 'source_url': '', 'checks': []}, ensure_ascii=False)
        self.db.execute('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)', ('point-workbench', '000001', 1, 0, 'now', 'now', content))
        self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('point-workbench', 1, 0, 'now', content))
        self.db.execute('INSERT INTO research_update_states VALUES(?,?,?,?,?,?)', ('filing:000001:test', '000001', 'reviewed', '원문 확인', '2026-09-04', '2026-09-04'))
        self.db.execute('INSERT INTO investment_thesis_status VALUES(?,?,?,?,?,?)', ('point-workbench', '000001', 'on_hold', '자료 대기', '2026-09-04', '2026-09-04'))
        self.db.execute('INSERT INTO ai_request_attempts VALUES(?,?,?,?,?)', ('run-evidence', 'thesis_evidence_review', 1, 2, 2))
        payload = {'company': {'code': '000001', 'name': '테스트'}, 'point': {'id': 'point-workbench', 'revision': 1, 'title': '검토판 가설', 'body': '연결 자료를 검토한다.', 'timing': '', 'weakens': '', 'existing_questions': []}, 'evidence': []}
        answer = {'status': 'insufficient_evidence', 'findings': []}
        self.db.execute('INSERT INTO thesis_evidence_ai_runs(id,thesis_id,thesis_revision,evidence_signature,model,prompt_version,input_json,created_at,completed_at,state,answer_json,usage_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ('run-evidence', 'point-workbench', 1, 'c'*64, 'test-model', 'test-prompt', json.dumps(payload), 'now', 'later', 'completed', json.dumps(answer), '{"input_tokens":20,"output_tokens":10}'))
        self.db.commit()
        file = self.create()
        manifest = self.verify(file)
        self.assertEqual(manifest['counts']['update_states'], 1)
        self.assertEqual(manifest['counts']['thesis_statuses'], 1)
        self.assertEqual(manifest['counts']['evidence_ai_runs'], 1)
        restored = restore_backup(file, self.root.parent / 'workbench-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT note FROM research_update_states').fetchone()[0], '원문 확인')
            self.assertEqual(db.execute('SELECT state FROM investment_thesis_status').fetchone()[0], 'on_hold')
            self.assertEqual(db.execute('SELECT answer_json FROM thesis_evidence_ai_runs').fetchone()[0], json.dumps(answer))
        self.db.execute("UPDATE investment_thesis_status SET code='bad'")
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()

    def test_research_system_records_survive_restore_and_are_validated(self):
        self.db.execute("INSERT INTO research_kpis(id,code,name,unit,category,description,created_at,updated_at) VALUES('kpi-1','000001','가입자','만명','quantity','수량 변수','now','now')")
        self.db.execute("INSERT INTO research_kpi_observations(id,kpi_id,period,actual,estimate,source_label,note,created_at,updated_at) VALUES('obs-1','kpi-1','2026 3Q',120,115,'분기보고서','','now','now')")
        self.db.execute("INSERT INTO research_journal_entries(id,code,kind,title,body,occurred_at,created_at,updated_at) VALUES('journal-1','000001','feedback','세션 피드백','가격 가정 확인','2026-09-04','now','now')")
        self.db.execute("INSERT INTO learning_items(id,kind,title,author,status,tags_json,summary,lessons,changed_view,applications,disagreements,created_at,updated_at) VALUES('learning-1','book','Quality Investing','테스트','reading','[\"quality\"]','요약','배운 점','','','','now','now')")
        self.db.execute("INSERT INTO learning_stock_links VALUES('learning-1','000001','now')")
        self.db.commit()
        file = self.create()
        manifest = self.verify(file)
        self.assertEqual(manifest['counts']['research_kpis'], 1)
        self.assertEqual(manifest['counts']['learning_links'], 1)
        restored = restore_backup(file, self.root.parent / 'research-system-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT actual FROM research_kpi_observations').fetchone()[0], 120)
            self.assertEqual(db.execute('SELECT body FROM research_journal_entries').fetchone()[0], '가격 가정 확인')
        self.db.execute("UPDATE learning_items SET tags_json='{}'")
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()

    def seed_ai(self, pending=False):
        content = {'title': '가설', 'body': '검증할 가설', 'timing': '', 'weakens': '', 'source_url': '', 'checks': []}
        raw = json.dumps(content, ensure_ascii=False)
        self.db.execute('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)', ('point-ai', '000001', 1, 0, 'now', 'now', raw))
        self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('point-ai', 1, 0, 'now', raw))
        self.db.execute('INSERT INTO ai_request_attempts VALUES(?,?,?,?,?)', ('run-ai', 'thesis_questions', 1, 9999999999999, None if pending else 2))
        payload = {'company': {'code': '000001', 'name': '테스트'}, 'point': {k: content[k] for k in ('title', 'body', 'timing', 'weakens')}, 'existing_questions': []}
        answer = {'status': 'questions', 'suggestions': [{'kind': 'challenge', 'anchor_field': 'body', 'anchor_quote': '검증할 가설', 'question': '어떤 조건이면 약해지나요?', 'why': '반대 가정 점검', 'source_kind': 'user_clarification', 'look_for': '반대 조건을 정의', 'weakening_signal': '반대 조건이라면 재검토'}]}
        self.db.execute('INSERT INTO thesis_ai_runs(id,thesis_id,thesis_revision,signature,model,prompt_version,input_json,created_at,state,answer_json,usage_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ('run-ai', 'point-ai', 1, 'a'*64, 'test-model', 'test-prompt', json.dumps(payload), 'now', 'pending' if pending else 'completed', None if pending else json.dumps(answer), None if pending else '{"input_tokens":100,"output_tokens":30}'))
        if not pending:
            content['checks'] = [{'id': 'accepted-check', 'text': '사용자가 수정한 질문'}]
            changed = json.dumps(content, ensure_ascii=False)
            self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('point-ai', 2, 0, 'later', changed))
            self.db.execute('UPDATE investment_theses SET revision=2,content_json=? WHERE id=?', (changed, 'point-ai'))
            adoption = {'revision': 2, 'checks': [{'suggestion_index': 0, 'check_id': 'accepted-check', 'text': '사용자가 수정한 질문'}]}
            self.db.execute('UPDATE thesis_ai_runs SET adoption_json=?', (json.dumps(adoption),))
        self.db.commit()

    def test_ai_input_result_usage_and_adoption_survive_restore(self):
        self.seed_ai()
        file = self.create()
        self.assertEqual(self.verify(file)['counts']['ai_runs'], 1)
        original = self.db.execute('SELECT input_json,answer_json,usage_json,adoption_json FROM thesis_ai_runs').fetchone()
        restored = restore_backup(file, self.root.parent / 'ai-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            self.assertEqual(db.execute('SELECT input_json,answer_json,usage_json,adoption_json FROM thesis_ai_runs').fetchone(), original)
        self.db.execute("UPDATE thesis_ai_runs SET usage_json='{}'")
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()

    def test_pending_ai_restore_never_resumes_or_resends(self):
        self.seed_ai(pending=True)
        file = self.create()
        self.assertEqual(self.verify(file)['counts']['ai_pending'], 1)
        self.assertTrue(self.verify(file)['warnings'])
        restored = restore_backup(file, self.root.parent / 'pending-ai-recovered', self.root)
        with closing(sqlite3.connect(restored / self.database_name)) as db:
            state, error = db.execute('SELECT state,error_message FROM thesis_ai_runs').fetchone()
            self.assertEqual(state, 'error')
            self.assertIn('자동', error)
            self.assertIsNotNone(db.execute('SELECT finished_at FROM ai_request_attempts').fetchone()[0])
        self.assertEqual(self.db.execute('SELECT state FROM thesis_ai_runs').fetchone()[0], 'pending')

    def test_pre_ai_backup_with_theses_remains_restorable(self):
        self.db.executescript('DROP TABLE thesis_ai_runs; DROP TABLE ai_request_attempts;')
        file = self.create()
        self.assertNotIn('ai_runs', self.verify(file)['counts'])
        restored = restore_backup(file, self.root.parent / 'pre-ai-recovered', self.root)
        self.assertTrue((restored / self.database_name).exists())

    def test_malformed_thesis_json_does_not_publish_backup(self):
        self.db.execute('INSERT INTO investment_theses VALUES(?,?,?,?,?,?,?)', ('bad', '000001', 1, 0, 'now', 'now', '{}'))
        self.db.execute('INSERT INTO investment_thesis_revisions VALUES(?,?,?,?,?)', ('bad', 1, 0, 'now', '{}'))
        self.db.commit()
        with self.assertRaises(BackupError):
            self.create()


if __name__ == '__main__':
    unittest.main()
