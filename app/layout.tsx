import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Value Dashboard — Radar Research Workspace',
  description: '근거와 반증을 함께 탐색하는 시각 중심 투자 리서치 대시보드',
  openGraph: {
    title: 'Value Dashboard',
    description: '근거부터 탐색하는 투자 리서치',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Value Dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Value Dashboard',
    description: '근거부터 탐색하는 투자 리서치',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
