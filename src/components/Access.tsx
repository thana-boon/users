'use client';

import { createContext, useContext, useMemo } from 'react';
import { allows, isAdminPerms } from '@/lib/permissions';

/**
 * The signed-in user's permissions, for hiding what they cannot use — the
 * menu, an export button, a reveal. Cosmetic only: the rule table in
 * lib/permissions.ts is enforced by middleware and by every route's guard, so
 * a button that slips through here still gets a 403.
 */
const AccessCtx = createContext<readonly string[]>([]);

export function AccessProvider({ perms, children }: { perms: readonly string[]; children: React.ReactNode }) {
  return <AccessCtx.Provider value={perms}>{children}</AccessCtx.Provider>;
}

export function useAccess() {
  const perms = useContext(AccessCtx);
  return useMemo(
    () => ({
      isAdmin: isAdminPerms(perms),
      /** May this user call / open this path (BASE_PATH-free) with this method? */
      can: (path: string, method = 'GET') => allows(perms, path, method),
    }),
    [perms],
  );
}
