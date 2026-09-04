import { localStore, researchDirectory } from './research-store';
import { ResearchEvidenceStore } from './research-evidence-store';

export function withResearchEvidence<T>(
  work: (store: ResearchEvidenceStore) => T,
): T {
  const owner = localStore();
  try {
    return work(new ResearchEvidenceStore(owner.db, researchDirectory));
  } finally {
    owner.close();
  }
}
