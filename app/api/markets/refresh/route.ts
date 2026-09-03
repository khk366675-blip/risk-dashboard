import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import type { MarketSnapshot } from '@/lib/market-snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const projectRoot = process.cwd();
const snapshotPath = path.join(
  projectRoot,
  'public',
  'data',
  'markets',
  'latest.json',
);

let activeRefresh: Promise<MarketSnapshot> | null = null;

async function localPython(): Promise<string> {
  if (process.env.MARKET_PYTHON_EXECUTABLE)
    return process.env.MARKET_PYTHON_EXECUTABLE;

  const bundled =
    process.platform === 'win32'
      ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, '.venv', 'bin', 'python');
  try {
    await access(bundled);
    return bundled;
  } catch {
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

async function runCollector(): Promise<MarketSnapshot> {
  const python = await localPython();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      /* turbopackIgnore: true */ python,
      ['-m', 'scripts.collect_markets'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        windowsHide: true,
      },
    );
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('시장 데이터 수집 시간이 5분을 초과했습니다.'));
    }, 300_000);

    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errorOutput += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            errorOutput.trim() ||
              output.trim() ||
              `수집기가 종료 코드 ${code}로 끝났습니다.`,
          ),
        );
    });
  });

  return JSON.parse(await readFile(snapshotPath, 'utf8')) as MarketSnapshot;
}

export async function POST() {
  try {
    activeRefresh ??= runCollector().finally(() => {
      activeRefresh = null;
    });
    const snapshot = await activeRefresh;
    return NextResponse.json(
      { ok: true, snapshot },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : '알 수 없는 수집 오류';
    return NextResponse.json(
      { ok: false, error: '시장 데이터를 최신화하지 못했습니다.', detail },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
