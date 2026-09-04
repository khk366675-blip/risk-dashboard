import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import type { RadarRun } from '@/lib/radar-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel validates every discovered route even though mobile mode blocks this
// local-only endpoint. Keep the declaration within the Hobby deployment limit.
export const maxDuration = 300;

const projectRoot = process.cwd();
const radarPath = path.join(
  projectRoot,
  'public',
  'data',
  'radar',
  'latest.json',
);

let activeRefresh: Promise<RadarRun> | null = null;

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next configured local path.
    }
  }
  return null;
}

async function pythonExecutable(): Promise<string> {
  if (process.env.RADAR_PYTHON_EXECUTABLE)
    return process.env.RADAR_PYTHON_EXECUTABLE;
  const bundled =
    process.platform === 'win32'
      ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, '.venv', 'bin', 'python');
  return (
    (await firstExisting([bundled])) ??
    (process.platform === 'win32' ? 'python' : 'python3')
  );
}

async function radarEnvironmentFile(): Promise<string | null> {
  if (process.env.RADAR_ENV_FILE) return process.env.RADAR_ENV_FILE;
  return firstExisting([
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env'),
    path.resolve(projectRoot, '..', 'ai-invest', '.env'),
  ]);
}

async function runRadar(): Promise<RadarRun> {
  const python = await pythonExecutable();
  const environmentFile = await radarEnvironmentFile();
  const args = ['-m', 'scripts.run_full_market_radar'];
  if (environmentFile) args.push('--env-file', environmentFile);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ python, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      windowsHide: true,
    });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Radar 전체시장 실행 시간이 30분을 초과했습니다.'));
    }, 1_800_000);

    child.stdout.on('data', (chunk) => {
      output = `${output}${String(chunk)}`.slice(-12_000);
    });
    child.stderr.on('data', (chunk) => {
      errorOutput = `${errorOutput}${String(chunk)}`.slice(-12_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const detail = (errorOutput.trim() || output.trim())
          .split(/\r?\n/)
          .slice(-12)
          .join('\n');
        reject(
          new Error(detail || `Radar 수집기가 종료 코드 ${code}로 끝났습니다.`),
        );
      }
    });
  });

  return JSON.parse(await readFile(radarPath, 'utf8')) as RadarRun;
}

export async function POST() {
  try {
    activeRefresh ??= runRadar().finally(() => {
      activeRefresh = null;
    });
    const radar = await activeRefresh;
    return NextResponse.json(
      { ok: true, radar },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : '알 수 없는 Radar 실행 오류';
    return NextResponse.json(
      { ok: false, error: 'Radar 전체시장 실행에 실패했습니다.', detail },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
