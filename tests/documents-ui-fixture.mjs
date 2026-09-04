// Serve an existing isolated live-check fixture, never the active user store.
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const directory = realpathSync(process.env.DOCUMENT_FIXTURE_DIR);
assert.equal(path.dirname(directory), realpathSync(tmpdir()));
assert.ok(path.basename(directory).startsWith('value-documents-live-'));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'start',
    '--hostname',
    'localhost',
    '--port',
    String(port),
  ],
  {
    windowsHide: true,
    env: {
      ...process.env,
      RESEARCH_STORAGE_DIR: directory,
      OPENAI_API_KEY: '',
      DART_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
child.stdout.on('data', (b) => {
  if (b.toString().includes('Ready'))
    console.log(
      `DOCUMENT_UI_URL=http://localhost:${port}/stocks/043260?tab=documents`,
    );
});
child.stderr.on('data', (b) => process.stderr.write(b));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
await once(child, 'exit');
