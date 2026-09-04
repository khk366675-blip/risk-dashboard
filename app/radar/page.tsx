import type { Metadata } from 'next';

import RadarWorkspace from '@/components/radar-workspace';

export const metadata: Metadata = {
  title: 'Radar — Value Dashboard',
  description: 'Quality, Improvement, Dislocation, Event 관점으로 투자 검토 후보를 찾습니다.',
};

export default function RadarPage() {
  return <RadarWorkspace />;
}
