import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'けいさんスプリント',
  description: '小学校低学年向けの、楽しく取り組める計算練習アプリ',
  openGraph: {
    title: 'けいさんスプリント',
    description: 'たのしく、はやく、けいさんれんしゅう。',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'けいさんスプリント' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'けいさんスプリント',
    description: 'たのしく、はやく、けいさんれんしゅう。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
