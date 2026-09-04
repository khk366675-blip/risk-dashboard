import { randomUUID } from 'node:crypto';
import { localStore } from './research-store';
import { AiRequestGate } from './ai-request-gate';
import { ThesisStore } from './thesis-store';
export async function withLocalAiBudget<T>(work: () => Promise<T>) {
  const owner = localStore();
  const gate = new AiRequestGate(owner.db);
  const id = randomUUID();
  try {
    new ThesisStore(owner.db).transaction(() =>
      gate.reserve(id, 'radar_explanation'),
    );
    try {
      return await work();
    } finally {
      gate.finish(id);
    }
  } finally {
    owner.close();
  }
}
