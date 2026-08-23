## Why

**`/terms` and `/privacy` on the participant origin render the game, not the documents.** Reported by
the product owner, reproduced on the playtest tunnel root and true of the production play-web site
for the same reason. Verified in this working tree:

1. **play-web has no legal page at all.** `LegalPage.tsx` and `legalMarkdown.ts` exist only under
   `apps/creator-web/src/pages/`. `apps/play-web/src/screens/` has no equivalent.
2. **play-web has no router and never reads the path.** `App.tsx` renders from
   `resolvePlayRoute({ search })` (`apps/play-web/src/lib/playRoute.ts`), which parses
   `window.location.search` only. Ten routes, all query-param driven (`?staff`, `?tv=`, `?recap=`,
   `?board=`, `?challenge=`, `?code=`, `?game=`). An unknown *path* is not a route at all: it falls
   through to the join/play screen.
3. **Both hosting sites rewrite everything to the SPA shell.** `firebase.json` gives the `play`
   target `{"source": "**", "destination": "/index.html"}`, so `rushpoint-play…/terms` serves the
   participant app, which then renders the player per (2).
4. **The tunnel does the same by design.** `resolveProxyTarget`
   (`packages/shared/src/playtest.ts:44-52`) sends `/creator*` to creator-web and everything else to
   play-web; `/terms` correctly reaches play-web, which has nothing to show for it. Today only
   `/creator/terms` and `/creator/privacy` work.

Why this is not cosmetic: **participants are the people who accept these documents.** Creators sign
up and can reach `/terms` inside the creator console; participants join anonymously from a phone,
never touch creator-web, and are exactly the population the Privacy Policy's location/photo/minor
sections are written for. Store-listing and in-app legal links point at `/terms` and `/privacy` on a
public origin. A privacy policy that resolves to a game screen is a compliance and trust failure.

## What Changes

**The participant app renders the real documents at `/terms` and `/privacy`.**
- Reachable from the participant origin itself. No redirect into the creator app: bouncing a player
  to `/creator/terms` drops them out of the PWA shell they joined through, loads a second
  application, and leaves them with no way back to their run.
- Hebrew-first, matching the app's active language, with the same HE/EN toggle creator-web offers.

**One copy of the policy text, shared by both apps.**
- The document bodies and the inline-markdown helpers move to `packages/shared/src`. creator-web
  renders from the same source, with identical output. Two divergent copies of a privacy policy is
  the one outcome worse than the bug.
- **The legal TEXT is not rewritten by this change.** The documents are moved verbatim; this change
  makes existing documents reachable, it does not author policy.

**The path decision is a pure, unit-tested function — no router dependency.**
- `resolvePlayRoute` gains an optional `pathname` alongside the existing `search`, and a new
  `legal` route. Everything the resolver already does is unchanged; an unrecognized path resolves
  exactly as it does today, so the player experience cannot regress.

**The legal chunk stays out of the participant entry bundle.**
- The document text is tens of kilobytes of Hebrew and English prose that a racing participant must
  never pay for. It is loaded through the existing `lazyWithRetry` split and is verified by
  `npm run bundle:budget`.

### Non-goals

- **No change to the legal text.** Not one policy sentence is edited.
- **No new public paths.** `/terms` and `/privacy` only — confirmed by grep to be the only public
  legal paths in the repo.
- **No change to how creator-web serves `/privacy` and `/terms`.** `https://rushpoint-creator.web.app/privacy`
  is a live, externally referenced URL; its route, its component and its rendering stay as they are.
- **No router library added to play-web.**
- **No backend change.** No callables, no Firestore rules, no data model.

## Capabilities

### New Capabilities
- `participant-legal-pages`: The participant origin serves the Terms of Service and the Privacy
  Policy at `/terms` and `/privacy` — the same documents the creator console serves, from a single
  shared source — in the app's language, without leaving the participant app, and without adding
  weight to the app's first load.

### Modified Capabilities
- `playtest-links`: the reverse-proxy routing requirement is tightened so the root legal paths are
  pinned to play-web (they already resolve there; nothing pinned them, so a future substring rule
  could silently steal them) while `/creator*` routing is unchanged.

## Impact

- **Surfaces touched:** `packages/shared/src` (new `legalMarkdown.ts` + `legalContent.ts`),
  `apps/play-web` (`App.tsx`, `lib/playRoute.ts`, new `screens/LegalScreen.tsx`, `i18n.ts` — two
  additive keys), `apps/creator-web` (`pages/LegalPage.tsx` now imports the shared content;
  `pages/legalMarkdown.ts` becomes a re-export), and two `scripts/test-*.ts` files.
- **No** callables, **no** Firestore rules, **no** shared types used by `functions/`.
- **`firebase.json` needs no change.** Both hosting targets already rewrite `**` to `/index.html`;
  once play-web understands the path, the existing rewrite is exactly what is needed. **A hosting
  deploy of play-web IS required** for the fix to appear in production — a git push alone changes
  nothing on `rushpoint-play.web.app`.
- **The proxy change takes effect on the next playtest restart** (and after `packages/shared` is
  rebuilt, since `scripts/proxy.mjs` imports the built package). The live stack is deliberately not
  restarted by this change.
- **Risk:** the resolver is on the hot path for every participant load. Mitigated by making the path
  branch additive and total — any path that is not exactly the two legal paths produces the
  identical result to today — and by unit tests that assert that explicitly.
