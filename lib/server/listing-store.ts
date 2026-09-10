import { readFileSync } from 'node:fs';
import path from 'node:path';
import { researchConfig } from './research-store.ts';

export type ListedStock = {
  code: string;
  name: string;
  market: string;
  sector: string;
  industry: string | null;
  listing_date: string | null;
  latest_price: number | null;
  market_cap_krw: number | null;
};

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function numberOrNull(value: string | undefined) {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) ? parsed : null;
}

export function listedStocks(): ListedStock[] {
  const file = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    researchConfig.listing_path,
  );
  return parseListedStocks(readFileSync(file, 'utf8'));
}

export function parseListedStocks(text: string): ListedStock[] {
  // Python exports utf-8-sig for Korean CSV/Excel compatibility. The BOM is
  // encoding metadata, not part of the first column name (which may be Code).
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const header = rows.shift();
  if (!header) throw new Error('상장종목 목록이 비어 있습니다.');
  const index = Object.fromEntries(header.map((key, value) => [key.trim(), value]));
  for (const required of ['Code', 'Name', 'Market'])
    if (index[required] === undefined)
      throw new Error('상장종목 목록 형식을 확인해 주세요.');
  return rows.flatMap((row) => {
    const code = row[index.Code]?.trim().padStart(6, '0');
    const name = row[index.Name]?.trim();
    const market = row[index.Market]?.trim();
    if (!/^\d{6}$/.test(code) || !name || !market) return [];
    return [
      {
        code,
        name,
        market,
        sector:
          row[index.Sector]?.trim() ||
          row[index.Dept]?.trim() ||
          '업종 미수집',
        industry: row[index.Industry]?.trim() || null,
        listing_date: row[index.ListingDate]?.trim() || null,
        latest_price: numberOrNull(row[index.Close]),
        market_cap_krw: numberOrNull(row[index.Marcap]),
      },
    ];
  });
}

export function findListedStock(code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  return listedStocks().find((stock) => stock.code === code) ?? null;
}

export function searchListedStocks(query: string) {
  const normalized = query.trim().toLocaleLowerCase('ko-KR');
  const digits = normalized.replace(/\D/g, '');
  if (!normalized) return [];
  return listedStocks()
    .filter(
      (stock) =>
        (digits.length > 0 && stock.code.includes(digits)) ||
        stock.name.toLocaleLowerCase('ko-KR').includes(normalized),
    )
    .sort((a, b) => {
      const exactA =
        a.code === normalized || a.name.toLocaleLowerCase('ko-KR') === normalized;
      const exactB =
        b.code === normalized || b.name.toLocaleLowerCase('ko-KR') === normalized;
      return Number(exactB) - Number(exactA) || a.code.localeCompare(b.code);
    })
    .slice(0, researchConfig.manual_search_limit);
}
