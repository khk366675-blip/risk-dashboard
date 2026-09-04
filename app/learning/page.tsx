import type { Metadata } from 'next';
import { LearningLibrary } from '@/components/learning-library';
import { localStore } from '@/lib/server/research-store';
import { ResearchSystemStore } from '@/lib/server/research-system-store';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Learning Library — Value Dashboard',
  description: '독서와 특강에서 배운 내용을 관심종목 리서치에 연결합니다.',
};
export default async function LearningPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { item } = await searchParams;
  const owner = localStore();
  try {
    const store = new ResearchSystemStore(owner.db);
    return (
      <LearningLibrary
        initialItems={store.learning()}
        initialArchivedItems={store.learning(true)}
        initialSelectedId={item ?? null}
        stocks={owner.list().map(({ code, name }) => ({ code, name }))}
      />
    );
  } finally {
    owner.close();
  }
}
