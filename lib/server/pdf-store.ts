import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { localStore, researchDirectory } from './research-store.ts';
import { operationsConfig } from './dashboard-jobs.ts';
import { ThesisError } from '../investment-thesis.ts';
export async function uploadPdf(
  code: string,
  title: string,
  bytes: Uint8Array,
) {
  if (
    !title.trim() ||
    title.length > 140 ||
    bytes.length > operationsConfig.pdf_max_bytes ||
    Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-'
  )
    throw new ThesisError('25MB 이하의 PDF와 자료 제목을 확인해 주세요.');
  const store = localStore(),
    hash = createHash('sha256').update(bytes).digest('hex');
  try {
    if (!store.get(code)?.item.active)
      throw new ThesisError('관심종목 등록이 필요합니다.', 409);
    const existing = store.db
      .prepare('SELECT * FROM pdf_documents WHERE code=? AND sha256=?')
      .get(code, hash);
    if (existing) return existing;
    const directory = path.join(researchDirectory, 'attachments');
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `${randomUUID()}.upload`);
    await writeFile(temporary, bytes, { flag: 'wx' });
    let pages: number;
    try {
      const python =
        process.env.PDF_PYTHON_EXECUTABLE ||
        process.env.RADAR_PYTHON_EXECUTABLE ||
        path.join(
          process.cwd(),
          '.venv',
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
        );
      const result = await promisify(execFile)(
        python,
        ['-m', 'scripts.inspect_pdf', temporary],
        {
          cwd: process.cwd(),
          windowsHide: true,
          timeout: 25000,
          encoding: 'utf8',
        },
      );
      pages = JSON.parse(result.stdout).pages;
      if (
        !Number.isSafeInteger(pages) ||
        pages < 1 ||
        pages > operationsConfig.pdf_max_pages
      )
        throw new Error('pages');
    } catch {
      throw new ThesisError(
        'PDF를 읽지 못했습니다. 암호화·손상 여부 또는 PDF 실행 환경을 확인해 주세요.',
      );
    } finally {
      await unlink(temporary);
    }
    const relative = `attachments/${hash}.pdf`;
    await writeFile(path.join(researchDirectory, relative), bytes, {
      flag: 'wx',
    }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const id = randomUUID();
    store.db
      .prepare(
        'INSERT INTO pdf_documents(id,code,title,sha256,path,page_count,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(code,sha256) DO NOTHING',
      )
      .run(
        id,
        code,
        title.trim(),
        hash,
        relative,
        pages,
        new Date().toISOString(),
      );
    return store.db
      .prepare('SELECT * FROM pdf_documents WHERE code=? AND sha256=?')
      .get(code, hash)!;
  } finally {
    store.close();
  }
}
export async function pdfBytes(code: string, id: string) {
  const store = localStore();
  try {
    const row = store.db
      .prepare(
        'SELECT * FROM pdf_documents WHERE code=? AND id=? AND archived_at IS NULL',
      )
      .get(code, id);
    if (!row) throw new ThesisError('PDF를 찾지 못했습니다.', 404);
    if (
      row.path !== `attachments/${String(row.sha256)}.pdf` ||
      !/^[a-f0-9]{64}$/.test(String(row.sha256))
    )
      throw new Error('Invalid PDF path');
    const bytes = await readFile(
      path.join(researchDirectory, String(row.path)),
    );
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
      throw new ThesisError('PDF 파일이 저장본과 다릅니다.', 409);
    return bytes;
  } finally {
    store.close();
  }
}
