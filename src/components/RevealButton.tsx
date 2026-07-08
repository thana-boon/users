'use client';

import { useState } from 'react';
import { api, jsonBody } from '@/lib/client';
import { useToast } from './Toast';
import { IconEye } from './Icons';

/**
 * Reveals one encrypted field on demand. Each click hits an audited endpoint
 * (teacher-admin only). The revealed value is shown inline; the action is
 * recorded in the audit trail (who / when / whose value).
 */
export function RevealButton({
  endpoint,
  field,
  guardianId,
  label,
}: {
  endpoint: string;
  field: 'password' | 'citizen_id' | 'income';
  guardianId?: number;
  label: string;
}) {
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { field };
      if (guardianId) body.guardianId = guardianId;
      const res = await api<{ value: string | null }>(endpoint, jsonBody(body));
      let shown = res.value;
      if (field === 'income' && res.value) {
        try {
          const p = JSON.parse(res.value);
          shown = `ต่อเดือน ${p.monthly ?? '-'} / ต่อปี ${p.yearly ?? '-'}`;
        } catch { /* keep raw */ }
      }
      setValue(shown ?? '-');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (value !== null) {
    return (
      <span className="mono" style={{ color: 'var(--skdw-purple)', fontWeight: 600 }}>
        {value}
      </span>
    );
  }
  return (
    <button className="btn btn-ghost btn-sm" onClick={reveal} disabled={busy} title="การดูจะถูกบันทึก">
      <IconEye width={15} height={15} /> {busy ? 'กำลังถอดรหัส…' : label}
    </button>
  );
}
