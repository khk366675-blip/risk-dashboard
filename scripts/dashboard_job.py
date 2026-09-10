"""Detached collector supervisor; progress survives web navigation/restarts."""
import argparse
import json
import os
from pathlib import Path
import queue
import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from radar_pipeline import config
SETTINGS=json.loads((config.ROOT/'research/operations-config.json').read_text(encoding='utf-8'))
def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--id',required=True)
    parser.add_argument('--kind',choices=('markets','radar'),required=True)
    args=parser.parse_args()
    directory=Path(os.environ.get('RESEARCH_STORAGE_DIR') or config.ROOT/'data/research')
    db=sqlite3.connect(directory/'watchlist.sqlite',timeout=5)
    with db:
        claimed=db.execute("UPDATE dashboard_jobs SET state='running',pid=?,updated_at=? WHERE id=? AND kind=? AND state='queued'",(os.getpid(),stamp(),args.id,args.kind)).rowcount
    if not claimed: db.close();return 1
    child=None
    try:
        command=[sys.executable,'-m','scripts.collect_markets' if args.kind=='markets' else 'scripts.run_full_market_radar']
        if args.kind=='radar':
            for candidate in (os.environ.get('RADAR_ENV_FILE'),'.env.local','.env','../ai-invest/.env'):
                if candidate and Path(candidate).is_file():
                    command+=['--env-file',str(Path(candidate).resolve())];break
        child=subprocess.Popen(command,cwd=config.ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        lines=queue.Queue()
        def consume():
            for line in child.stdout: lines.put(line.strip())
        threading.Thread(target=consume,daemon=True).start()
        start=time.monotonic();step='외부 자료 수집 중'
        while child.poll() is None:
            if time.monotonic()-start>SETTINGS['timeout_seconds'][args.kind]:
                child.kill();child.wait();raise TimeoutError('수집 제한 시간을 초과했습니다. 기존 결과는 유지됩니다.')
            while not lines.empty(): step=lines.get()[-500:] or step
            with db:
                updated=db.execute("UPDATE dashboard_jobs SET step=?,updated_at=? WHERE id=? AND state='running'",(step,stamp(),args.id)).rowcount
            if not updated: child.kill();child.wait();return 1
            time.sleep(SETTINGS['heartbeat_seconds'])
        if child.returncode:
            while not lines.empty(): step=lines.get()[-500:] or step
            raise RuntimeError(step)
        result=json.loads((config.PUBLIC_MARKET_PATH if args.kind=='markets' else config.PUBLIC_RADAR_PATH).read_text(encoding='utf-8'))
        if result.get('status') not in ('ok','partial'):raise RuntimeError('수집 결과 상태를 확인하지 못했습니다. 기존 자료의 기준일을 확인해 주세요.')
        state='partial' if result.get('status')=='partial' else 'completed'
        with db:
            db.execute("UPDATE dashboard_jobs SET state=?,step=?,finished_at=?,updated_at=? WHERE id=? AND state='running'",(state,'일부 자료 확인 필요' if state=='partial' else '새 결과 반영 완료',stamp(),stamp(),args.id))
        return 0
    except Exception as error:
        with db: db.execute("UPDATE dashboard_jobs SET state='error',step='수집 실패',error=?,finished_at=?,updated_at=? WHERE id=? AND state='running'",(str(error)[-1000:],stamp(),stamp(),args.id))
        return 1
    finally:
        if child and child.poll() is None: child.kill();child.wait()
        db.close()
if __name__=='__main__': raise SystemExit(main())
