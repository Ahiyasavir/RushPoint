## Context

`TEMPLATES` (`apps/creator-web/src/templates.ts:59-381`) is a flat array of `GameTemplate` objects
(`key`, `emoji`, `mode`, `scoringPreset`, `build()`), grouped today by two comment dividers: niche
launch-wedge templates (`:60`, 8 entries) then generic starters (`:314`, `blank` + riddle/photo/
trivia). `DashboardPage.tsx:724` renders them with a bare `.map()` — no sort, no reordering logic
— so array order is literally the order a creator sees on their very first screen.

## Goals / Non-Goals

**Goals:**
- `blank` renders first, every time, with no dependency on locale, device, or A/B state.
- Zero behavior change to any other template (content, mode, scoring, label/description
  resolution).

**Non-Goals:**
- No admin-configurable ordering (would require persisted config + an admin surface that doesn't
  exist — see proposal.md non-goals).
- No new grouping/section UI in the picker; this only changes which item is first in the existing
  flat list.

## Decisions

- **Move the `blank` object literal to the top of the array, and move the comment divider with
  it**, rather than adding a `.sort()`/priority field. The array has no other consumer that relies
  on today's order (grepped: only `DashboardPage.tsx:724`'s `.map()`), so a sort comparator would
  be solving a problem the codebase doesn't have — it's an unnecessary abstraction for a 12-item
  static list. Plain reordering is the smallest correct change.
- Keep `key: 'blank'` and its emoji/label/description resolution untouched — this is strictly a
  position change.

## Risks / Trade-offs

- [Risk] A future contributor adds a new template and reintroduces disorder by pasting it above
  `blank` without noticing. → Mitigation: the pure-logic test
  (`scripts/test-template-picker-order.ts`) asserts `TEMPLATES[0].key === 'blank'` and runs in
  `npm test`, so a regression is caught at gate time, not in production.
