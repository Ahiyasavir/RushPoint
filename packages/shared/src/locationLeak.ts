// Location-leak advisory for hidden-location tasks (change: hidden-location-leak-guard).
// A `hideLocation` task strips its coordinates from the participant payload, but the
// title and description STILL ship (players need them). If a creator names the place
// there, the "find it from a clue" mechanic is defeated. This pure helper flags which
// of title/description likely name a place, so the Builder can WARN (never strip, never
// block) — the clue (`locationClue`) is exempt since it is meant to describe the spot.

import type { Task } from './types';

export type LocationLeakField = 'title' | 'description';

// Curated place-naming tokens. EN matched on word boundaries (so "art" inside
// "apartment" is not a false hit); HE matched as substrings (no reliable word
// boundary). Deliberately conservative — it is an advisory, not a gate.
const EN_TOKENS = [
  'street', 'st.', 'road', 'rd.', 'avenue', 'ave', 'lane', 'alley', 'square', 'plaza',
  'park', 'garden', 'gate', 'fountain', 'statue', 'monument', 'tower', 'bridge', 'market',
  'mall', 'corner', 'building', 'floor', 'entrance', 'station', 'stop', 'church', 'mosque',
  'synagogue', 'temple', 'museum', 'near', 'next to', 'opposite', 'behind', 'in front of',
  'across from', 'beside', 'at the', 'by the',
];
const HE_TOKENS = [
  'רחוב', 'שדרות', 'שדרה', 'סמטה', 'כיכר', 'ככר', 'גן', 'פארק', 'שער', 'מזרקה', 'פסל',
  'אנדרטה', 'מגדל', 'גשר', 'שוק', 'קניון', 'פינת', 'פינה', 'בניין', 'קומה', 'כניסה',
  'תחנה', 'כנסייה', 'מסגד', 'בית כנסת', 'מוזיאון', 'ליד', 'מול', 'מאחורי', 'לפני', 'מתחת', 'על יד',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namesAPlace(text: string | undefined): boolean {
  if (!text || !text.trim()) return false;
  const lower = text.toLowerCase();
  for (const tok of EN_TOKENS) {
    const re = new RegExp(`(^|[^a-z])${escapeRegex(tok.toLowerCase())}([^a-z]|$)`);
    if (re.test(lower)) return true;
  }
  for (const tok of HE_TOKENS) {
    if (text.includes(tok)) return true;
  }
  return false;
}

export function locationLeakWarnings(
  task: Pick<Task, 'hideLocation' | 'title' | 'description'>,
): LocationLeakField[] {
  if (!task.hideLocation) return [];
  const out: LocationLeakField[] = [];
  if (namesAPlace(task.title)) out.push('title');
  if (namesAPlace(task.description)) out.push('description');
  return out;
}
