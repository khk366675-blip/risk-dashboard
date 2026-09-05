import { DatabaseSync } from 'node:sqlite';
import type { StockDetail } from '../stock-detail.ts';

export function completePreviewPrices(
  stock: StockDetail,
  databasePath: string,
): StockDetail['prices'] {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const rows = db
      .prepare(
        'SELECT date,open,high,low,close,volume FROM prices WHERE code=? ORDER BY date',
      )
      .all(stock.code)
      .map((row) => ({ ...row })) as unknown as StockDetail['prices'];
    const byDate = new Map(rows.map((row) => [row.date, row]));
    // Do not substitute a different as-of or price-adjustment basis into a preview.
    if (
      rows.length > stock.prices.length &&
      rows.at(-1)?.date === stock.prices.at(-1)?.date &&
      stock.prices.every((row) => byDate.get(row.date)?.close === row.close)
    )
      return rows;
  } catch {
    /* Preserve the original preview when the full local price store is unavailable. */
  } finally {
    db?.close();
  }
  return stock.prices;
}
