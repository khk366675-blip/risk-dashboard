import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MobileDashboard } from '@/components/mobile-dashboard';
import { isMobileAuthenticated } from '@/lib/server/mobile-session';
import {
  mobileCloudEnv,
  readRemoteNotes,
  readRemoteSnapshot,
} from '@/lib/server/mobile-cloud-rest';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Research Mobile — Value Dashboard',
  description: '동기화된 시장·관심종목·리서치 기록을 모바일에서 확인합니다.',
  robots: { index: false, follow: false },
};

function SetupRequired({ message }: { message: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f6f7fb] p-5">
      <section className="w-full max-w-md rounded-3xl border bg-white p-6 shadow-sm">
        <p className="text-[10px] font-medium uppercase tracking-[.18em] text-primary">
          Value Dashboard
        </p>
        <h1 className="mt-2 text-xl font-semibold">모바일 배포 설정 필요</h1>
        <p className="mt-3 text-xs leading-6 text-slate-600">{message}</p>
        <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-[10px] leading-5 text-slate-500">
          로컬 Radar·DART·AI는 그대로 PC에서 실행합니다. 이 화면에는 마지막으로
          게시한 읽기용 스냅샷만 표시됩니다.
        </p>
      </section>
    </main>
  );
}

export default async function MobilePage() {
  const hostedMobile = Boolean(
    process.env.VERCEL || process.env.DASHBOARD_MODE === 'mobile',
  );
  if (!hostedMobile) {
    const { buildLocalMobileSnapshot } = await import(
      '@/lib/server/local-mobile-snapshot'
    );
    return (
      <MobileDashboard
        snapshot={buildLocalMobileSnapshot()}
        initialNotes={[]}
        notesEnabled={false}
      />
    );
  }
  const cloud = mobileCloudEnv();
  const authConfigured = Boolean(
    process.env.MOBILE_ACCESS_PASSWORD && process.env.MOBILE_SESSION_SECRET,
  );
  if (cloud) {
    if (!authConfigured)
      return <SetupRequired message="모바일 접속 비밀번호와 세션 비밀키가 설정되지 않았습니다." />;
    if (!(await isMobileAuthenticated())) redirect('/mobile/login');
    let snapshot = null;
    let notes = null;
    let failure: string | null = null;
    try {
      [snapshot, notes] = await Promise.all([
        readRemoteSnapshot(cloud),
        readRemoteNotes(cloud),
      ]);
    } catch (error) {
      failure = (error as Error).message;
    }
    if (failure)
      return <SetupRequired message={`원격 저장소를 읽지 못했습니다: ${failure}`} />;
    if (!snapshot)
      return <SetupRequired message="아직 게시된 스냅샷이 없습니다. 로컬에서 npm run mobile:publish를 먼저 실행하세요." />;
    return (
      <MobileDashboard
        snapshot={snapshot}
        initialNotes={notes ?? []}
        notesEnabled
      />
    );
  }
  return <SetupRequired message="Supabase 연결 환경변수가 설정되지 않았습니다." />;
}
