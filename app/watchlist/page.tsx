import type { Metadata } from 'next';
import { localStore, researchConfig } from '@/lib/server/research-store';
import { WatchlistWorkspace } from '@/components/watchlist-workspace';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '관심종목 — Value Dashboard',
  description:
    '관심종목의 새 공시, 실적과 실제 가격 변화, 자료 상태를 확인합니다.',
};
export default function WatchlistPage() {
  if (process.env.VERCEL)
    return (
      <WatchlistWorkspace
        initialItems={[]}
        initialError="배포용 관심종목 저장소와 별도 수집기 연결이 필요합니다."
        pollInterval={researchConfig.poll_interval_ms}
      />
    );
  try {
    const store = localStore();
    try {
      return (
        <WatchlistWorkspace
          initialItems={store.followups()}
          pollInterval={researchConfig.poll_interval_ms}
        />
      );
    } finally {
      store.close();
    }
  } catch {
    return (
      <WatchlistWorkspace
        initialItems={[]}
        initialError="팔로업 자료를 읽지 못했습니다. 저장소와 확인 기록을 점검해 주세요."
        pollInterval={researchConfig.poll_interval_ms}
      />
    );
  }
}
