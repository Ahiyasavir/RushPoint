## Why

Real-user testing surfaced that new creators don't understand they can start from nothing — the
template picker (`apps/creator-web/src/templates.ts:59-381`, rendered by
`DashboardPage.tsx:724` via `TEMPLATES.map(...)`, no `.sort()` so array order is display order)
puts the blank template (`key: 'blank'`, 📄 "תבנית ריקה", `templates.ts:316`) **second-to-last**,
after all 8 niche pre-built templates (bar mitzvah → city tour) and before only 3 generic starters
(riddle/photo/trivia). A creator who wants to build their own thing from scratch — the platform's
core promise — has to scroll past every themed template to find it.

## What Changes

- Reorder `TEMPLATES` (`apps/creator-web/src/templates.ts`) so `blank` is the **first** entry,
  ahead of the niche and generic-starter groups. This is a pure array-order change — no new field,
  no new component.
- No admin-editable template authoring surface is added. The codebase has no admin template CRUD
  today (confirmed: `isAdmin`/admin-gate code only touches the platform-users dashboard, nothing
  touches `templates.ts`), and building one — storage schema, an admin UI, callables, audit
  logging — is a materially larger effort than a display-order fix. It is called out here as an
  explicit **non-goal** so it can be scoped as its own change later if the product still wants it.

### Non-goals
- No admin/super-admin template editing UI or backend (flagged above as future, separate work).
- No change to template *content* (seeded stages/tasks), `mode`, or `scoringPreset` per template.
- No change to `templateLabel()`/`templateDescription()` resolution (`lib/templateLabels.ts`) or
  the i18n dictionaries backing template names/descriptions.

## Capabilities

### Modified Capabilities
<!-- No existing openspec/specs/ capability owns template ordering; treated as a new capability. -->

### New Capabilities
- `creator-template-picker-order`: The game-creation template picker always presents the blank
  template first, before any themed or generic starter template.

## Impact

- **Surfaces touched:** `apps/creator-web` only. No callable, no Firestore rule, no shared type.
- **Files:** `apps/creator-web/src/templates.ts` (reorder the `TEMPLATES` array / regroup the
  section comments at `:60` and `:314`).
- **Risk:** low — pure reordering of a static array already covered by rendering via `.map()`.
- **Testing:** a small pure-logic assertion (`scripts/test-template-picker-order.ts`, picked up by
  the `npm test` aggregator) asserting `TEMPLATES[0].key === 'blank'`.
