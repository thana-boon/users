/**
 * Permission strings this module gates on.
 *
 * Their own file, with no imports, so a Client Component can name a permission
 * without dragging lib/jwt.ts — and with it `jose` and JWT_SECRET — into the
 * browser bundle. lib/jwt.ts re-exports both, so server code can keep importing
 * them from there.
 */

/** Read access to this (admin-only) Records module. */
export const USERS_READ = 'users:read';
/** Write access — what middleware actually requires to enter the module. */
export const USERS_WRITE = 'users:write';
