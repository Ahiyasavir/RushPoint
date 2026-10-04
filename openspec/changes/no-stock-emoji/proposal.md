## Why

Ahiya, 2026-10-02: "in general I don't want regular emoji in the texts of the app; [icons should be]
something you make." On 2026-10-02 the two apps carried 561 stock emoji (133 distinct) in UI code and
dictionaries. They look generic, render differently on every phone and OS, and read as unfinished next
to the drawn icon set the Builder already has.

## What Changes

- **Two drawn icon sets, one visual language** (24x24 line icons that take the text colour):
  creator-web extends `components/builderIcons.tsx`; play-web gets `components/Icons.tsx` (beside the
  countdown's `FuseIcons.tsx`). Every icon is decorative (`aria-hidden`) next to words that carry the
  meaning; an icon-only control keeps its accessible name.
- **Every emoji goes, by category:**
  - in a dictionary string (≈200): removed from the text; text is text.
  - a decorative prefix before words in a component ("📞 {title}"): removed, or replaced by a drawn icon
    where the icon helps scanning (call, chat, map, alerts, photos, hints, warnings, panel headers).
  - icon tables (console panels, tabs, task types, empty states, setting rows, how-it-works cards, badges,
    medals): become icon NAMES rendered by the icon component. Components that took an emoji string
    (`EmptyState`, `SettingRow`, ...) take an icon node.
  - canvas share images (story, podium, recap, challenge cards): draw shapes instead of emoji glyphs.
  - language flags become text badges; the theme toggle draws sun/moon; the menu draws a hamburger.
- **Data stays data.** Feed and live reactions are stored under emoji KEYS (`FEED_EMOJIS`,
  `REACTION_EMOJI` in shared); the keys are unchanged and only their on-screen rendering becomes drawn
  icons. `Game.templateEmoji` (an admin field) is no longer rendered or written by the UI.
- **Out of scope:** text the app sends OUT of itself (run summary e-mail HTML, webhook payloads to chat
  tools) and content a creator types into their own game.
- **Ratchet to zero.** `scripts/test-no-stock-emoji.ts` ends with a ceiling of 0 for both apps.

## Capabilities

### New Capabilities
- `no-stock-emoji`: the apps draw their own icons and show no stock emoji.

## Impact

Both apps' UI files and dictionaries; `builderIcons.tsx`; new play-web `Icons.tsx`; `ui.tsx`
`EmptyState`; canvas card modules. No callable, rule or stored-data change.
