import type { Metadata } from 'next';
import { Noto_Sans_Thai, Inter } from 'next/font/google';
import './globals.css';

const notoSansThai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto-sans-thai',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SchoolOS · ข้อมูลนักเรียนและครู',
  description: 'ระบบจัดการข้อมูลนักเรียนและครู โรงเรียนสุขนธีรวิทย์',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b2d8e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${notoSansThai.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
