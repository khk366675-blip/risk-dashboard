import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import RadarWorkspace from '@/components/radar-workspace';
import {
  radarRun as bundledRadarRun,
  type RadarRun,
} from '@/lib/radar-run';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Radar — Value Dashboard',
  description: 'Quality, Improvement, Dislocation, Event 관점으로 투자 검토 후보를 찾습니다.',
};

async function latestRadarRun(): Promise<RadarRun> {
  try {
    return JSON.parse(
      await readFile(
        path.join(process.cwd(), 'public', 'data', 'radar', 'latest.json'),
        'utf8',
      ),
    ) as RadarRun;
  } catch {
    return bundledRadarRun;
  }
}

export default async function RadarPage() {
  return <RadarWorkspace initialRadarRun={await latestRadarRun()} />;
}
