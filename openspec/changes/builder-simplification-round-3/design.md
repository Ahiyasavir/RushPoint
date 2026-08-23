## Context

Round 3 of Builder clarity work. Both items are grounded in direct code reading:

- **Chips.** `TaskWizard.tsx` builds the step 3 chip row from `OPT_IN_GROUP_KEYS`
  (`hint`, `timerPoints`, `rules`) and renders each through one `OptInChip` component with identical
  styling. `CHIP_LABEL` maps them to `b.chipAddHint` / `b.chipSetTimerPoints` / `b.chipRules`, and
  `GROUP_TITLE` to `b.hintField` / `b.groupTimerPoints` / `b.groupRules`. Current EN values are
  "Add hint", "Set timer / points", "Rules"; HE are "הוספת רמז", "הגדרת זמן וניקוד", "תנאים".
- **What `rules` actually holds** (from `lib/taskOptInGroups.ts` `groupHasContent`/`clearGroupPatch`):
  `unlockAfterTaskIds` (prerequisites), `requirePresence`, `tags`, and `maxConcurrentTeams`. So
  "Rules" is not merely vague, it is a grab bag — and a label naming only prerequisites (e.g. "When
  it unlocks") would be actively wrong for the other three fields.
- **Header.** `BuilderPage.tsx` ~558: `<header className="shrink-0 flex items-center gap-3 px-4 h-14 …">`
  with no responsive variants. Children: back button (`shrink-0`), `EditableTitle`, save-status span
  (`shrink-0`), undo/redo pair (`shrink-0`), File-menu `OverflowMenu` (`shrink-0`), tab `nav`
  (`flex-1`), `ReadinessPanel`, and two `Button`s (both `shrink-0`). Only the nav can absorb
  pressure, so at phone width the tabs collapse and the fixed controls overflow.
- **Existing tools to reuse.** `hooks/useMediaQuery.ts` exports `useIsMobile()`, pinned to
  `MOBILE_MAX_WIDTH_PX = 639.98` so it flips at the exact Tailwind `sm` sub-pixel boundary, and is
  unit-tested by `scripts/test-mediaquery.ts`. `components/OverflowMenu.tsx` is a portalled,
  RTL-aware, Escape-dismissible menu already used in this very header for the File menu, with a
  header-styled 44px-tap-target trigger class.

## Goals / Non-Goals

**Goals:**
- Each step 3 chip label states, in plain language, what that group actually contains.
- The Builder header is usable at phone width, with every control still reachable.
- Reuse the repo's existing responsive and overflow primitives rather than inventing new ones.

**Non-Goals:**
- No change to group membership, chip order, chip styling, the collapsed-by-default rule, or any of
  `groupHasContent` / `groupSummary` / `clearGroupPatch` / `OPT_IN_GROUP_KEYS`.
- No added tooltip, icon, description line, or "recommended" marker on the chips (explicitly
  declined; plainer labels only).
- No change to the desktop header layout, and no control removed at any width.

## Decisions

**1. Rename only what is unclear; leave "Add hint" alone.**
"Add hint" is already plain and accurate, so it stays — renaming clear copy for symmetry's sake adds
churn and re-teaches an already-understood control. Proposed replacements (implementer may refine
wording, but must keep them content-accurate and dash-free):

| key | current EN | proposed EN | current HE | proposed HE |
|---|---|---|---|---|
| `chipAddHint` | Add hint | *(unchanged)* | הוספת רמז | *(unchanged)* |
| `chipSetTimerPoints` | Set timer / points | Points & timing | הגדרת זמן וניקוד | ניקוד ותזמון |
| `groupTimerPoints` | Timer & points | Points & timing | זמן וניקוד | ניקוד ותזמון |
| `chipRules` | Rules | Unlocking & limits | תנאים | פתיחה ומגבלות |
| `groupRules` | Rules | Unlocking & limits | תנאים | פתיחה ומגבלות |

"Unlocking & limits" is chosen because it covers the group's two load-bearing halves — when the
mission opens (`unlockAfterTaskIds`, `requirePresence`) and how many teams may work it
(`maxConcurrentTeams`). `tags` is a minor library-organisation field that no short label can also
carry; it stays inside the group, unlabelled by the chip, which is acceptable because it is not the
reason a creator opens this group.

**2. Chip and group labels stay in lockstep.**
`chipSetTimerPoints`/`groupTimerPoints` and `chipRules`/`groupRules` are the folded and unfolded
names for the same thing. They get the SAME replacement string (not two variants), so opening a chip
never renames the thing the creator just clicked. This is why the group titles are in scope at all
despite the proposal being chip-driven.

**3. Header responsiveness uses `useIsMobile()`, not duplicated CSS-hidden markup.**
Two candidate approaches: (a) render both a desktop control row and a mobile overflow menu, toggled
by Tailwind `hidden`/`md:flex` classes; (b) branch on `useIsMobile()` and render one or the other.
Choosing (b): approach (a) would mount two `OverflowMenu` instances (each with its own portal, its
own open state, and a duplicated set of menu items), doubling the surface where the two copies can
drift apart — exactly the class of bug this repo has been burned by before. `useIsMobile()` reads
`window.matchMedia` in its `useState` initialiser, and creator-web is a client-only Vite SPA with no
SSR, so there is no first-paint flash to trade away. It is also already unit-tested and already the
established pattern for this app's mobile work.

**4. What collapses, and what must not.**
At mobile width, `undo`/`redo`, the File menu's two items (export/import), and the secondary
"test run" launch button move into a single `OverflowMenu`. Staying directly on the bar: back,
title, save status, the tab strip, readiness, and the PRIMARY launch button. Rationale: save status
is a safety signal (a creator must be able to see an unsaved/failed state without opening a menu),
readiness gates launching, the tab strip is the Builder's primary navigation, and the primary launch
button is the page's main action. The hidden `<input type="file">` backing import stays mounted
where it is regardless of width — only its trigger moves — so the import flow is unaffected.

**5. No new pure-logic test.**
The label change is copy (already covered by `i18n:check:strict` and, for the no-dash rule, by the
existing `scripts/test-no-dashes.ts`). The header change adds a render branch on an
already-unit-tested hook, not new logic of its own. Verification is via the preview tools at phone,
tablet and desktop widths in both LTR and RTL, consistent with "UI has no component test runner".

## Risks / Trade-offs

- **[Risk]** A creator who has learned the current labels has to re-learn two of them. →
  **Mitigation**: accepted deliberately; the labels being re-learned are precisely the two that
  testing showed do not communicate their contents, and "Add hint" (the most-used chip) is untouched.
- **[Risk]** Hebrew replacements are proposed by an English-first reading and could land awkwardly. →
  **Mitigation**: `i18n:check:strict` PART A enforces that HE stays pure Hebrew, and the design
  explicitly permits the implementer to refine the exact Hebrew phrasing so long as it stays
  content-accurate and dash-free; flag any wording judgment made.
- **[Risk]** Moving the test-run button into a menu makes a rehearsal run harder to find, and
  rehearsal runs are a good habit worth encouraging. → **Mitigation**: it collapses ONLY below the
  `sm` breakpoint, where the alternative is an overflowing header in which it is not reliably
  clickable at all; at every width from tablet up it stays exactly where it is today.
- **[Risk]** `OverflowMenu` renders a portalled `position: fixed` menu; on a short phone viewport a
  menu anchored to a 56px header could clip. → **Mitigation**: the component already clamps to the
  viewport and flips above/below (`VIEWPORT_PAD`, `fitsBelow`), so this is covered by the primitive;
  confirm visually at phone height during verification rather than assuming.

## Migration Plan

No data migration — copy plus a responsive render branch. Deploy as a normal creator-web build;
rollback is a normal commit revert.
