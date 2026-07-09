// Duplicate & translate a game (change: duplicate-translate-game). Pure helpers
// that locate user-facing text fields and deterministically re-inject translated
// copies. Coordinates, types, numbers, and answer KEYS are never collected here —
// answer aliasing is handled by the callable so the original stays accepted.
// No Firestore, no DOM.

export interface TranslatableField { path: string; text: string; }

type TGame = {
  title?: string;
  description?: string;
  stages?: Array<{
    title?: string;
    tasks?: Array<{ title?: string; description?: string; hint?: string }>;
  }>;
};

const TASK_TEXT_FIELDS = ['title', 'description', 'hint'] as const;

/**
 * Collect every user-facing translatable string in a game with a stable path.
 * Only display text (game/stage/task title, description, hint) is returned —
 * coordinates, types, scoring, and answer keys are intentionally excluded.
 */
export function collectTranslatableFields(game: TGame): TranslatableField[] {
  const out: TranslatableField[] = [];
  const push = (path: string, text: unknown) => {
    if (typeof text === 'string' && text.trim()) out.push({ path, text });
  };

  push('title', game.title);
  push('description', game.description);

  (game.stages ?? []).forEach((stage, si) => {
    push(`stages.${si}.title`, stage.title);
    (stage.tasks ?? []).forEach((task, ti) => {
      for (const f of TASK_TEXT_FIELDS) push(`stages.${si}.tasks.${ti}.${f}`, (task as Record<string, unknown>)[f]);
    });
  });

  return out;
}

/**
 * Return a deep copy of `game` with each collected path replaced by its
 * translation. Paths absent from `translations` are left untouched, so an
 * identity map round-trips exactly. Non-text fields are preserved verbatim.
 */
export function applyTranslations<T extends TGame>(game: T, translations: Record<string, string>): T {
  const clone = JSON.parse(JSON.stringify(game)) as T;
  for (const [path, value] of Object.entries(translations)) {
    if (typeof value !== 'string') continue;
    const parts = path.split('.');
    // Reject prototype-pollution paths (__proto__ / constructor / prototype) so a
    // crafted translation key can never reach Object.prototype.
    if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let obj: Record<string, unknown> = clone as unknown as Record<string, unknown>;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = obj[parts[i]];
      if (next == null || typeof next !== 'object') { ok = false; break; }
      obj = next as Record<string, unknown>;
    }
    if (ok) obj[parts[parts.length - 1]] = value;
  }
  return clone;
}
