// Tonight's phone numbers for a run (change: quick-dial-and-actions, D2).
//
// On the RUN, never the game template: a number for this evening's event is an operational fact,
// and the template is replayed by later runs (the CLAUDE.md run-override rule). Written only by
// the owner through `setRunContacts`; each contact says who may see it.

import { normalizePhone } from './phoneLink';

export type ContactAudience = 'players' | 'staff';

export interface RunContact {
  id: string;
  label: string;
  /** As the organizer typed it (shown on screen); links are built with phoneLink. */
  phone: string;
  visibleTo: ContactAudience[];
}

/** What a player's phone receives: no audience list, nothing else. */
export interface PublicContact { id: string; label: string; phone: string }

export const MAX_RUN_CONTACTS = 5;
export const MAX_CONTACT_LABEL = 40;

export type ContactsVerdict =
  | { ok: true; contacts: RunContact[] }
  | { ok: false; problem: 'tooMany' | 'label' | 'phone' | 'audience' | 'shape'; index?: number };

/** Validates what the console sent. Ids are assigned here, in order, so they are stable per save. */
export function validateRunContacts(input: unknown): ContactsVerdict {
  if (!Array.isArray(input)) return { ok: false, problem: 'shape' };
  if (input.length > MAX_RUN_CONTACTS) return { ok: false, problem: 'tooMany' };
  const out: RunContact[] = [];
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') return { ok: false, problem: 'shape', index: i };
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_CONTACT_LABEL) : '';
    if (!label) return { ok: false, problem: 'label', index: i };
    const phone = typeof r.phone === 'string' ? r.phone.trim().slice(0, 40) : '';
    if (!normalizePhone(phone)) return { ok: false, problem: 'phone', index: i };
    const aud = Array.isArray(r.visibleTo) ? r.visibleTo : [];
    const visibleTo = (['players', 'staff'] as const).filter((a) => aud.includes(a));
    if (visibleTo.length === 0) return { ok: false, problem: 'audience', index: i };
    out.push({ id: `c${i + 1}`, label, phone, visibleTo });
  }
  return { ok: true, contacts: out };
}

/** The contacts a given audience may see, stripped to what the screen needs. Total. */
export function contactsFor(contacts: unknown, audience: ContactAudience): PublicContact[] {
  if (!Array.isArray(contacts)) return [];
  return contacts
    .filter((c): c is RunContact => !!c && typeof c === 'object'
      && typeof (c as RunContact).id === 'string' && typeof (c as RunContact).label === 'string'
      && typeof (c as RunContact).phone === 'string' && Array.isArray((c as RunContact).visibleTo)
      && (c as RunContact).visibleTo.includes(audience))
    .map((c) => ({ id: c.id, label: c.label, phone: c.phone }));
}

/**
 * Whom to call in a team (quick-dial-and-actions D3), shared by the console's team page and the
 * staff app so the two can never disagree. ONLY the game's declared phone-type registration fields:
 * a number typed into a name field is not an invitation to call it. Total.
 */
export function teamCallTargets(
  registrationData: unknown,
  phoneFields: ReadonlyArray<{ id: string; label: string }> | null | undefined,
): { label: string; phone: string }[] {
  const out: { label: string; phone: string }[] = [];
  if (!registrationData || typeof registrationData !== 'object' || !Array.isArray(phoneFields)) return out;
  const reg = registrationData as Record<string, unknown>;
  for (const f of phoneFields) {
    if (!f || typeof f.id !== 'string') continue;
    const v = reg[f.id];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === 'string' && normalizePhone(x)) out.push({ label: String(f.label ?? ''), phone: x.trim() });
    }
  }
  return out;
}
