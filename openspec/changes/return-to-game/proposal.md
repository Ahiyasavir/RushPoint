## Why

At המירוץ לציון (14.10) players who left the game to search Google for something did not know how
to get back. Ahiya told them to scan the code again, which worked (the phone keeps its session, so a
rescan of the same run resumes exactly where the team was), but nobody knew that, and getting back
"was quite complicated". Two gaps: nothing on the screen or the printed sign says how to return,
and the only way to search was to leave the game's tab.

## What Changes

- The play screen's menu (the ⋯ in the header, available on the waiting screen and during play)
  gains **Search the web**: a link that opens a search page in a NEW tab, so the game's tab stays
  open behind it.
- The waiting screen shows a short tip, in Hebrew and English: left the game? scan the code again
  and you are back where you were. (Ahiya, 16.10: only that sentence; the search is not announced.)
- The printed join sign (creator-web prints page, doc `join`) carries one line under the code: left
  the game? scan this code again and you are back where you were.

## Capabilities

### New Capabilities
- `participant-return-to-game`: how a player searches without leaving the game, and how the screen
  and the printed sign tell them to get back.

### Modified Capabilities
(none)

## Non-goals

- No per-mission search button. A button beside every question would invite searching trivia
  answers; the menu item only keeps the tab for people who would search anyway.
- No "install to home screen". On iPhone a home-screen app keeps its storage apart from Safari, so it
  would not know which game the phone was in.
- No change to how a rescan resumes (already a no-op resume for the same run) and no callable.

## Impact

- play-web: `screens/PlayScreen.tsx` (menu item, waiting tip), `i18n.ts`, a small pure helper
  `lib/webSearch.ts`.
- creator-web: `pages/HostSheetPage.tsx` (join sign line), `i18n.ts`.
- No shared types, no callable, no rules.
