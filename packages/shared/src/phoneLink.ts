// Phone numbers -> call and WhatsApp links (change: quick-dial-and-actions, D1).
//
// One place turns whatever a person typed into a dialable E.164 number, with Israeli defaults
// (the product runs in Israel: a leading 0 means +972). Total: anything unparsable returns null
// and NO link is rendered, because a call button that dials the wrong digits is worse than none.
// The screen keeps showing what the person typed; only the link is normalised.

const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip everything a human decorates a number with, including bidi marks that
  // ride along when a number is copied out of Hebrew text.
  const s = raw.replace(/[\s\-().‎‏‪-‮]/g, '');
  if (!s) return null;
  let digits: string;
  if (s.startsWith('+')) digits = s.slice(1);
  else if (s.startsWith('00')) digits = s.slice(2);
  else if (s.startsWith('972')) digits = s;
  else if (s.startsWith('0')) digits = `972${s.slice(1)}`;
  else return null; // no country and no trunk prefix: we cannot know where it dials
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return `+${digits}`;
}

export function toTelHref(raw: unknown): string | null {
  const n = normalizePhone(raw);
  return n ? `tel:${n}` : null;
}

export function toWhatsAppHref(raw: unknown): string | null {
  const n = normalizePhone(raw);
  return n ? `https://wa.me/${n.slice(1)}` : null;
}
