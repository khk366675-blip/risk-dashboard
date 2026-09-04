import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import {
  emptyThesis,
  validateThesisContent,
  thesisConfig,
} from '../lib/investment-thesis.ts';
const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];
const stock = JSON.parse(
  readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
);
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-thesis-test-'));
  const owner = new ResearchStore(directory);
  owner.register(candidate, radar, stock);
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('value-thesis-test-'));
    rmSync(resolved, { recursive: true });
  });
  return { owner, store: new ThesisStore(owner.db), directory };
}
const content = () => ({
  ...emptyThesis(),
  body: '  증설 이후 변화가 있는지\n직접 확인한다.  ',
  checks: [{ id: randomUUID(), text: '가동 시점을 원문에서 확인' }],
});
test('editing a thesis does not alter source-review revision or confirmation state', (t) => {
  const { owner, store } = fixture(t);
  const before = owner.followup(candidate.code);
  const point = store.create(candidate.code, randomUUID(), content());
  store.update(candidate.code, point.id, point.revision, {
    content: { ...point.content, body: '수정한 개인 가설' },
  });
  assert.equal(owner.followup(candidate.code).revision, before.revision);
  assert.equal(owner.reviewBaseline(candidate.code), null);
});
test('user text and manual checks persist across restart and never modify collected data', (t) => {
  const { owner, store, directory } = fixture(t);
  const value = content();
  const item = store.create(candidate.code, randomUUID(), value);
  const reopened = new ResearchStore(directory);
  try {
    assert.deepEqual(
      new ThesisStore(reopened.db).list(candidate.code)[0].content,
      value,
    );
  } finally {
    reopened.close();
  }
  assert.deepEqual(owner.get(candidate.code).stock, stock);
  assert.equal(owner.get(candidate.code).item.thesis.count, 1);
  assert.equal(owner.reviewBaseline(candidate.code), null);
  assert.equal(item.revision, 1);
});
test('request id deduplicates create retries and rejects different payload or stock', (t) => {
  const { store, owner } = fixture(t);
  const value = content();
  const id = randomUUID();
  store.create(candidate.code, id, value);
  store.create(candidate.code, id, value);
  assert.equal(store.list(candidate.code).length, 1);
  assert.throws(
    () => store.create(candidate.code, id, { ...value, body: 'different' }),
    { status: 409 },
  );
  const other = { ...candidate, code: '000001' };
  owner.register(other, radar, { ...stock, code: other.code });
  assert.throws(() => store.create(other.code, id, value), { status: 409 });
});
test('point and check edits are atomic immutable versions; stale tab cannot overwrite', (t) => {
  const { store, owner, directory } = fixture(t);
  const item = store.create(candidate.code, randomUUID(), content());
  const edited = { ...item.content, body: '새로 수정한 가설', checks: [] };
  const changed = store.update(candidate.code, item.id, 1, { content: edited });
  assert.equal(changed.revision, 2);
  const reopened = new ResearchStore(directory);
  try {
    assert.throws(
      () =>
        new ThesisStore(reopened.db).update(candidate.code, item.id, 1, {
          content: item.content,
        }),
      { status: 409 },
    );
  } finally {
    reopened.close();
  }
  const versions = owner.db
    .prepare(
      'SELECT content_json FROM investment_thesis_revisions WHERE thesis_id=? ORDER BY revision',
    )
    .all(item.id);
  assert.equal(versions.length, 2);
  assert.deepEqual(JSON.parse(versions[0].content_json), item.content);
  assert.deepEqual(store.list(candidate.code)[0].content, edited);
});
test('archive, restore, source refresh, removal and re-registration retain original writing', (t) => {
  const { store, owner } = fixture(t);
  const item = store.create(candidate.code, randomUUID(), content());
  const archived = store.update(candidate.code, item.id, 1, { archived: true });
  assert.equal(store.summary(candidate.code).count, 0);
  assert.throws(
    () => store.update(candidate.code, item.id, 2, { content: item.content }),
    { status: 409 },
  );
  const restored = store.update(candidate.code, item.id, archived.revision, {
    archived: false,
  });
  owner.db
    .prepare('UPDATE watchlist SET detail_json=? WHERE code=?')
    .run(JSON.stringify({ ...stock, generated_at: 'new' }), candidate.code);
  owner.remove(candidate.code);
  assert.throws(() => store.create(candidate.code, randomUUID(), content()), {
    status: 409,
  });
  const request = {
    id: randomUUID(),
    reason: 'must not replace existing thesis',
  };
  owner.register(candidate, radar, stock, request);
  owner.register(candidate, radar, stock, request);
  assert.deepEqual(
    store.list(candidate.code).find((point) => point.id === restored.id),
    restored,
  );
  assert.equal(store.list(candidate.code).length, 2);
  assert.equal(
    store.list(candidate.code).find((point) => point.id === request.id).content
      .body,
    request.reason,
  );
});
test('registration and first reason commit together, invalid input rolls back registration', (t) => {
  const { owner, store } = fixture(t);
  const other = { ...candidate, code: '000003' };
  assert.throws(() =>
    owner.register(
      other,
      radar,
      { ...stock, code: other.code },
      { id: randomUUID(), reason: 'x'.repeat(thesisConfig.max_body_chars + 1) },
    ),
  );
  assert.equal(owner.get(other.code), null);
  const request = { id: randomUUID(), reason: '사용자가 처음 적은 이유' };
  owner.register(other, radar, { ...stock, code: other.code }, request);
  owner.register(other, radar, stock, request);
  assert.equal(store.list(other.code).length, 1);
  assert.equal(store.list(other.code)[0].content.body, request.reason);
});
test('input validation rejects blank, oversized, malformed and unsafe links without truncation', () => {
  for (const change of [
    { body: '' },
    { body: 'x'.repeat(thesisConfig.max_body_chars + 1) },
    { title: 'x'.repeat(81) },
    { source_url: 'javascript:alert(1)' },
    { source_url: 'https://user:password@example.com' },
    { checks: [{ id: randomUUID(), text: '' }] },
    { checks: [{ id: 'invalid', text: 'question' }] },
    { unexpected: 'value' },
  ])
    assert.throws(() => validateThesisContent({ ...content(), ...change }));
  const duplicate = { id: randomUUID(), text: '질문' };
  assert.throws(() =>
    validateThesisContent({ ...content(), checks: [duplicate, duplicate] }),
  );
  const value = { ...content(), source_url: ' https://dart.fss.or.kr/ ' };
  assert.deepEqual(validateThesisContent(value), value);
});
test('active cap applies to creation and restoration; archiving frees capacity', (t) => {
  const { store } = fixture(t);
  const entries = Array.from({ length: thesisConfig.max_active_points }, () =>
    store.create(candidate.code, randomUUID(), content()),
  );
  assert.throws(() => store.create(candidate.code, randomUUID(), content()), {
    status: 409,
  });
  store.update(candidate.code, entries[0].id, 1, { archived: true });
  store.create(candidate.code, randomUUID(), content());
  assert.throws(
    () => store.update(candidate.code, entries[0].id, 2, { archived: false }),
    { status: 409 },
  );
});
test('legacy database gets additive schema; corrupt user content is never silently reset', (t) => {
  const { owner, directory, store } = fixture(t);
  owner.db.exec(
    'DROP TABLE investment_thesis_revisions; DROP TABLE investment_theses;',
  );
  const reopened = new ResearchStore(directory);
  reopened.close();
  const item = store.create(candidate.code, randomUUID(), content());
  owner.db
    .prepare("UPDATE investment_theses SET content_json='{}' WHERE id=?")
    .run(item.id);
  assert.throws(() => store.list(candidate.code));
  assert.throws(() => owner.get(candidate.code));
  assert.equal(
    owner.db
      .prepare('SELECT content_json FROM investment_theses WHERE id=?')
      .get(item.id).content_json,
    '{}',
  );
});
