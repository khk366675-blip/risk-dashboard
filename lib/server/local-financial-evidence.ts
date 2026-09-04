import { localStore } from './research-store';
import { FinancialEvidenceStore } from './financial-evidence-store';

export function withFinancialEvidence<T>(
  work: (store: FinancialEvidenceStore) => T,
): T {
  const owner = localStore();
  try {
    return work(new FinancialEvidenceStore(owner.db));
  } finally {
    owner.close();
  }
}
