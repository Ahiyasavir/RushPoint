# PLAN — hidden-location-leak-guard

## Problem
Hidden-location tasks strip `coordinates`/radius from the participant payload, but `title` and
`description` still ship (they must — the player needs them). Creators name the place in those
fields, defeating the "find it from a clue" mechanic. Fix = an authoring-time WARNING (never a strip,
never a block).

## Exact files
- **New:** `packages/shared/src/locationLeak.ts` — pure helper.
- **Edit:** `packages/shared/src/index.ts` — add `export * from './locationLeak';` (after
  `./sanitizeFinite`).
- **New:** `scripts/test-location-leak.ts` — RED-first pure-logic test (auto-run by `npm test`).
- **Edit:** `apps/creator-web/src/components/TaskWizard.tsx` — render the caution inside the existing
  `task.hideLocation` block (after the clue Textarea / `hideLocationNeedsClue`, ~line 916).
- **Edit:** `apps/creator-web/src/i18n.ts` — add 3 Builder keys to BOTH `he` (~L531) and `en` (~L1268)
  Builder blocks.

## Pure helper signature
```ts
// packages/shared/src/locationLeak.ts
export type LocationLeakField = 'title' | 'description';
export function locationLeakWarnings(
  task: Pick<Task, 'hideLocation' | 'title' | 'description'>,
): LocationLeakField[];
```
Behavior:
- `!task.hideLocation` ⇒ `[]`.
- Else check `title` then `description` against curated bilingual place tokens; push each matching
  field. `locationClue`/`locationClueHe` are NOT checked (clue is meant to describe the spot).
- English: word-boundary regex (no match on fragments inside a word). Hebrew: substring match.
- Token sets (EN): street, st., road, rd., avenue, ave, lane, alley, square, plaza, park, garden,
  gate, fountain, statue, monument, tower, bridge, market, mall, corner, building, floor, entrance,
  station, stop, church, mosque, synagogue, temple, museum, near, next to, opposite, behind,
  in front of, across from, beside, at the, by the.
  Token sets (HE): רחוב, שדרות, שדרה, סמטה, כיכר, ככר, גן, פארק, שער, מזרקה, פסל, אנדרטה, מגדל, גשר,
  שוק, קניון, פינת, פינה, בניין, קומה, כניסה, תחנה, כנסייה, מסגד, בית כנסת, מוזיאון, ליד, מול, מאחורי,
  לפני, מתחת, על יד.

## RED test assertions (scripts/test-location-leak.ts)
```ts
import { locationLeakWarnings } from '@rushpoint/shared';
// helpers: ok(cond, msg); build a minimal task literal.
ok(eq(locationLeakWarnings({ title: 'Meet at Jaffa Gate' }), []),                       'not hidden ⇒ []');
ok(eq(locationLeakWarnings({ hideLocation: false, title: 'the fountain' }), []),        'hideLocation false ⇒ []');
ok(eq(locationLeakWarnings({ hideLocation: true, title: 'Meet at the Old City fountain' }), ['title']),        'EN token in title');
ok(eq(locationLeakWarnings({ hideLocation: true, title: 'משימה', description: 'ברחוב יפו' }), ['description']), 'HE token in description');
ok(eq(locationLeakWarnings({ hideLocation: true, title: 'the market', description: 'near the gate' }), ['title','description']), 'both fields');
ok(eq(locationLeakWarnings({ hideLocation: true, title: 'Find the secret spot', description: 'מצאו את המקום הסודי' }), []),      'neutral ⇒ []');
ok(eq(locationLeakWarnings({ hideLocation: true, title: 'Find it', locationClue: 'at the fountain' } as any), []),             'clue exempt');
ok(eq(locationLeakWarnings({ hideLocation: true, title: 'Enter the apartment' }), []),  'word-boundary: apartment ≠ art token');
```
`eq` = shallow array equality. Confirm RED (module missing) before writing the helper.

## Builder wiring (TaskWizard.tsx)
- Import: `import { locationLeakWarnings } from '@rushpoint/shared';` (alongside existing shared
  imports / `normalizeTriggerMode`, `isTaskLocationValid`).
- Inside the `{task.hideLocation && ( … )}` block, after the coords/clue notes:
```tsx
{(() => {
  const leaks = locationLeakWarnings(task);
  if (leaks.length === 0) return null;
  return (
    <p className="text-[11px] text-rp-fire mt-1">
      {leaks.length === 2 ? b.hideLocationLeakBoth
        : leaks[0] === 'title' ? b.hideLocationLeakTitle
        : b.hideLocationLeakDesc}
    </p>
  );
})()}
```
No `set()`, no disable of Save — advisory only.

## i18n keys (apps/creator-web/src/i18n.ts) — Builder (`b`) namespace, EN + HE
`he`:
- `hideLocationLeakTitle: 'הכותרת אולי חושפת את המיקום. השחקנים רואים אותה, העבירו את שם המקום לרמז.'`
- `hideLocationLeakDesc: 'התיאור אולי חושף את המיקום. השחקנים רואים אותו, העבירו את שם המקום לרמז.'`
- `hideLocationLeakBoth: 'הכותרת והתיאור אולי חושפים את המיקום. השחקנים רואים אותם, העבירו את שם המקום לרמז.'`

`en`:
- `hideLocationLeakTitle: 'Your title may reveal the spot. Players see it, so move the place name into the clue.'`
- `hideLocationLeakDesc: 'Your description may reveal the spot. Players see it, so move the place name into the clue.'`
- `hideLocationLeakBoth: 'Your title and description may reveal the spot. Players see them, so move the place name into the clue.'`

(No em/en dash or spaced-hyphen separators — INSTRUCTIONS.md §C. HE values contain no English words,
EN values contain no Hebrew — INSTRUCTIONS.md §D. `EN: typeof HE` enforces key parity.)

## Gates (run all before done)
```
npm run typecheck
npm test                # includes scripts/test-location-leak.ts
npm run lint
npm run creator:build
npm run play:build
npm run i18n:check      # mandatory after the TaskWizard/i18n edits; PART A clean, 0 new PART B
```
No emulator / e2e needed: pure helper + advisory UI, no callable or server change.
