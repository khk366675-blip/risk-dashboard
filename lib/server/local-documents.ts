import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { localStore, researchDirectory } from './research-store';
import { DocumentStore } from './document-store';

export function withDocuments<T>(work: (store: DocumentStore) => T): T {
  const owner = localStore();
  try {
    return work(new DocumentStore(owner.db, researchDirectory));
  } finally {
    owner.close();
  }
}
export async function startDocumentWorker(
  code: string,
  receipt: string,
  id: string,
) {
  const python =
    process.env.RADAR_PYTHON_EXECUTABLE ||
    path.join(
      process.cwd(),
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  const args = [
    '-m',
    'scripts.collect_filing_document',
    '--code',
    code,
    '--receipt',
    receipt,
    '--job-id',
    id,
  ];
  // Same explicit configuration search as the existing watchlist collector.
  for (const file of [
    process.env.RADAR_ENV_FILE,
    '.env.local',
    '.env',
    '../ai-invest/.env',
  ]) {
    if (!file) continue;
    try {
      const resolved = path.resolve(/* turbopackIgnore: true */ file);
      await access(resolved);
      args.push('--env-file', resolved);
      break;
    } catch {
      /* next existing config */
    }
  }
  const fail = () => {
    try {
      withDocuments((store) => store.fail(code, receipt, id));
    } catch {
      /* timeout state remains visible */
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ python, args, {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          RESEARCH_STORAGE_DIR: researchDirectory,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      });
      child.once('error', reject);
      child.once('exit', (status) => {
        if (status !== 0) fail();
      });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  } catch {
    fail();
  }
}
