import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import './globals.css';
import { BackToSchoolOS } from '@/components/BackToSchoolOS';

// SKDW CI: IBM Plex Sans Thai is the single typeface (thai + latin).
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'User - SchoolOS | โรงเรียนสุคนธีรวิทย์',
  description: 'ระบบจัดการข้อมูลนักเรียนและครู โรงเรียนสุคนธีรวิทย์',
  // In public/ + declared here (not the src/app/icon.png convention, which
  // hardcodes a root-relative href) so the URL can carry BASE_PATH behind the
  // gateway. See next.config.mjs.
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/icon.png` },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#341a54', // the top bar's purple — phones tint the status bar to match
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={plexThai.variable}>
      <body>
        {children}
        {/* Mounted here, outside the shells, so the login page has it too. */}
        <BackToSchoolOS />
      </body>
    </html>
  );
}
