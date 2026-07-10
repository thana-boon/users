/* Lucide-style stroke icons (1.75px), SVG only — never emoji. */
import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconDashboard = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
);
export const IconStudents = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" /></svg>
);
export const IconTeachers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><circle cx="9" cy="7" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 3.1a3 3 0 0 1 0 5.8" /><path d="M21 20c0-2.5-1.5-4.7-3.7-5.6" /></svg>
);
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);
export const IconAudit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M9 15l2 2 4-4" /></svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M12 5v14M5 12h14" /></svg>
);
export const IconEdit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
);
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
);
export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
);
export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="m15 18-6-6 6-6" /></svg>
);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconPromote = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M12 19V5M6 11l6-6 6 6" /><path d="M5 21h14" /></svg>
);
export const IconHash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></svg>
);
export const IconGraduate = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5" /><path d="M22 10v6" /></svg>
);
export const IconExit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /><path d="m18 8 4 4-4 4M22 12H10" /></svg>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="m6 9 6 6 6-6" /></svg>
);
export const IconRestore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)} aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
);
