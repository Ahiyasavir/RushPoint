## Context

A rescan of the same run already resumes (`resolvePlayRoute` keeps a session whose run matches the
link; `resumeOrJoin` sends a saved session to play). What was missing is telling people, and a way to
search that does not replace the game's page.

## Decisions

- **D1. A link, not `window.open`.** An `<a href target="_blank" rel="noopener noreferrer">` is a user
  navigation that no popup blocker refuses, and it works from the keyboard. `noopener` because a
  `_blank` page must not get a handle on the game's tab.
- **D2. In the menu, not on each mission.** See the proposal's non-goals: neutral about cheating, no
  Builder setting, no sanitizer change.
- **D3. The URL is one pure function** (`lib/webSearch.ts`, `webSearchHref(lang)`): Google's home with
  the interface language, no query. Pure so it is tested and so a later change of provider is one line.
- **D4. The tip lives on the waiting screen**, the one screen every team sees before playing, under
  the status. A title and ONE sentence (Ahiya cut it twice on 16.10: shorter beats complete).

## Test strategy (RED first)

`scripts/test-return-to-game.ts` (pure lane): `webSearchHref` for both languages; the PlayScreen
menu renders a `data-testid="web-search"` anchor with `target="_blank"` and `noopener`, and the
waiting branch renders the tip keys; both play-web dictionaries carry the keys (Hebrew says to scan
again); creator-web's dictionaries carry the sign line and HostSheetPage renders it in the join doc.
UI: preview at 375 px (waiting screen, open menu, the sign), `npm run i18n:check:strict`.

## Risks

- A standalone (installed) PWA opens `_blank` in an in-app browser sheet: still a separate surface
  that closes back to the game, which is the goal.
