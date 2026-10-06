// What a Quick Setup step card says, in reading order (change: quick-setup-card-clarity).
//
// Ahiya, 2026-10-06: the card glued four pieces of prose into one paragraph with the request last,
// so the first words a reader took in were never the thing to do. Now each copy line is written so
// its FIRST sentence is the action (or the question), that sentence is the card's title, and at most
// one line sits under it. Pure and total: no React, no dictionary, never throws.

const STOPS = new Set(['.', '?', '!']);
const QUOTES = new Set(['"', '“', '”', '״']);

/**
 * Split a copy line into its first sentence (the title) and the remainder. A stop inside double
 * quotes does not end the sentence; a stop only ends it when followed by whitespace or the end.
 */
export function splitAsk(line: string | null | undefined): { title: string; rest: string } {
  const text = typeof line === 'string' ? line.trim() : '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (QUOTES.has(ch)) { quoted = !quoted; continue; }
    if (quoted || !STOPS.has(ch)) continue;
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) {
      return { title: text.slice(0, i + 1).trim(), rest: text.slice(i + 1).trim() };
    }
  }
  return { title: text, rest: '' };
}

/**
 * The ONE line under the title: the template author's short note when the step has one (it is
 * specific to this game, so it beats the generic rest of the copy), otherwise that rest.
 */
export function pickSupportLine(input: { rest: string; shortNote?: string | null }): string {
  const note = typeof input.shortNote === 'string' ? input.shortNote.trim() : '';
  if (note !== '') return note;
  return typeof input.rest === 'string' ? input.rest.trim() : '';
}
