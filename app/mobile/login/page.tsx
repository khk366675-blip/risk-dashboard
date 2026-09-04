import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MobileLoginForm } from '@/components/mobile-login-form';
import { isMobileAuthenticated } from '@/lib/server/mobile-session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '모바일 접속 — Value Dashboard',
  robots: { index: false, follow: false },
};

export default async function MobileLoginPage() {
  if (await isMobileAuthenticated()) redirect('/mobile');
  return <MobileLoginForm />;
}
