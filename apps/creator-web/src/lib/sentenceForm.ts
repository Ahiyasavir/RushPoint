// Fill-in-the-sentence setup (change: composer-v2-sentence-setup).
//
// The founder wanted mission setup to ask "ממש תשלים את המשפט". A bank mission that needs the
// creator's words carries them as a bracket inside the very sentence players read:
// "תנווטו למקום ש[הוראות ליוצר: הרמז, בלי שם המקום]." The editor turns that into the sentence with a
// blank, the bracket's own words as the example inside it (a "Mad Libs" / sentence form), so the
// creator writes exactly what players will read, in place.
//
// The marker is the same one Quick Setup already treats as "not done yet" (`isPlaceholderValue` in
// @rushpoint/shared templateWizard): a bracket addressed to the creator or the organizer. Filling a
// blank removes its bracket, which is what marks the step done; leaving it empty keeps the bracket.
//
// The form outlives the brackets it fills: once a blank is typed into, the bracket is gone from the
// text. So the form keeps the TEMPLATE (the text as it was with its brackets) and reads the values
// back out of the current text with `extractSlotValues`. When the creator rewrites the text by hand
// and it no longer matches the template, that returns null and the form steps aside for the plain
// text box. Pure and total.

/** A bracket addressed to the creator or organizer. Group 1 is everything inside the brackets. */
const SLOT = /\[((?:הוראות|הערה)\s+(?:ליוצר|למארגן|למפעיל)[^\]\n]*|(?:creator|organi[sz]er)\s*:[^\]\n]*)\]/gi;
/** The marker words at the start of a bracket, dropped from the example shown in the blank. */
const MARKER = /^(?:(?:הוראות|הערה)\s+(?:ליוצר|למארגן|למפעיל)|creator|organi[sz]er)\s*[:：-]?\s*/i;

export type SentencePart =
  | { kind: 'text'; text: string }
  | { kind: 'slot'; index: number; hint: string; token: string };

export function parseSentence(template: unknown): SentencePart[] {
  if (typeof template !== 'string' || template === '') return [];
  const parts: SentencePart[] = [];
  let last = 0;
  let index = 0;
  for (const m of template.matchAll(new RegExp(SLOT.source, 'gi'))) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: template.slice(last, at) });
    parts.push({ kind: 'slot', index: index++, hint: m[1].replace(MARKER, '').trim(), token: m[0] });
    last = at + m[0].length;
  }
  if (last < template.length) parts.push({ kind: 'text', text: template.slice(last) });
  return parts;
}

export function hasOpenSlots(text: unknown): boolean {
  return parseSentence(text).some((p) => p.kind === 'slot');
}

/** The template with each blank replaced by its value; an empty value keeps the bracket. */
export function fillTemplate(template: string, values: readonly string[]): string {
  return parseSentence(template).map((p) => {
    if (p.kind === 'text') return p.text;
    const v = typeof values?.[p.index] === 'string' ? values[p.index] : '';
    return v.trim() === '' ? p.token : v;
  }).join('');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The value in each blank of `template`, read out of `text`; '' for a blank still holding its
 * bracket. null when `text` is no longer this template filled in (the creator rewrote it).
 */
export function extractSlotValues(template: unknown, text: unknown): string[] | null {
  if (typeof template !== 'string' || typeof text !== 'string') return null;
  const parts = parseSentence(template);
  if (!parts.some((p) => p.kind === 'slot')) return null;
  const pattern = parts.map((p) => (p.kind === 'text' ? escapeRe(p.text) : '([\\s\\S]*?)')).join('');
  const m = new RegExp(`^${pattern}$`).exec(text);
  if (!m) return null;
  const slots = parts.filter((p): p is Extract<SentencePart, { kind: 'slot' }> => p.kind === 'slot');
  return slots.map((s, i) => (m[i + 1] === s.token ? '' : m[i + 1]));
}

/** Codes a team could guess without finding anything. */
const GUESSABLE = new Set(['0000', '1234', '4321', '1212', '2580', '1122', '6969']);

/**
 * A four-digit code for a station, with at least three different digits and none of the codes people
 * try first. `rng` is injected (tests, and so the Builder can use Math.random).
 */
export function generateCode(rng: () => number = Math.random): string {
  let seed = 0;
  const next = () => {
    const r = rng();
    seed = (seed + 1) % 10;
    return Number.isFinite(r) && r >= 0 && r < 1 ? r : ((seed * 0.6180339887) % 1);
  };
  for (let tries = 0; tries < 50; tries++) {
    const code = Array.from({ length: 4 }, () => Math.floor(next() * 10)).join('');
    if (!GUESSABLE.has(code) && new Set(code).size >= 3) return code;
  }
  return '3815';
}
