'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { StaffReportView } from '@/components/StaffReportView';
import type { StaffReport } from '@/lib/services/staff-report';

/** รายงานบุคลากร — loads the report; StaffReportView draws (and prints) it. */
export default function StaffReportPage() {
  const [data, setData] = useState<StaffReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<StaffReport>('/api/users/reports/staff').then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="alert alert-error">โหลดรายงานไม่สำเร็จ: {error}</div>;
  if (!data) {
    return (
      <div className="stack" style={{ gap: 16 }} aria-busy="true" aria-label="กำลังโหลดรายงาน">
        <div className="skeleton" style={{ height: 48, width: '50%' }} />
        <div className="grid-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}</div>
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }
  return <StaffReportView data={data} />;
}
