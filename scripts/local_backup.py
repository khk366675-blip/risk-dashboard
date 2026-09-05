"""Local-only, verified data backups. Never replaces the active research store."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import tempfile
import time
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[1]


class BackupError(Exception):
    pass


def settings(root=ROOT):
    return json.loads((root / 'research/backup-config.json').read_text(encoding='utf-8'))


def research_path(root=ROOT):
    config = json.loads((root / 'research/config.json').read_text(encoding='utf-8'))
    return (root / (os.environ.get('RESEARCH_STORAGE_DIR') or config['storage_dir'])).resolve(), config['database_name']


def backup_path(root=ROOT):
    return (root / (os.environ.get('DASHBOARD_BACKUP_DIR') or settings(root)['directory'])).resolve()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_file(file: Path, parent: Path):
    if file.is_symlink() or not file.resolve().is_relative_to(parent.resolve()):
        raise BackupError(f'연결 파일/폴더는 백업하지 않습니다: {file.name}')
    if not file.is_file():
        raise BackupError(f'일반 파일이 아닙니다: {file.name}')


def check_database(file: Path):
    with closing(sqlite3.connect(file.as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise BackupError('DB 무결성 검사에 실패했습니다. 원본은 변경하지 않았습니다.')
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'watchlist', 'research_jobs', 'watchlist_reviews'} <= tables:
            raise BackupError('관심종목 DB 형식이 다릅니다.')
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise BackupError('DB 연결 관계 검사에 실패했습니다.')
        for table, columns in [('watchlist', ['candidate_json', 'detail_json']), ('watchlist_reviews', ['baseline_json'])]:
            for row in db.execute(f'SELECT {",".join(columns)} FROM {table}'):
                for value in row:
                    json.loads(value)
        counts = {
            'registered': db.execute('SELECT count(*) FROM watchlist WHERE active=1').fetchone()[0],
            'retained': db.execute('SELECT count(*) FROM watchlist').fetchone()[0],
            'reviews': db.execute('SELECT count(*) FROM watchlist_reviews').fetchone()[0],
        }
        thesis_tables = {'investment_theses', 'investment_thesis_revisions'}
        if tables & thesis_tables:
            if not thesis_tables <= tables:
                raise BackupError('투자포인트 저장소의 일부 테이블이 누락됐습니다.')
            for table in sorted(thesis_tables):
                for (value,) in db.execute(f'SELECT content_json FROM {table}'):
                    content = json.loads(value)
                    fields = {'title', 'body', 'timing', 'weakens', 'source_url', 'checks'}
                    if not isinstance(content, dict) or set(content) != fields or any(not isinstance(content[k], str) for k in fields - {'checks'}) or not content['body'].strip() or not isinstance(content['checks'], list):
                        raise BackupError('투자포인트 내용의 형식이 손상됐습니다.')
                    checks = content['checks']
                    if any(not isinstance(c, dict) or not {'id', 'text'} <= set(c) or set(c) - {'id', 'text', 'answer', 'unresolved', 'status', 'evidence_ids'} or not isinstance(c['id'], str) or not isinstance(c['text'], str) or not c['text'].strip() or any(k in c and not isinstance(c[k], str) for k in ('answer', 'unresolved')) or ('status' in c and c['status'] not in ('open', 'reviewing', 'answered')) or ('evidence_ids' in c and (not isinstance(c['evidence_ids'], list) or any(not isinstance(x, str) for x in c['evidence_ids']))) for c in checks) or len({c['id'] for c in checks}) != len(checks):
                        raise BackupError('검증 항목 형식이 손상됐습니다.')
            for row in db.execute('SELECT id,revision,archived,content_json FROM investment_theses'):
                latest = db.execute('SELECT revision,archived,content_json FROM investment_thesis_revisions WHERE thesis_id=? ORDER BY revision DESC LIMIT 1', (row[0],)).fetchone()
                versions = db.execute('SELECT count(*) FROM investment_thesis_revisions WHERE thesis_id=?', (row[0],)).fetchone()[0]
                if latest != row[1:] or versions != row[1]:
                    raise BackupError('투자포인트와 수정 기록의 버전이 일치하지 않습니다.')
            counts.update({
                'theses': db.execute('SELECT count(*) FROM investment_theses WHERE archived=0').fetchone()[0],
                'theses_retained': db.execute('SELECT count(*) FROM investment_theses').fetchone()[0],
                'thesis_versions': db.execute('SELECT count(*) FROM investment_thesis_revisions').fetchone()[0],
            })
        ai_tables = {'ai_request_attempts', 'thesis_ai_runs'}
        if tables & ai_tables:
            if not ai_tables <= tables or not thesis_tables <= tables:
                raise BackupError('AI 검토 저장소의 일부 테이블이 누락됐습니다.')
            for row in db.execute('SELECT thesis_id,thesis_revision,input_json,state,answer_json,usage_json,adoption_json FROM thesis_ai_runs'):
                thesis_id, revision, raw_input, state, raw_answer, raw_usage, raw_adoption = row
                data = json.loads(raw_input)
                if not isinstance(data, dict) or set(data) != {'company', 'point', 'existing_questions'}:
                    raise BackupError('AI 전송 범위 기록의 형식이 손상됐습니다.')
                source = db.execute('SELECT content_json FROM investment_thesis_revisions WHERE thesis_id=? AND revision=?', (thesis_id, revision)).fetchone()
                content = json.loads(source[0]) if source else None
                if not content or data['point'] != {k: content[k] for k in ('title', 'body', 'timing', 'weakens')} or data['existing_questions'] != [c['text'] for c in content['checks']]:
                    raise BackupError('AI 입력과 투자포인트 저장 버전이 일치하지 않습니다.')
                if state not in ('pending', 'completed', 'error') or (state == 'completed') != (raw_answer is not None):
                    raise BackupError('AI 실행 상태와 결과가 일치하지 않습니다.')
                answer = json.loads(raw_answer) if raw_answer else None
                if answer is not None and (not isinstance(answer, dict) or answer.get('status') not in ('questions', 'needs_clarification') or not isinstance(answer.get('suggestions'), list)):
                    raise BackupError('AI 질문 결과의 형식이 손상됐습니다.')
                if raw_usage is not None:
                    usage = json.loads(raw_usage)
                    if not isinstance(usage, dict) or set(usage) != {'input_tokens', 'output_tokens'} or any(v is not None and (type(v) is not int or v < 0) for v in usage.values()):
                        raise BackupError('AI 사용량 기록의 형식이 손상됐습니다.')
                if raw_adoption is not None:
                    adoption = json.loads(raw_adoption)
                    if not isinstance(adoption, dict) or type(adoption.get('revision')) is not int or not isinstance(adoption.get('checks'), list) or not answer:
                        raise BackupError('AI 질문 채택 기록의 형식이 손상됐습니다.')
                    adopted_version = db.execute('SELECT content_json FROM investment_thesis_revisions WHERE thesis_id=? AND revision=?', (thesis_id, adoption['revision'])).fetchone()
                    stored_checks = {c['id']: c['text'] for c in json.loads(adopted_version[0])['checks']} if adopted_version else {}
                    for check in adoption['checks']:
                        if not isinstance(check, dict) or set(check) != {'suggestion_index', 'check_id', 'text'} or type(check['suggestion_index']) is not int or not 0 <= check['suggestion_index'] < len(answer['suggestions']) or stored_checks.get(check['check_id']) != check['text']:
                            raise BackupError('AI 질문 채택 기록과 저장 버전이 일치하지 않습니다.')
            counts.update({
                'ai_attempts': db.execute('SELECT count(*) FROM ai_request_attempts').fetchone()[0],
                'ai_runs': db.execute('SELECT count(*) FROM thesis_ai_runs').fetchone()[0],
                'ai_pending': db.execute("SELECT count(*) FROM thesis_ai_runs WHERE state='pending'").fetchone()[0],
            })
        document_tables = {'filing_documents', 'filing_document_versions'}
        if tables & document_tables:
            if not document_tables <= tables:
                raise BackupError('공시 원문 저장소의 일부 테이블이 누락됐습니다.')
            for code, receipt, version in db.execute('SELECT code,receipt,current_version FROM filing_documents WHERE current_version IS NOT NULL'):
                if not db.execute('SELECT 1 FROM filing_document_versions WHERE code=? AND receipt=? AND version=? AND extracted_path IS NOT NULL', (code, receipt, version)).fetchone():
                    raise BackupError('최근 원문 버전이 저장 기록과 일치하지 않습니다.')
            document_files(db)
            counts.update({'documents': db.execute('SELECT count(*) FROM filing_documents').fetchone()[0],
                           'document_versions': db.execute('SELECT count(*) FROM filing_document_versions').fetchone()[0]})
        if 'research_evidence' in tables:
            required = document_tables | thesis_tables
            if not required <= tables:
                raise BackupError('연결 자료 저장소의 선행 테이블이 누락됐습니다.')
            for row in db.execute('SELECT thesis_id,thesis_revision,relation,excerpt_json,archived_at FROM research_evidence'):
                thesis_id, revision, relation, raw_excerpt, archived_at = row
                excerpt = json.loads(raw_excerpt)
                if relation not in ('supports', 'challenges', 'context') or not isinstance(excerpt, dict) or not isinstance(excerpt.get('text'), str) or (archived_at is not None and not isinstance(archived_at, str)):
                    raise BackupError('연결 자료 내용의 형식이 손상됐습니다.')
                if not db.execute('SELECT 1 FROM investment_thesis_revisions WHERE thesis_id=? AND revision=?', (thesis_id, revision)).fetchone():
                    raise BackupError('연결 자료의 투자포인트 저장본이 없습니다.')
            counts.update({
                'evidence_links': db.execute('SELECT count(*) FROM research_evidence WHERE archived_at IS NULL').fetchone()[0],
                'evidence_links_retained': db.execute('SELECT count(*) FROM research_evidence').fetchone()[0],
            })
        if 'research_financial_evidence' in tables:
            if not thesis_tables <= tables:
                raise BackupError('재무 연결 자료 저장소의 투자포인트 테이블이 누락됐습니다.')
            valid_metrics = {'rev', 'op', 'ni', 'ocf', 'op_margin_pct', 'equity', 'debt', 'debt_ratio_pct'}
            for row in db.execute('SELECT thesis_id,thesis_revision,relation,metric,year,quarter,value_json,source_status_json,snapshot_hash,archived_at FROM research_financial_evidence'):
                thesis_id, revision, relation, metric, year, quarter, raw_value, raw_status, snapshot_hash, archived_at = row
                values, status = json.loads(raw_value), json.loads(raw_status)
                if relation not in ('supports', 'challenges', 'context') or metric not in valid_metrics or type(year) is not int or not re.fullmatch(r'[1-4]Q', quarter or '') or not isinstance(values, dict) or set(values) != {'value', 'raw_value'} or any(value is not None and not isinstance(value, (int, float)) for value in values.values()) or not isinstance(status, dict) or not re.fullmatch(r'[a-f0-9]{64}', snapshot_hash or '') or (archived_at is not None and not isinstance(archived_at, str)):
                    raise BackupError('재무 연결 자료 내용의 형식이 손상됐습니다.')
                if not db.execute('SELECT 1 FROM investment_thesis_revisions WHERE thesis_id=? AND revision=?', (thesis_id, revision)).fetchone():
                    raise BackupError('재무 연결 자료의 투자포인트 저장본이 없습니다.')
            counts.update({
                'financial_evidence_links': db.execute('SELECT count(*) FROM research_financial_evidence WHERE archived_at IS NULL').fetchone()[0],
                'financial_evidence_links_retained': db.execute('SELECT count(*) FROM research_financial_evidence').fetchone()[0],
            })
        if 'research_manual_evidence' in tables:
            if not thesis_tables <= tables:
                raise BackupError('직접 추가 자료 저장소의 투자포인트 테이블이 누락됐습니다.')
            valid_types = {'news', 'broker_report', 'ir', 'industry', 'academic', 'memo', 'other'}
            for row in db.execute('SELECT thesis_id,thesis_revision,relation,source_type,title,url,published_at,source_status,snapshot_hash,archived_at FROM research_manual_evidence'):
                thesis_id, revision, relation, source_type, title, url, published_at, source_status, snapshot_hash, archived_at = row
                if relation not in ('supports', 'challenges', 'context') or source_type not in valid_types or not isinstance(title, str) or not title.strip() or (url is not None and not isinstance(url, str)) or (published_at is not None and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', published_at)) or source_status != 'user_supplied' or not re.fullmatch(r'[a-f0-9]{64}', snapshot_hash or '') or (archived_at is not None and not isinstance(archived_at, str)):
                    raise BackupError('직접 추가 자료 내용의 형식이 손상됐습니다.')
                if not db.execute('SELECT 1 FROM investment_thesis_revisions WHERE thesis_id=? AND revision=?', (thesis_id, revision)).fetchone():
                    raise BackupError('직접 추가 자료의 투자포인트 저장본이 없습니다.')
            counts.update({
                'manual_evidence_links': db.execute('SELECT count(*) FROM research_manual_evidence WHERE archived_at IS NULL').fetchone()[0],
                'manual_evidence_links_retained': db.execute('SELECT count(*) FROM research_manual_evidence').fetchone()[0],
            })
        if 'research_update_states' in tables:
            for item_key, code, status, note, reviewed_at, updated_at in db.execute('SELECT item_key,code,status,note,reviewed_at,updated_at FROM research_update_states'):
                if not isinstance(item_key, str) or not item_key or not re.fullmatch(r'\d{6}', code or '') or status not in ('open', 'reviewed') or not isinstance(note, str) or (status == 'reviewed') != isinstance(reviewed_at, str) or not isinstance(updated_at, str):
                    raise BackupError('업데이트 검토 상태의 형식이 손상됐습니다.')
            counts.update({
                'update_states': db.execute('SELECT count(*) FROM research_update_states').fetchone()[0],
                'open_updates': db.execute("SELECT count(*) FROM research_update_states WHERE status='open'").fetchone()[0],
            })
        if 'investment_thesis_status' in tables:
            thesis_status_count = db.execute('SELECT count(*) FROM investment_thesis_status').fetchone()[0]
            if thesis_status_count and not thesis_tables <= tables:
                raise BackupError('투자포인트 상태 저장소의 선행 테이블이 누락됐습니다.')
            for thesis_id, code, state, note, reviewed_at, updated_at in db.execute('SELECT thesis_id,code,state,note,reviewed_at,updated_at FROM investment_thesis_status'):
                if state not in ('open', 'strengthened', 'weakened', 'on_hold') or not isinstance(note, str) or not isinstance(reviewed_at, str) or not isinstance(updated_at, str) or not db.execute('SELECT 1 FROM investment_theses WHERE id=? AND code=?', (thesis_id, code)).fetchone():
                    raise BackupError('투자포인트 검토 상태의 형식이 손상됐습니다.')
            counts.update({
                'thesis_statuses': thesis_status_count,
            })
        if 'thesis_evidence_ai_runs' in tables:
            evidence_ai_count = db.execute('SELECT count(*) FROM thesis_evidence_ai_runs').fetchone()[0]
            if evidence_ai_count and not ({'ai_request_attempts'} | thesis_tables) <= tables:
                raise BackupError('AI 근거 검토 저장소의 선행 테이블이 누락됐습니다.')
            for thesis_id, revision, signature, raw_input, state, raw_answer, raw_usage in db.execute('SELECT thesis_id,thesis_revision,evidence_signature,input_json,state,answer_json,usage_json FROM thesis_evidence_ai_runs'):
                data = json.loads(raw_input)
                if not re.fullmatch(r'[a-f0-9]{64}', signature or '') or not isinstance(data, dict) or not {'company', 'point', 'evidence'} <= set(data) or set(data) - {'company', 'point', 'evidence', 'focus'} or not isinstance(data.get('evidence'), list):
                    raise BackupError('AI 근거 검토 전송 범위가 손상됐습니다.')
                source = db.execute('SELECT content_json FROM investment_thesis_revisions WHERE thesis_id=? AND revision=?', (thesis_id, revision)).fetchone()
                if not source or data.get('point', {}).get('revision') != revision or data.get('point', {}).get('id') != thesis_id:
                    raise BackupError('AI 근거 검토와 투자포인트 저장 버전이 일치하지 않습니다.')
                if 'focus' in data:
                    focus = data['focus']
                    checks = json.loads(source[0])['checks']
                    check = next((c for c in checks if c['id'] == focus.get('id')), None) if isinstance(focus, dict) else None
                    if not check or focus != {'id': check['id'], 'question': check['text'], 'answer': check.get('answer', ''), 'unresolved': check.get('unresolved', '')}:
                        raise BackupError('AI 검토 질문과 저장된 답변 버전이 일치하지 않습니다.')
                if state not in ('pending', 'completed', 'error') or (state == 'completed') != (raw_answer is not None):
                    raise BackupError('AI 근거 검토 실행 상태와 결과가 일치하지 않습니다.')
                if raw_answer is not None:
                    answer = json.loads(raw_answer)
                    if not isinstance(answer, dict) or answer.get('status') not in ('review_ready', 'insufficient_evidence') or not isinstance(answer.get('findings'), list):
                        raise BackupError('AI 근거 검토 결과의 형식이 손상됐습니다.')
                if raw_usage is not None:
                    usage = json.loads(raw_usage)
                    if not isinstance(usage, dict) or set(usage) != {'input_tokens', 'output_tokens'} or any(value is not None and (type(value) is not int or value < 0) for value in usage.values()):
                        raise BackupError('AI 근거 검토 사용량 기록이 손상됐습니다.')
            counts.update({
                'evidence_ai_runs': evidence_ai_count,
                'evidence_ai_pending': db.execute("SELECT count(*) FROM thesis_evidence_ai_runs WHERE state='pending'").fetchone()[0],
            })
        research_system_tables = {'research_kpis', 'research_kpi_observations', 'research_journal_entries', 'learning_items', 'learning_stock_links'}
        if tables & research_system_tables:
            if not research_system_tables <= tables:
                raise BackupError('리서치 확장 저장소의 일부 테이블이 누락됐습니다.')
            for (raw_tags,) in db.execute('SELECT tags_json FROM learning_items'):
                tags = json.loads(raw_tags)
                if not isinstance(tags, list) or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
                    raise BackupError('학습 기록 태그 형식이 손상됐습니다.')
            counts.update({
                'research_kpis': db.execute('SELECT count(*) FROM research_kpis WHERE archived_at IS NULL').fetchone()[0],
                'research_kpi_observations': db.execute('SELECT count(*) FROM research_kpi_observations WHERE archived_at IS NULL').fetchone()[0],
                'research_journal_entries': db.execute('SELECT count(*) FROM research_journal_entries WHERE archived_at IS NULL').fetchone()[0],
                'learning_items': db.execute('SELECT count(*) FROM learning_items WHERE archived_at IS NULL').fetchone()[0],
                'learning_links': db.execute('SELECT count(*) FROM learning_stock_links').fetchone()[0],
            })
        return counts


def document_files(db):
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'filing_document_versions' not in tables:
        return []
    files = {}
    for code, receipt, archive, archive_hash, extracted, extracted_hash, metadata in db.execute('SELECT code,receipt,archive_path,archive_sha256,extracted_path,extracted_sha256,metadata_json FROM filing_document_versions'):
        if not isinstance(json.loads(metadata).get('warnings'), list):
            raise BackupError('공시 추출 상태 기록이 손상됐습니다.')
        for name, sha, ext in [(archive, archive_hash, 'zip'), (extracted, extracted_hash, 'json')]:
            if name is None and sha is None and ext == 'json':
                continue
            if not re.fullmatch(r'\d{6}', code) or not re.fullmatch(r'\d{14}', receipt) or not re.fullmatch(r'[a-f0-9]{64}', sha or '') or name != f'documents/{code}/{receipt}/{sha}.{ext}':
                raise BackupError('공시 원문 파일의 경로·해시 기록이 잘못됐습니다.')
            files[name] = sha
    return list(files.items())


def allowed_member(name, database_name, config):
    parts = PurePosixPath(name).parts
    if not parts or name.startswith('/') or '\\' in name or ':' in name or any(p in ('.', '..') for p in name.split('/')):
        return False
    if name == f'research/{database_name}':
        return True
    if re.fullmatch(r'research/raw/\d{6}/\d{4}_\d{5}\.json', name):
        return True
    if re.fullmatch(r'research/documents/\d{6}/\d{14}/[a-f0-9]{64}\.(zip|json)', name):
        return True
    if name.startswith('context/'):
        relative = name.removeprefix('context/')
        return any(relative == item or (item.startswith('public/data/') and relative.startswith(item + '/') and relative.endswith('.json')) for item in config['context_paths'])
    return False


def verify_archive(archive: Path, config=None, database_name='watchlist.sqlite'):
    config = config or settings()
    with zipfile.ZipFile(archive) as source:
        infos = source.infolist()
        names = [info.filename for info in infos]
        if len(infos) > config['max_files'] + 1 or len(names) != len(set(names)):
            raise BackupError('백업 파일 수 또는 중복 경로가 잘못됐습니다.')
        if sum(info.file_size for info in infos) > config['max_total_bytes']:
            raise BackupError('백업 압축 해제 크기 한도를 초과했습니다.')
        for info in infos:
            if info.file_size > config['max_file_bytes'] or stat.S_ISLNK(info.external_attr >> 16):
                raise BackupError('허용하지 않는 백업 항목입니다.')
            if info.filename != 'manifest.json' and not allowed_member(info.filename, database_name, config):
                raise BackupError('백업에 허용하지 않는 경로가 있습니다.')
        manifest = json.loads(source.read('manifest.json'))
        if manifest.get('format_version') != config['format_version']:
            raise BackupError('지원하지 않는 백업 버전입니다.')
        entries = manifest.get('files')
        if not isinstance(entries, dict) or set(names) != {'manifest.json', *entries}:
            raise BackupError('백업 파일 목록이 일치하지 않습니다.')
        database = f'research/{database_name}'
        if database not in entries:
            raise BackupError('백업에 관심종목 DB가 없습니다.')
        for name, expected in entries.items():
            content = source.read(name)
            if len(content) != expected['bytes'] or digest(content) != expected['sha256']:
                raise BackupError('백업 손상을 발견했습니다. 복구하지 않습니다.')
        with tempfile.TemporaryDirectory(prefix='value-backup-check-') as temporary:
            snapshot = Path(temporary) / database_name
            snapshot.write_bytes(source.read(database))
            if check_database(snapshot) != manifest.get('counts'):
                raise BackupError('백업 DB의 항목 수가 기록과 다릅니다.')
            with closing(sqlite3.connect(snapshot)) as db:
                for relative, sha in document_files(db):
                    entry = entries.get('research/' + relative)
                    if not entry or entry['sha256'] != sha:
                        raise BackupError('백업에 원문 파일이 누락됐거나 DB 해시와 다릅니다.')
        return manifest


def create_backup(root=ROOT, directory=None, destination=None, automatic=False):
    root = root.resolve()
    config = settings(root)
    default_directory, database_name = research_path(root)
    directory = (directory or default_directory).resolve()
    destination = (destination or backup_path(root)).resolve()
    database = directory / database_name
    if not database.exists():
        if automatic:
            return None
        raise BackupError('백업할 관심종목 DB가 아직 없습니다. 빈 DB로 대체하지 않습니다.')
    checked_file(database, directory)
    if destination == directory or destination.is_relative_to(directory):
        raise BackupError('백업 경로는 원본 자료 폴더 밖이어야 합니다.')
    destination.mkdir(parents=True, exist_ok=True)
    warnings, entries = [], {}
    identifier = f'backup-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}-{uuid.uuid4().hex[:8]}'
    final = destination / f'{identifier}.zip'
    with tempfile.TemporaryDirectory(prefix='.backup-', dir=destination) as temporary:
        stage = Path(temporary)
        snapshot = stage / database_name
        archive = stage / 'snapshot.zip'
        with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as output:
            def add(name, content):
                if not allowed_member(name, database_name, config):
                    raise BackupError('백업 대상 목록에 허용되지 않은 파일이 있습니다.')
                if name in entries or len(entries) >= config['max_files'] or len(content) > config['max_file_bytes']:
                    raise BackupError('백업 파일 한도를 초과했습니다.')
                if sum(item['bytes'] for item in entries.values()) + len(content) > config['max_total_bytes']:
                    raise BackupError('백업 전체 크기 한도를 초과했습니다.')
                entries[name] = {'bytes': len(content), 'sha256': digest(content)}
                output.writestr(name, content)

            # Reserve writes while taking an online SQLite snapshot (includes WAL).
            # Use a separate reader: backing up a connection with its own write
            # transaction would deadlock. No source rows are changed here.
            with closing(sqlite3.connect(database.as_uri() + '?mode=rw', uri=True, timeout=config['sqlite_timeout_seconds'])) as guard:
                guard.execute('BEGIN IMMEDIATE')
                try:
                    active = [row[0] for row in guard.execute("SELECT code FROM research_jobs WHERE state IN ('queued','running')")]
                    deadline = time.monotonic() + config['snapshot_timeout_seconds']

                    def progress(_status, _remaining, _total):
                        if time.monotonic() > deadline:
                            raise BackupError('DB 백업 시간이 초과됐습니다. 수집 종료 후 다시 시도해 주세요.')

                    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as reader, closing(sqlite3.connect(snapshot)) as copy:
                        reader.backup(copy, pages=256, progress=progress)
                    counts = check_database(snapshot)
                    if counts.get('ai_pending'):
                        warnings.append('진행 중 AI 요청은 아직 결과가 없을 수 있습니다. 복구 후 자동 재전송하지 않으며 공급자 비용 발생 여부를 별도로 확인해야 합니다.')
                    add(f'research/{database_name}', snapshot.read_bytes())
                    for relative, sha in document_files(guard):
                        file = directory / relative
                        checked_file(file, directory)
                        if file.stat().st_size > config['max_file_bytes']:
                            raise BackupError('원문 파일 크기 한도를 초과했습니다.')
                        content = file.read_bytes()
                        if digest(content) != sha:
                            raise BackupError('원문 파일이 저장 해시와 다릅니다. 백업을 게시하지 않습니다.')
                        add('research/' + relative, content)
                    for file in sorted((directory / 'raw').rglob('*.json')):
                        relative = file.relative_to(directory).as_posix()
                        if len(file.relative_to(directory).parts) > 1 and file.relative_to(directory).parts[1] in active:
                            continue
                        checked_file(file, directory)
                        if file.stat().st_size > config['max_file_bytes']:
                            raise BackupError('원자료 파일 크기 한도를 초과했습니다.')
                        content = file.read_bytes()
                        json.loads(content)
                        add(f'research/{relative}', content)
                    if active:
                        warnings.append(f'수집 중인 {len(active)}개 종목은 DB에 저장된 중간 자료만 보관했습니다. 해당 종목의 원자료 캐시는 제외했으며 복구 후 재수집이 필요합니다.')
                finally:
                    guard.rollback()
            for item in config['context_paths']:
                base = root / item
                if not base.exists():
                    warnings.append(f'참고 파일 없음: {item}')
                    continue
                for file in sorted(base.rglob('*.json')) if base.is_dir() else [base]:
                    checked_file(file, root)
                    if file.stat().st_size > config['max_file_bytes']:
                        raise BackupError('참고 파일 크기 한도를 초과했습니다.')
                    content = file.read_bytes()
                    if file.suffix == '.json':
                        json.loads(content)
                    add('context/' + file.relative_to(root).as_posix(), content)
            manifest = {
                'format_version': config['format_version'], 'created_at': datetime.now(timezone.utc).isoformat(),
                'source_directory': str(directory), 'counts': counts, 'warnings': warnings,
                'scope': 'research store and reference context; no secrets, source code, or full-market caches',
                'files': entries,
            }
            output.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        verify_archive(archive, config, database_name)
        # Publish only after complete verification; older backups are never pruned.
        archive.rename(final)
    return final


def restore_backup(archive: Path, target: Path, root=ROOT):
    config = settings(root)
    active_directory, database_name = research_path(root)
    target = target.absolute()
    if target.exists() or target.is_symlink():
        raise BackupError('복구 대상은 존재하지 않는 새 폴더여야 합니다. 현재 자료를 덮어쓰지 않습니다.')
    if target.resolve().is_relative_to(active_directory) or active_directory.is_relative_to(target.resolve()):
        raise BackupError('사용 중인 자료 폴더에는 복구할 수 없습니다.')
    manifest = verify_archive(archive, config, database_name)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.restore-', dir=target.parent) as temporary:
        stage = Path(temporary)
        payload = stage / 'recovered'
        payload.mkdir()
        with zipfile.ZipFile(archive) as source:
            for name, expected in manifest['files'].items():
                file = payload / name
                if not file.resolve().is_relative_to(payload.resolve()):
                    raise BackupError('잘못된 복구 경로입니다.')
                content = source.read(name)
                if digest(content) != expected['sha256']:
                    raise BackupError('검증 후 백업 파일이 변경됐습니다.')
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(content)
        # Never revive PIDs or queued/running work from an old machine/session.
        with closing(sqlite3.connect(payload / 'research' / database_name)) as db:
            with db:
                reset_count = db.execute("UPDATE research_jobs SET state='error',pid=NULL,step='백업에서 복구한 작업입니다. 자료를 확인하고 재시도해 주세요.',error='복구 전 수집 작업은 자동 재개하지 않습니다.' WHERE state IN ('queued','running')").rowcount
                db.execute('UPDATE research_jobs SET pid=NULL')
                tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if 'thesis_ai_runs' in tables:
                    db.execute("UPDATE thesis_ai_runs SET state='error',completed_at=?,error_message='백업에서 복구한 미완료 AI 요청입니다. 자동 재전송하지 않았습니다. 비용 발생 여부는 공급자 사용량에서 확인해 주세요.' WHERE state='pending'", (datetime.now(timezone.utc).isoformat(),))
                    db.execute('UPDATE ai_request_attempts SET finished_at=? WHERE finished_at IS NULL', (int(time.time() * 1000),))
                if 'thesis_evidence_ai_runs' in tables and 'ai_request_attempts' in tables:
                    db.execute("UPDATE thesis_evidence_ai_runs SET state='error',completed_at=?,error_message='백업에서 복구한 미완료 AI 근거 검토입니다. 자동 재전송하지 않았습니다.' WHERE state='pending'", (datetime.now(timezone.utc).isoformat(),))
                    db.execute('UPDATE ai_request_attempts SET finished_at=? WHERE finished_at IS NULL', (int(time.time() * 1000),))
                if 'filing_documents' in tables:
                    db.execute("UPDATE filing_documents SET state='error',error='백업에서 복구한 미완료 원문 수집입니다. 자동 재개하지 않습니다.' WHERE state IN ('queued','running')")
        check_database(payload / 'research' / database_name)
        (payload / 'restore-info.json').write_text(json.dumps({'restored_at': datetime.now(timezone.utc).isoformat(), 'backup_created_at': manifest['created_at'], 'interrupted_jobs': reset_count, 'warnings': manifest['warnings']}, ensure_ascii=False, indent=2), encoding='utf-8')
        # mkdir(exist_ok=False) prevents races from overwriting a user directory.
        target.mkdir(exist_ok=False)
        try:
            for child in payload.iterdir():
                child.rename(target / child.name)
        except Exception:
            # Keep partial recovery visible for inspection; never touch active data.
            raise BackupError(f'복구가 완료되지 않았습니다. 새 폴더를 확인해 주세요: {target}')
    return target / 'research'


def main():
    parser = argparse.ArgumentParser(description='로컬 자료 백업·검증·새 폴더 복구 (현재 자료 덮어쓰기 없음)')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('create', help='검증된 백업 만들기')
    sub.add_parser('auto', help='시작 전 백업; 첫 실행의 DB 미생성 상태만 건너뜀')
    sub.add_parser('list', help='보관된 백업 목록과 손상 상태 확인')
    verify = sub.add_parser('verify', help='백업 파일 무결성 확인')
    verify.add_argument('archive', type=Path)
    restore = sub.add_parser('restore', help='새 폴더에 복구; 현재 DB는 바꾸지 않음')
    restore.add_argument('archive', type=Path)
    restore.add_argument('--to', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command in ('create', 'auto'):
            archive = create_backup(automatic=args.command == 'auto')
            if archive is None:
                print('관심종목 DB가 아직 없어 시작 전 백업을 건너뜁니다. 기존 DB를 만들거나 초기화하지 않습니다.')
            else:
                manifest = verify_archive(archive, database_name=research_path()[1])
                print(f'백업 완료: {archive}\n관심종목 {manifest["counts"]["registered"]}개 / 검토 기준 {manifest["counts"]["reviews"]}개')
                if 'theses' in manifest['counts']:
                    print(f'투자포인트 {manifest["counts"]["theses_retained"]}개(보관 포함) / 수정 기록 {manifest["counts"]["thesis_versions"]}개')
                for warning in manifest['warnings']:
                    print(f'주의: {warning}')
        elif args.command == 'list':
            files = sorted(backup_path().glob('backup-*.zip'), reverse=True)
            print(f'백업 폴더: {backup_path()}')
            if not files:
                print('저장된 백업이 없습니다.')
            for archive in files:
                try:
                    manifest = verify_archive(archive, database_name=research_path()[1])
                    print(f'{archive.name} | 검증 통과 | 관심 {manifest["counts"]["registered"]} / 검토 {manifest["counts"]["reviews"]} | 주의 {len(manifest["warnings"])}개')
                except (BackupError, OSError, ValueError, KeyError, TypeError, sqlite3.Error, zipfile.BadZipFile):
                    print(f'{archive.name} | 검증 실패 — 사용하지 마세요')
        elif args.command == 'verify':
            manifest = verify_archive(args.archive.resolve(), database_name=research_path()[1])
            print(f'검증 통과: {len(manifest["files"])}개 파일 / {manifest["created_at"]}')
            for warning in manifest['warnings']:
                print(f'주의: {warning}')
        else:
            restored = restore_backup(args.archive.resolve(), args.to)
            print(f'새 폴더 복구 완료: {restored}\n현재 사용 중인 DB는 변경하지 않았습니다. 서버를 종료한 후 .env.local의 RESEARCH_STORAGE_DIR에 위 경로를 설정하고 다시 시작하세요.\ncontext 폴더의 Radar·시장 스냅샷·설정은 참고 사본이며 자동 적용되지 않습니다.')
        return 0
    except (BackupError, OSError, ValueError, KeyError, TypeError, sqlite3.Error, zipfile.BadZipFile) as error:
        print(f'백업/복구 실패: {error if isinstance(error, BackupError) else type(error).__name__}. 원본 자료는 유지됩니다.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
