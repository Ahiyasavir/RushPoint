## Why

An admin has exactly one way to take a template out of the creator-facing picker:
set `isTemplate: false`. Both listings key on that same flag — `listGameTemplates`
(every authenticated creator) and `listAdminTemplates` (the admin's own builder) —
so clearing it does not park the template, it makes it vanish from the admin's
template list too and become an ordinary game among their others.

The result is that a half-finished template, a seasonal one, or a template pulled
back for a rewrite has no resting place. The workarounds are all worse: leave it
live and let creators start games from an unfinished template, soft-delete it into
the 30-day trash, or keep a private note of which game id used to be a template.

Real instance: eight templates were seeded on 2026-09-02 and three more
(`bar-mitzva`, `hatuna`, `tnuat-noar`) were deliberately deferred. Had they been
seeded early and hidden, they could have been finished in place. They could not be.

## What Changes

- A template gains a **hidden** state. Hidden means: still a template, still owned
  and editable by the admin, still listed in the admin's builder — and not offered
  to creators.
- `listGameTemplates` (creator-facing) excludes hidden templates.
- `listAdminTemplates` (admin-facing) includes them, and reports the state so the
  builder can label them rather than silently showing an identical row.
- `setGameTemplateFlag` accepts the state, so hiding and unhiding is one call from
  the page that already exists.
- `createGameFromTemplate` **refuses a hidden template**. Hiding a row from a list
  is not hiding it from a callable: today any creator holding an id from before it
  was hidden could still instantiate it.
- The admin templates page gains a visibility control and a visible state on each
  row.
- **Not breaking.** A template with no stored state is VISIBLE, so every template
  that exists today behaves exactly as it does today.

## Capabilities

### New Capabilities
- `template-visibility`: whether a game flagged as a template is offered to
  creators, who may change that, which listings honour it, and what happens when
  somebody tries to instantiate a template that is not offered.

### Modified Capabilities
<!-- None. No existing spec in openspec/specs/ covers the template catalogue;
     `authorization` covers who may call admin callables, and that is unchanged —
     this change adds no new caller class and relaxes no existing check. -->

## Impact

**Callables** (`functions/src/admin/templates.ts`)
- `listGameTemplates` — a filter, and a new entry in `TEMPLATE_LIST_FIELDS`.
- `listAdminTemplates` — projection gains the state.
- `setGameTemplateFlag` — one more accepted, validated field.
- `createGameFromTemplate` — a new refusal path.

**Shared types** (`packages/shared/src/types/index.ts`)
- One optional field on `Game`, alongside the other `template*` fields.

**Creator web** (`apps/creator-web`)
- `AdminTemplatesPage.tsx` — a control and a row badge.
- `services/calls.ts` — the wrapper's argument and result types.
- `lib/templateCache.ts` — cached menus must not outlive a visibility change.
- i18n — two labels, both languages.

**Three known traps this change runs directly into**, all documented in CLAUDE.md
and each one a silent failure rather than an error:
1. `TEMPLATE_LIST_FIELDS` is a Firestore `.select()` field mask. A field absent
   from the mask arrives `undefined` on every document, so an in-memory filter on
   it passes everything and the feature looks implemented while doing nothing.
2. `where('field', '==', false)` does **not** match documents that lack the field.
   The tombstone filter already runs in memory for exactly this reason; the
   visibility filter must too, and absent must read as visible.
3. A list filter is not an authorization check. `createGameFromTemplate` takes an
   id and must do its own refusal.

**Not affected:** the composer, the mission bank, the smart-build questionnaire,
and `scripts/lib/siteTemplates.ts` — the seeder writes documents and does not read
the catalogue.
