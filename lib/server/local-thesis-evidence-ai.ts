import { localStore } from './research-store';
import { ThesisEvidenceAiService } from './thesis-evidence-ai-service';
import { thesisEvidenceAiConfig } from '../thesis-evidence-ai';

export async function withThesisEvidenceAi<T>(
  work: (service: ThesisEvidenceAiService) => Promise<T> | T,
) {
  const owner = localStore();
  try {
    return await work(
      new ThesisEvidenceAiService(owner.db, {
        ...thesisEvidenceAiConfig,
        model:
          process.env.THESIS_EVIDENCE_AI_MODEL?.trim() ||
          thesisEvidenceAiConfig.model,
      }),
    );
  } finally {
    owner.close();
  }
}
