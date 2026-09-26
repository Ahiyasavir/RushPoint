// What this staff member may do, live (change: staff-capabilities).
//
// The server's gate resolves every staff action against the person's grant and code, so the
// organizer can widen or narrow a code mid-run without a new PIN. This hook keeps the staff
// console in step with that: it listens to the person's OWN grant and OWN code (the only two
// documents firestore.rules lets them read), renders only the actions the code allows, refreshes
// the session when the code's `version` moves (Firestore rules read token claims, so the live map
// needs a fresh token), and notices a removal.
//
// Fails OPEN on anything it cannot read: a listener error or a pre-change session with no code id
// keeps the capabilities the session was signed in with (absent = everything), because the server
// re-checks every action anyway and a console that hides its own controls on a transient error
// strands a marshal in the middle of an event.
import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import {
  FIRESTORE_PATHS,
  STAFF_CAPABILITIES,
  resolveStaffAccess,
  type StaffCapability,
} from '@rushpoint/shared';
import { auth, db, signInStaff } from '../services/firebase';
import { refreshStaffSession } from '../services/calls';
import type { StaffSession } from '../store';

export interface StaffAccessState {
  can: (capability: StaffCapability) => boolean;
  removed: boolean;
}

function fromSession(staff: StaffSession): Set<string> {
  return new Set(Array.isArray(staff.capabilities) ? staff.capabilities : STAFF_CAPABILITIES);
}

export function useStaffAccess(staff: StaffSession): StaffAccessState {
  const [caps, setCaps] = useState<Set<string>>(() => fromSession(staff));
  const [removed, setRemoved] = useState(false);
  const grantRef = useRef<{ codeId?: unknown; removed?: unknown } | null | undefined>(undefined);
  const codeRef = useRef<{ capabilities?: unknown; disabled?: unknown; version?: unknown } | null | undefined>(undefined);
  const seenVersion = useRef<number | null>(null);

  const { ownerUid, gameId, runId, codeId } = staff;
  // After a reload Firebase restores the session ASYNCHRONOUSLY: `auth.currentUser` is null on the
  // first render. Reading it once would leave a reloaded console never listening, so it would
  // never notice an edit or a removal. Follow the auth state instead.
  const [uid, setUid] = useState<string | null>(() => auth.currentUser?.uid ?? null);
  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) return undefined;

    const recompute = () => {
      const grant = grantRef.current;
      const code = codeRef.current;
      if (grant === undefined) return;          // not loaded yet: keep the session's caps
      if (grant === null) return;               // no grant: signed in before the change, full
      if (grant.removed === true) { setRemoved(true); setCaps(new Set()); return; }
      if (code === undefined) return;
      const access = resolveStaffAccess({ grant, code });
      if (!access.allowed) { setRemoved(true); setCaps(new Set()); return; }
      setRemoved(false);
      setCaps(new Set(access.capabilities));
    };

    const unGrant = onSnapshot(
      doc(db, FIRESTORE_PATHS.staffGrant(ownerUid, gameId, runId, uid)),
      (snap) => { grantRef.current = snap.exists() ? snap.data() : null; recompute(); },
      () => undefined,
    );
    const unCode = codeId
      ? onSnapshot(
        doc(db, FIRESTORE_PATHS.staffInvite(ownerUid, gameId, runId, codeId)),
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          codeRef.current = data;
          recompute();
          // The organizer edited the code: bring the token's claims (read by the rules) in line.
          const v = typeof data?.version === 'number' ? data.version : null;
          if (v !== null && seenVersion.current !== null && v !== seenVersion.current) {
            refreshStaffSession({ ownerUid, gameId, runId })
              .then((r) => signInStaff(r.customToken))
              .catch(() => undefined);
          }
          if (v !== null) seenVersion.current = v;
        },
        () => undefined,
      )
      : () => undefined;
    return () => { unGrant(); unCode(); };
  }, [ownerUid, gameId, runId, codeId, uid]);

  const can = useCallback((capability: StaffCapability) => caps.has(capability), [caps]);
  return { can, removed };
}
