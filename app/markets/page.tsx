import type { Metadata } from 'next';

import { MarketsWorkspace } from '@/components/markets-workspace';

export const metadata: Metadata = {
  title: 'Markets — Value Dashboard',
  description: '글로벌 주식, 한국 시장, 환율·금리, 실물자산을 함께 보는 시장 상황판',
  openGraph: { title: 'Markets — Value Dashboard', description: '시장 맥락과 데이터 상태를 함께 확인합니다.', images: [] },
  twitter: { card: 'summary', title: 'Markets — Value Dashboard', description: '시장 맥락과 데이터 상태를 함께 확인합니다.', images: [] },
};

export default function MarketsPage() {
  return <MarketsWorkspace />;
}
