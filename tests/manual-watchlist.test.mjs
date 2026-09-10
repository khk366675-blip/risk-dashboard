import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findListedStock, parseListedStocks, searchListedStocks } from '../lib/server/listing-store.ts';
import {
  manualCandidate,
  manualPreview,
  readRadar,
} from '../lib/server/research-service.ts';
import { ResearchStore } from '../lib/server/research-store.ts';

test('listing accepts BOM before Code and the legacy unnamed index column', () => {
  for (const bom of ['', '\uFEFF']) {
    for (const legacyIndex of [false, true]) {
      const header = `${legacyIndex ? ',' : ''}Code,Name,Market,Close,Marcap,Industry`;
      const row = `${legacyIndex ? '0,' : ''}005930,삼성전자,KOSPI,100,1000,"전자, 반도체"`;
      const [stock] = parseListedStocks(`${bom}${header}\r\n${row}\r\n`);
      assert.equal(stock.code, '005930');
      assert.equal(stock.name, '삼성전자');
      assert.equal(stock.industry, '전자, 반도체');
      assert.equal(stock.latest_price, 100);
    }
  }
});

test('listing still rejects missing required columns and preserves unknown values', () => {
  assert.throws(() => parseListedStocks('\uFEFFName,Market\n삼성전자,KOSPI'), /목록 형식/);
  const [stock] = parseListedStocks('\uFEFF"Code",Name,Market,Close,Marcap\n005930,삼성전자,KOSPI,,');
  assert.equal(stock.latest_price, null);
  assert.equal(stock.market_cap_krw, null);
});

test('listing search resolves an exact code and Korean company name', () => {
  const samsung = findListedStock('005930');
  assert.equal(samsung?.name, '삼성전자');
  assert.equal(searchListedStocks('005930')[0]?.code, '005930');
  assert.equal(searchListedStocks('삼성전자')[0]?.code, '005930');
  assert.equal(searchListedStocks('SK하이닉스')[0]?.code, '000660');
});

test('manual registration is traceable and does not fabricate a Radar match', async (t) => {
  const listing = findListedStock('005930');
  assert.ok(listing);
  const radar = await readRadar();
  const candidate = manualCandidate(listing, radar);
  const preview = manualPreview(listing, radar);
  assert.equal(candidate.discovery, 'manual');
  assert.deepEqual(candidate.matched_lenses, []);
  assert.equal(candidate.lenses.quality.matched, false);
  assert.equal(preview.radar.discovery, 'manual');
  assert.equal(preview.data_level, 'preview');
  assert.match(preview.warnings[0], /직접 추가/);

  const directory = mkdtempSync(path.join(tmpdir(), 'manual-watchlist-test-'));
  const store = new ResearchStore(directory);
  t.after(() => {
    store.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('manual-watchlist-test-'));
    rmSync(resolved, { recursive: true });
  });
  const registered = store.register(candidate, radar, preview);
  assert.ok(registered.jobId);
  assert.equal(store.list()[0].code, '005930');
  assert.equal(store.get('005930').stock.radar.discovery, 'manual');
});
