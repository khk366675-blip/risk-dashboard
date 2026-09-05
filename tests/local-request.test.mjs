import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalDashboardRequest } from '../lib/server/local-request.ts';

const req = (
  host,
  origin,
  extras = {},
  url = 'http://localhost:3000/api/test',
) =>
  new Request(url, {
    headers: {
      ...(host === null ? {} : { host }),
      ...(origin === null ? {} : { origin }),
      ...extras,
    },
  });

test('local browser Host survives Next bind-host normalization, including IPv6', () => {
  for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
    assert.equal(
      isLocalDashboardRequest(req(host, `http://${host}`), true, false),
      true,
    );
  }
  assert.equal(
    isLocalDashboardRequest(req(null, 'http://localhost:3000'), true, false),
    true,
  );
});

test('local writes still require exact browser origin and port', () => {
  for (const origin of [
    null,
    'null',
    'http://evil.test',
    'http://localhost:3001',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
  ]) {
    assert.equal(
      isLocalDashboardRequest(req('localhost:3000', origin), true, false),
      false,
    );
  }
  for (const host of [
    'evil.test:3000',
    'localhost.evil.test:3000',
    'localhost:3001',
    'user@localhost:3000',
    'localhost:3000/path',
    'localhost:3000,evil.test',
    '0.0.0.0:3000',
  ]) {
    assert.equal(
      isLocalDashboardRequest(req(host, `http://${host}`), true, false),
      false,
    );
  }
});

test('external/deployed/cross-site requests and forwarded-host spoofing stay blocked', () => {
  assert.equal(
    isLocalDashboardRequest(
      req('localhost:3000', 'http://localhost:3000'),
      true,
      true,
    ),
    false,
  );
  assert.equal(
    isLocalDashboardRequest(
      req('localhost:3000', 'http://localhost:3000', {
        'sec-fetch-site': 'cross-site',
      }),
      true,
      false,
    ),
    false,
  );
  assert.equal(
    isLocalDashboardRequest(
      req('evil.test:3000', 'http://localhost:3000', {
        'x-forwarded-host': 'localhost:3000',
      }),
      true,
      false,
    ),
    false,
  );
  assert.equal(
    isLocalDashboardRequest(
      req(
        'localhost:3000',
        'http://localhost:3000',
        {},
        'http://evil.test:3000/api',
      ),
      true,
      false,
    ),
    false,
  );
  assert.equal(
    isLocalDashboardRequest(req('localhost:3000', null), false, false),
    true,
  );
});
