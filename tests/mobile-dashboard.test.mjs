import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalMobileSnapshot } from '../lib/server/local-mobile-snapshot.ts';
import {
  createMobileSession,
  verifyMobileSession,
} from '../lib/mobile-session-token.ts';

test('mobile session token is signed and rejects mutation', () => {
  const secret = 'test-secret-that-is-not-used-outside-this-test';
  const token = createMobileSession(secret);
  assert.equal(verifyMobileSession(token, secret), true);
  assert.equal(verifyMobileSession(`${token}x`, secret), false);
  assert.equal(verifyMobileSession(token, `${secret}-wrong`), false);
});

test('local mobile snapshot is compact and excludes local paths', () => {
  const snapshot = buildLocalMobileSnapshot();
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.schema_version, 'mobile-dashboard.v2');
  assert.ok(snapshot.generated_at);
  assert.ok(snapshot.market.assets.length > 0);
  assert.ok(
    snapshot.market.assets.every(
      (asset) => Array.isArray(asset.sparkline) && asset.sparkline.length <= 60,
    ),
  );
  assert.equal(
    snapshot.radar.candidates.length,
    snapshot.radar.candidate_count,
  );
  assert.ok(snapshot.stocks.every((stock) => /^\d{6}$/.test(stock.code)));
  assert.doesNotMatch(serialized, /[A-Z]:\\/i);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY|DART_API_KEY|SUPABASE_/);
  assert.ok(Buffer.byteLength(serialized) < 2_000_000);
});
