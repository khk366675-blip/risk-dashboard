import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PdfResearchReader } from '@/components/pdf-research-reader';
import { localStore } from '@/lib/server/research-store';
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!/^\d{6}$/.test(code)) notFound();
  const owner = localStore();
  try {
    if (!owner.get(code)?.item.active) notFound();
  } finally {
    owner.close();
  }
  return (
    <Suspense fallback={<p>자료 여는 중</p>}>
      <PdfResearchReader code={code} />
    </Suspense>
  );
}
