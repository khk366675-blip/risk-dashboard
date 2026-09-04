"""One explicit DART receipt per local job. No AI, no user-writing access."""
from __future__ import annotations
import argparse
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
import requests
from dotenv import load_dotenv
from research.documents import CONFIG, ROOT, DocumentError, digest, parse_archive

SETTINGS = json.loads((ROOT/'research/config.json').read_text(encoding='utf-8'))


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')


def download(receipt, key):
    if not key:
        raise DocumentError('DART API 키가 없습니다. 기존 수집 환경의 DART_API_KEY 설정을 확인해 주세요.')
    started = time.monotonic()
    try:
        with requests.get(CONFIG['endpoint'], params={'crtfc_key':key,'rcept_no':receipt}, timeout=CONFIG['timeout_seconds'],
                          stream=True, allow_redirects=False) as response:
            if response.status_code != 200:
                raise DocumentError(f'DART 원문 요청 실패 (HTTP {response.status_code})')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > CONFIG['max_archive_bytes'] or time.monotonic()-started > CONFIG['timeout_seconds']:
                    raise DocumentError('DART 원문 크기 또는 수집 시간 한도 초과')
                chunks.append(chunk)
            return b''.join(chunks)
    except requests.RequestException:
        raise DocumentError('DART 원문 연결에 실패했습니다. 기존 저장본은 유지했습니다.') from None


def immutable_file(directory, relative, content):
    file = directory/relative
    file.parent.mkdir(parents=True,exist_ok=True)
    if file.exists():
        if file.read_bytes() != content:
            raise DocumentError('기존 원문 파일 무결성이 다릅니다. 덮어쓰지 않았습니다.')
        return
    with file.open('xb') as output:
        output.write(content)


def collect(directory:Path, code:str, receipt:str, job_id:str, fetcher=download):
    db=sqlite3.connect(directory/SETTINGS['database_name'],timeout=5)
    db.row_factory=sqlite3.Row
    try:
        with db:
            claimed=db.execute("UPDATE filing_documents SET state='running' WHERE code=? AND receipt=? AND job_id=? AND state='queued' AND EXISTS(SELECT 1 FROM watchlist WHERE code=? AND active=1)", (code,receipt,job_id,code)).rowcount
        if not claimed:
            return
        try:
            raw=fetcher(receipt,os.getenv('DART_API_KEY',''))
            # A provider XML error is not a source-document version.
            if not raw.startswith(b'PK'):
                parse_archive(raw,receipt)
            archive_hash=digest(raw)
            version=digest((archive_hash+CONFIG['parser_version']).encode())
            folder=f"{CONFIG['directory']}/{code}/{receipt}"
            archive_path=f'{folder}/{archive_hash}.zip'
            extracted_path=extracted_hash=None
            try:
                data=parse_archive(raw,receipt)
                encoded=json.dumps(data,ensure_ascii=False,allow_nan=False).encode('utf-8')
                extracted_hash=digest(encoded)
                extracted_path=f'{folder}/{extracted_hash}.json'
                metadata={k:v for k,v in data.items() if k not in ('blocks','sections')}
                state,error=data['status'],None
            except DocumentError as exc:
                metadata={'warnings':[str(exc)],'status':'unsupported'}
                state,error='unsupported',str(exc)
            # A short write transaction keeps versions/files consistent with backup snapshots.
            with db:
                db.execute('BEGIN IMMEDIATE')
                active=db.execute("SELECT 1 FROM filing_documents WHERE code=? AND receipt=? AND job_id=? AND state='running'",(code,receipt,job_id)).fetchone()
                if not active:
                    return
                immutable_file(directory,archive_path,raw)
                if extracted_path:
                    immutable_file(directory,extracted_path,encoded)
                db.execute('INSERT OR IGNORE INTO filing_document_versions VALUES(?,?,?,?,?,?,?,?,?,?)',
                           (code,receipt,version,archive_hash,extracted_hash,archive_path,extracted_path,CONFIG['parser_version'],now(),json.dumps(metadata,ensure_ascii=False)))
                # Failed new extraction never hides the previous usable extraction.
                db.execute("UPDATE filing_documents SET state=?,checked_at=?,error=?,current_version=CASE WHEN ? IS NOT NULL THEN ? ELSE current_version END WHERE code=? AND receipt=? AND job_id=?",
                           (state,now(),error,extracted_path,version,code,receipt,job_id))
        except Exception as exc:
            error=str(exc) if isinstance(exc,DocumentError) else '원문 수집·저장 처리에 실패했습니다. 기존 자료는 유지했습니다.'
            with db:
                db.execute("UPDATE filing_documents SET state='error',error=? WHERE code=? AND receipt=? AND job_id=? AND state='running'",(error,code,receipt,job_id))
    finally:
        db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--code',required=True)
    parser.add_argument('--receipt',required=True)
    parser.add_argument('--job-id',required=True)
    parser.add_argument('--env-file')
    args=parser.parse_args()
    if args.env_file:
        load_dotenv(args.env_file,override=False)
    collect(Path(os.getenv('RESEARCH_STORAGE_DIR',str(ROOT/SETTINGS['storage_dir']))),args.code,args.receipt,args.job_id)
