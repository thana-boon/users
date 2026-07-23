import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import './globals.css';

// SKDW CI: IBM Plex Sans Thai is the single typeface (thai + latin).
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SchoolOS · ข้อมูลนักเรียนและครู',
  description: 'ระบบจัดการข้อมูลนักเรียนและครู โรงเรียนสุขนธีรวิทย์',
  // In public/ + declared here (not the src/app/icon.svg convention, which
  // hardcodes a root-relative href) so the URL can carry BASE_PATH behind the
  // gateway. See next.config.mjs.
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icon.svg` },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#5b2d8e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={plexThai.variable}>
      <body>{children}</body>
    </html>
  );
}
