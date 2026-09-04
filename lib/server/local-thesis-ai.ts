import { localStore } from './research-store';
import { ThesisAiService } from './thesis-ai-service';
import { thesisAiConfig } from '../thesis-ai';
export async function withThesisAi<T>(
  work: (service: ThesisAiService) => Promise<T> | T,
) {
  const owner = localStore();
  try {
    return await work(
      new ThesisAiService(owner.db, {
        ...thesisAiConfig,
        model: process.env.THESIS_AI_MODEL?.trim() || thesisAiConfig.model,
      }),
    );
  } finally {
    owner.close();
  }
}
