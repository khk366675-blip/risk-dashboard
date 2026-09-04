import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Use the same local environment selection as Next; never print its contents.
require('@next/env').loadEnvConfig(root, process.env.NODE_ENV !== 'production');
const bundled = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.RADAR_PYTHON_EXECUTABLE || (existsSync(bundled) ? bundled : process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['-m', 'scripts.local_backup', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
});
if (result.error) console.error('백업 도구를 시작하지 못했습니다. 로컬 Python 설치와 RADAR_PYTHON_EXECUTABLE 설정을 확인해 주세요.');
process.exit(result.status ?? 1);
