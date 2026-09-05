'use client';
import Link from 'next/link';
import {
  BookOpen,
  GitCompareArrows,
  LineChart,
  Radar,
  Star,
} from 'lucide-react';
import { ResearchTools } from '@/components/research-tools';
export function PrimaryNavigation({
  active,
  radarCount,
}: {
  active: string;
  radarCount?: number;
}) {
  return (
    <>
      <nav aria-label="주요 메뉴" className="mt-5 space-y-1">
        {(
          [
            ['markets', 'Markets', LineChart],
            ['radar', 'Radar', Radar],
            ['watchlist', '관심종목', Star],
            ['compare', '기업 비교', GitCompareArrows],
            ['learning', 'Learning', BookOpen],
          ] as const
        ).map(([key, label, Icon]) => {
          const Symbol = Icon as typeof Star;
          return (
            <Link
              key={String(key)}
              href={`/${key}`}
              aria-current={active === key ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${active === key ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Symbol className="size-4" />
              {String(label)}
              {key === 'radar' && radarCount !== undefined && (
                <span className="ml-auto rounded-full bg-white px-2 text-xs">
                  {radarCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <ResearchTools />
    </>
  );
}
