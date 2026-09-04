import { localStore } from './research-store';
import { ManualEvidenceStore } from './manual-evidence-store';

export function withManualEvidence<T>(
  work: (store: ManualEvidenceStore) => T,
): T {
  const owner = localStore();
  try {
    return work(new ManualEvidenceStore(owner.db));
  } finally {
    owner.close();
  }
}
