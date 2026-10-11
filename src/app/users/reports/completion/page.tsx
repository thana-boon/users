'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { CompletionView } from '@/components/CompletionView';
import type { CompletionReport } from '@/lib/completion-fields';

/** ติดตามการกรอกข้อมูล — loads the report; CompletionView draws it. */
export default function CompletionPage() {
  const [data, setData] = useState<CompletionReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<CompletionReport>('/api/users/reports/completion').then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="alert alert-error">โหลดข้อมูลไม่สำเร็จ: {error}</div>;
  if (!data) {
    return (
      <div className="stack" style={{ gap: 16 }} aria-busy="true" aria-label="กำลังโหลด">
        <div className="skeleton" style={{ height: 48, width: '50%' }} />
        <div className="grid-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}</div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }
  return <CompletionView data={data} />;
}
