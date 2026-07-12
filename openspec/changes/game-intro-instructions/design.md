# Design: game-intro-instructions

## The field shape

Mirror `StoryBeat` (change: `narrative-chapters`) so authoring, https-guarding, and bilingual
fallback reuse an already-proven shape:

```ts
// packages/shared/src/types/index.ts
export interface GameInstructions {
  title?: string;    // e.g. "How to play"
  body?: string;     // English / default primer text (multiline)
  bodyHe?: string;   // Hebrew primer (falls back to `body`)
  imageUrl?: string; // https-only cosmetic image (a mechanics diagram, etc.)
}

export interface Game {
  // …existing fields…
  // Game-level intro/instructions primer (change: game-intro-instructions).
  // Optional: absent games render no primer. Not secret — echoed to participants
  // and, when public, denormalized into publicGames. Cosmetic; never gates play.
  instructions?: GameInstructions;
}

export interface UpdateGamePayload {
  // …existing fields…
  // Empty/whitespace-only ⇒ the field is cleared server-side.
  instructions?: GameInstructions | null;
}

export interface PublicGame {
  // …existing fields…
  instructions?: GameInstructions; // denormalized for the pre-join promo teaser
}
```

## Pure helpers — `packages/shared/src/gameInstructions.ts`

Dependency-free, unit-testable. Central to the change (the RED test targets these):

```ts
import type { GameInstructions } from './types';

const s = (v?: string) => (v ?? '').trim();

/** True when the primer carries anything worth rendering. */
export function gameInstructionsHasContent(g?: GameInstructions): boolean {
  if (!g) return false;
  return Boolean(s(g.title) || s(g.body) || s(g.bodyHe) ||
    (g.imageUrl ? /^https:\/\//.test(g.imageUrl.trim()) : false));
}

/**
 * Normalize an author-supplied primer for storage/echo: trim every string,
 * keep imageUrl only when https, drop empty fields, and return `undefined`
 * when nothing survives (so the caller can omit/clear the field).
 */
export function cleanGameInstructions(raw?: GameInstructions | null): GameInstructions | undefined {
  if (!raw) return undefined;
  const out: GameInstructions = {};
  if (s(raw.title)) out.title = s(raw.title);
  if (s(raw.body)) out.body = s(raw.body);
  if (s(raw.bodyHe)) out.bodyHe = s(raw.bodyHe);
  const img = s(raw.imageUrl);
  if (img && /^https:\/\//.test(img)) out.imageUrl = img;
  return gameInstructionsHasContent(out) ? out : undefined;
}

/** The primer body in the given language (Hebrew falls back to English). */
export function localizedInstructionsBody(g: GameInstructions | undefined, lang: 'he' | 'en'): string {
  if (!g) return '';
  if (lang === 'he') return s(g.bodyHe) || s(g.body);
  return s(g.body);
}
```

Export from `packages/shared/src/index.ts` (`export * from './gameInstructions'`).

## functions — persistence + echo

- **`updateGame`** (`functions/src/games/index.ts`): add `instructions` to the `UpdateGamePayload`
  destructure and, mirroring the `integrationWebhookUrl` clear-or-set pattern:
  ```ts
  if (instructions !== undefined) {
    const cleaned = cleanGameInstructions(instructions);
    updates.instructions = cleaned ?? (admin.firestore.FieldValue.delete() as unknown as undefined);
  }
  ```
  In the existing `publicGames` resync block (game is public), also write
  `instructions: merged.instructions ?? admin.firestore.FieldValue.delete()` so the public teaser
  can't drift. The https-guard lives entirely in `cleanGameInstructions` — a non-https `imageUrl`
  is dropped, never persisted.
- **`getMyTeamState`** (`functions/src/runs/index.ts`): in the returned `game` subset add
  `instructions: cleanGameInstructions(game.instructions) ?? null`. Cleaning at the echo boundary
  (not just on save) means even a legacy/hand-edited doc with a non-https image is https-guarded on
  the way out — the same defensive posture as the narrative `cleanBeat`.

No new callable, no re-export, no `firestore.rules`/index change (the field rides existing
server-write-only game docs and the already-public `publicGames`).

## creator-web — Builder authoring

In the settings tab's `StepDetails` (`apps/creator-web/src/pages/BuilderPage.tsx`), add a
collapsible **"How to play"** section that edits `game.instructions` via the existing `patch`
helper:
- Title input (`t.builder.instructionsTitleLabel`).
- English body `<textarea>` (`t.builder.instructionsBodyLabel`), `dir="auto"`.
- Hebrew body `<textarea>` (`t.builder.instructionsBodyHeLabel`), `dir="auto"`.
- Optional image URL input (`t.builder.instructionsImageLabel`) with a hint that only `https://`
  links are kept.
- A short helper line (`t.builder.instructionsHint`) explaining it appears before the run and behind
  a "How to play" button in-game.

The primer rides the existing `updateGame({ …, instructions })` wrapper — no new `calls.ts` entry.
All chrome via `t.*`; authored fields carry `dir="auto"`. Run `npm run i18n:check` after.

## play-web — display before start + in-game

`MyTeamState.game.instructions?: GameInstructions | null` added to the play-web type.

- **Before start (waiting screen):** when the run status is not yet `live`/`started` and the primer
  has content, render a **"How to play"** card (title + localized body + optional image) on the
  waiting view, so a joined player reading the lobby learns the mechanics first. `dir="auto"`.
- **In-game:** a small **"How to play"** button in the `PlayScreen` header opens a modal reusing the
  narrative `StoryInterstitial` card layout (image header + title + `whitespace-pre-line` body +
  close). Body chosen by `localizedInstructionsBody(instructions, lang)`. Available for the whole run
  so a confused player can re-read it mid-game.
- **Promo teaser (optional, pre-join):** `GamePromoScreen` already reads `publicGames`; when
  `game.instructions` is present it can show the primer under the description so a player deciding
  whether to join can preview how it plays.

New i18n keys — creator-web `builder`: `instructionsSectionTitle`, `instructionsHint`,
`instructionsTitleLabel`, `instructionsBodyLabel`, `instructionsBodyHeLabel`, `instructionsImageLabel`;
play-web `play`: `howToPlay`, `howToPlayTitle`, `howToPlayClose` — all in BOTH `he` and `en`,
language-pure.

## Test strategy

- **Pure helper (`scripts/test-game-instructions.ts`, tsx, no emulator, auto-run by `npm test`):**
  RED before `gameInstructions.ts` exists. Asserts `cleanGameInstructions` trims fields, drops a
  non-https `imageUrl` while keeping an https one, returns `undefined` for an empty/whitespace-only
  primer, and preserves a full primer; `gameInstructionsHasContent` true/false cases;
  `localizedInstructionsBody` he→bodyHe with fallback to body, en→body.
- **E2E (`scripts/e2e-verify.mjs`, `npm run e2e`) — payload changed:** a scenario sets a bilingual
  primer with a **non-https image** via `updateGame`, launches + joins, then asserts
  `getMyTeamState.game.instructions` echoes `title`/`body`/`bodyHe`, has **no** `imageUrl` (stripped),
  and that a game with no primer returns `instructions === null`. Guards the write→clean→echo seam.
- **UI:** verify the Builder section and the play-web waiting card + in-run modal via the preview
  tools (no component runner). Run `npm run i18n:check` after any UI edit.

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check` · `npm run e2e` (payload changed) — all green.
