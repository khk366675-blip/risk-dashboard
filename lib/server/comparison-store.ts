import path from 'node:path';
import {
  localStore,
  ResearchStore,
  researchDirectory,
} from './research-store.ts';
import { ResearchSystemStore } from './research-system-store.ts';
export const peerDirectory = path.join(researchDirectory, 'peers');
export function comparisonSnapshot() {
  const owner = localStore(),
    peers = new ResearchStore(peerDirectory);
  try {
    const system = new ResearchSystemStore(owner.db);
    const items = owner.list().map((item) => ({
      stock: owner.get(item.code)!.stock,
      kpis: system.snapshot(item.code).kpis,
      thesis_count: item.thesis?.count ?? 0,
      peer: false,
      job: item.job,
    }));
    for (const item of peers.list())
      if (!items.some((x) => x.stock.code === item.code))
        items.push({
          stock: peers.get(item.code)!.stock,
          kpis: [],
          thesis_count: 0,
          peer: true,
          job: item.job,
        });
    const sets = owner.db
      .prepare(
        'SELECT * FROM comparison_sets WHERE archived_at IS NULL ORDER BY updated_at DESC',
      )
      .all()
      .map((row) => ({ ...row, codes: JSON.parse(String(row.codes_json)) }));
    return { items, sets };
  } finally {
    owner.close();
    peers.close();
  }
}
