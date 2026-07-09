## ADDED Requirements

### Requirement: Common UI primitives are single-sourced yet theme-agnostic
Shared UI primitives SHALL be single-sourced yet theme-agnostic. UI primitives whose shape is
shared between the creator and participant apps (`Button`, `Card`, `Input`, `Textarea`, `Select`,
`Label`, `Badge`, `Skeleton`, `EmptyState`, `Spinner`) SHALL be defined exactly once in the shared
UI package and consumed by both apps. These shared primitives
SHALL NOT hardcode a fixed color palette (no baked-in zinc shade or literal theme color); their
themed appearance SHALL be driven by semantic tokens / variant props supplied per app, so the same
component renders correctly under the creator app's dark theme and the participant app's light
(reversed-zinc) theme. A primitive that exists in only one app (creator's `Advanced`, the
participant app's `Progress` and `Screen`) MAY remain local to that app and SHALL NOT be forced
into the shared package.

#### Scenario: A shared primitive renders correctly in both themes
- **WHEN** the same shared `Button` (or `Card`, `Input`, `Badge`, `Skeleton`) is rendered in the
  creator app (dark) and in the participant app (light, reversed zinc)
- **THEN** each instance takes on its own app's theme through the supplied tokens, and its rendered
  appearance is identical to what that app displayed before the primitive was single-sourced

#### Scenario: Shared primitives carry no hardcoded palette
- **WHEN** a shared primitive is inspected
- **THEN** its styling is expressed through semantic tokens / variant props (not a fixed color
  literal), so neither app's theme can break the other's

#### Scenario: App-specific primitives stay per app
- **WHEN** a component exists in only one app (e.g. `Progress`, `Screen`, `Advanced`)
- **THEN** it remains defined in that app and is not moved into the shared UI package

### Requirement: The HQ↔team chat thread is single-sourced
The HQ↔team chat thread SHALL be single-sourced. The chat thread UI (message-thread subscription,
unread bookkeeping, expand/collapse, message bubbles, and reply box) SHALL be defined once as a
shared component and reused by both the
creator Run Console and the participant Staff Console, rather than duplicated. The shared component
SHALL receive its display copy and its theme tokens from the consuming app (so no user-facing
string or palette is baked into the shared package) and SHALL preserve the RTL-safe conventions
(`dir="auto"`, logical `text-start` / `ms-*` classes) and the `CHAT_TEXT_MAX_LEN` input limit.

#### Scenario: Both consoles render the same shared thread
- **WHEN** the creator Run Console and the participant Staff Console each show the team chat
- **THEN** both render the single shared thread component — expand, unread badge, and reply behave
  identically — each themed for its own app, with no duplicated thread markup remaining

#### Scenario: Chat copy still switches language
- **WHEN** the app language is Hebrew or English
- **THEN** every chat label in the shared thread comes from that app's `t.*` dictionary (passed in
  as props), so it switches language and adds no hardcoded-string finding to `npm run i18n:check`

### Requirement: Truly-common translation keys are single-sourced
Truly-common translation keys SHALL be single-sourced. Keys that are genuinely common across both
apps (the brand name, generic actions such as cancel/confirm/ok/close, and the error-boundary copy)
SHALL derive from one shared base dictionary in `he` and `en`, which each app's dictionary extends. App-specific namespaces SHALL
remain owned by each app. The shared base SHALL preserve the existing i18n correctness invariants:
Hebrew values contain only Hebrew (plus the brand/units whitelist) and English values contain only
English, and after each app merges the base its `translations` still satisfies HE/EN key parity so
`npm run i18n:check` PART A stays green without changes to the checker.

#### Scenario: A common string has one source of truth
- **WHEN** the shared base value for a common key (e.g. the error-boundary title) is changed
- **THEN** both apps reflect the change, because each app's `common` namespace extends the shared
  base rather than holding its own duplicate literal

#### Scenario: The dictionary purity + parity gate stays green
- **WHEN** `npm run i18n:check` runs after the base is extracted and merged into both apps
- **THEN** PART A passes for each app (identical HE/EN key sets, same-key same-type, Hebrew has no
  English, English has no Hebrew), and no new hardcoded-string finding is introduced

#### Scenario: App-specific copy stays independent
- **WHEN** one app changes a string in its own namespace (e.g. creator's `runConsole`, play's
  `join`)
- **THEN** the other app is unaffected, because only the truly-common keys are shared
