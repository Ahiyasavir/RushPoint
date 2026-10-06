// Game intro "How to play" primer (change: game-intro-instructions) — pure helpers.
// Mirrors the narrative StoryBeat shape/guard: bilingual body (bodyHe falls back to
// body) and an https-only cosmetic image. Dependency-free + unit-testable.
import type { GameInstructions } from './types';
import { parseYouTubeId, youTubeEmbedUrl } from './validation';

const s = (v?: string) => (v ?? '').trim();

/** True when the primer carries anything worth rendering (title, body, or https image). */
export function gameInstructionsHasContent(g?: GameInstructions): boolean {
  if (!g) return false;
  return Boolean(s(g.title) || s(g.body) || s(g.bodyHe) ||
    (g.imageUrl ? /^https:\/\//.test(g.imageUrl.trim()) : false) ||
    instructionsVideoUrl(g) !== null);
}

/**
 * Normalize an author-supplied primer for storage/echo: trim every string, keep
 * imageUrl only when https, drop empty fields, and return `undefined` when nothing
 * survives (so the caller can omit/clear the field).
 */
export function cleanGameInstructions(raw?: GameInstructions | null): GameInstructions | undefined {
  if (!raw) return undefined;
  const out: GameInstructions = {};
  if (s(raw.title)) out.title = s(raw.title);
  if (s(raw.body)) out.body = s(raw.body);
  if (s(raw.bodyHe)) out.bodyHe = s(raw.bodyHe);
  const img = s(raw.imageUrl);
  if (img && /^https:\/\//.test(img)) out.imageUrl = img;
  const video = instructionsVideoUrl(raw);
  if (video) out.videoUrl = video;
  return gameInstructionsHasContent(out) ? out : undefined;
}

/** The primer's YouTube video as the canonical embed URL, or null (issue 48). Any common link form
 *  (youtu.be, watch?v=, shorts, embed) is accepted; anything else is no video. */
export function instructionsVideoUrl(g?: Pick<GameInstructions, 'videoUrl'> | null): string | null {
  const id = parseYouTubeId(g?.videoUrl);
  return id ? youTubeEmbedUrl(id) : null;
}

/** The primer body in the given language (Hebrew falls back to English). */
export function localizedInstructionsBody(g: GameInstructions | undefined, lang: 'he' | 'en'): string {
  if (!g) return '';
  if (lang === 'he') return s(g.bodyHe) || s(g.body);
  return s(g.body);
}
