// The Run Console's staff codes panel, as data (change: staff-capabilities).
//
// Built from the run's `staffInvites` (the codes) and `staffGrants` (the people) as the organizer's
// own Firestore listener sees them, and resolved through the SAME `resolveStaffAccess` the server's
// gate uses, so the panel can never claim a marshal is limited when the server would let them
// through. Total: junk documents are skipped, never thrown on.
import {
  ALWAYS_GRANTED_CAPABILITIES,
  STAFF_CAPABILITIES,
  resolveStaffAccess,
  type StaffCapability,
} from '@rushpoint/shared';

export interface StaffCodeDocLike {
  id?: unknown;
  label?: unknown;
  name?: unknown;
  pin?: unknown;
  capabilities?: unknown;
  multiUse?: unknown;
  disabled?: unknown;
  used?: unknown;
  createdAt?: unknown;
}

export interface StaffGrantDocLike {
  id?: unknown;
  codeId?: unknown;
  name?: unknown;
  removed?: unknown;
  joinedAt?: unknown;
}

export interface StaffPerson { uid: string; name: string; joinedAt: string }

export interface StaffCodeRow {
  id: string;
  label: string;
  pin: string;
  /** Everything people on this code may do, always-granted included. */
  capabilities: StaffCapability[];
  /** Minted before capabilities existed: full, and (if single-use) possibly used up. */
  legacy: boolean;
  /** A legacy single-use invite that someone already used. */
  usedUp: boolean;
  disabled: boolean;
  people: StaffPerson[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function buildStaffCodeRows(codes: readonly StaffCodeDocLike[], grants: readonly StaffGrantDocLike[]): StaffCodeRow[] {
  const people = new Map<string, StaffPerson[]>();
  for (const g of grants ?? []) {
    if (!g || typeof g !== 'object') continue;
    const codeId = str(g.codeId);
    const uid = str(g.id);
    if (!codeId || !uid || g.removed === true) continue;
    const list = people.get(codeId) ?? [];
    list.push({ uid, name: str(g.name), joinedAt: str(g.joinedAt) });
    people.set(codeId, list);
  }
  const rows: StaffCodeRow[] = [];
  for (const c of codes ?? []) {
    if (!c || typeof c !== 'object') continue;
    const id = str(c.id);
    if (!id) continue;
    const access = resolveStaffAccess({ grant: { codeId: id, removed: false }, code: c });
    const legacy = c.multiUse !== true;
    rows.push({
      id,
      label: str(c.label) || str(c.name),
      pin: str(c.pin),
      capabilities: STAFF_CAPABILITIES.filter((cap) => access.capabilities.has(cap)),
      legacy,
      usedUp: legacy && c.used === true,
      disabled: c.disabled === true,
      people: (people.get(id) ?? []).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    });
  }
  const createdAt = new Map((codes ?? []).filter((c) => c && typeof c === 'object').map((c) => [str(c.id), str(c.createdAt)]));
  return rows.sort((a, b) => (createdAt.get(a.id) ?? '').localeCompare(createdAt.get(b.id) ?? ''));
}

/** Flip one capability in a checklist, in canonical order; always-granted ones cannot be removed. */
export function toggleCapability(current: readonly StaffCapability[], cap: StaffCapability, on: boolean): StaffCapability[] {
  const set = new Set(current);
  if (on) set.add(cap);
  else if (!ALWAYS_GRANTED_CAPABILITIES.includes(cap)) set.delete(cap);
  return STAFF_CAPABILITIES.filter((c) => set.has(c));
}
