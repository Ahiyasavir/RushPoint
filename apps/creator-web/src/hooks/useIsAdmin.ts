// Is the signed in creator a platform admin (change: admin-user-activity-dashboard)?
//
// Used ONLY to decide whether the nav shows the admin dashboard link. It is not a
// security boundary and must never be treated as one: the route stays registered for
// anyone who types the URL, AdminUsersPage re-checks the claim before it fetches, and
// `listPlatformUsers` re-checks it server side against the verified token. This hook just
// stops the menu offering a door that would not open.
//
// Reads the claim from the ID token rather than calling the server: the claim is already
// inside the token the SDK holds, so this costs nothing and cannot fail loudly.
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { isAdminClaim } from '../lib/adminGate';

export function useIsAdmin(user: User | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setIsAdmin(false); return; }

    // Signing IN as a different account must never inherit the previous verdict, so the
    // flag resets while the new token is read rather than lingering on the old value.
    setIsAdmin(false);
    user.getIdTokenResult()
      .then((token) => { if (!cancelled) setIsAdmin(isAdminClaim(token.claims)); })
      // Fail closed: an unreadable token means "no admin link", never a visible one.
      .catch(() => { if (!cancelled) setIsAdmin(false); });

    return () => { cancelled = true; };
    // Keyed on uid, not the User object: Firebase hands out a new object reference on
    // every token refresh, which would otherwise re-run this every hour for no reason.
  }, [user?.uid]);

  return isAdmin;
}
