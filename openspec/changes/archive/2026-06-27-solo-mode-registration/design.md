## Context

`JoinScreen.tsx` (step 2) computes:
- `teamFields = info.registrationFields.filter(f => f.level === 'team')`
- `memberFields = info.registrationFields.filter(f => f.level === 'member')`
and renders all `teamFields` (which may include a team-name text field), then a member block whose
heading switches on `info.mode === 'team'` ('Team members' vs 'Your name'). `displayName` is computed
as `values['teamName'] || memberNames[0] || 'Team'`.

`GameMode = 'individual' | 'team'` and `FieldLevel = 'team' | 'member'` already exist in
`packages/shared/src/types/index.ts`. `DEFAULT_REGISTRATION_FIELDS` is a single member-level `name`
field. The redundancy: a game may also carry a team-level name field, which is meaningless in solo.

## Goals / Non-Goals

**Goals:** mode-aware pure helpers + JoinScreen wiring so solo shows one name field; team unchanged.

**Non-Goals:** callable changes, server validation changes, creator-side field config changes.

## Decisions

### D1 — Pure helpers in `packages/shared/src/registration.ts`
- `isNameField(f)`: a field whose `id === 'name'` or whose `type === 'text'` and label matches a
  name pattern — kept narrow: treat `id === 'name'` (the canonical member name) and any team-level
  field flagged as the team's name (`id === 'teamName'`) as "name fields".
- `resolveRegistrationFields(mode, fields)`:
  - `team` → return `fields` unchanged.
  - `individual` → drop team-level name fields (`level==='team'` && name-like); keep at most one
    member name field; keep all non-name custom fields. Result has exactly one name-type field.
- `resolveDisplayName(mode, values, memberNames)`:
  - `individual` → first non-empty of `memberNames` (the single player name), else `values.name`.
  - `team` → `values.teamName || memberNames[0] || 'Team'` (preserves current behavior).

### D2 — JoinScreen consumes the helpers
Replace the inline `teamFields`/`memberFields`/`displayName` logic with the helpers. In individual
mode render one `<Input>` (label from i18n `join.yourName`), no member-list controls, no add-member
button, no team-name field. In team mode the existing UI is kept.

### D3 — Keep `joinRun` contract
`submit()` still sends `{ displayName, registrationData: values, memberNames }`. In solo,
`memberNames` is the single name array `[playerName]`; `displayName` equals it. No server change.

## Test strategy

**Pure logic** — `scripts/test-registration-fields.ts` (aggregator-picked):
1. `resolveRegistrationFields('individual', [teamNameField, memberNameField, ageField])` → exactly
   one name field (the member name), no team-level name field, `ageField` retained.
2. `resolveRegistrationFields('team', sameFields)` deep-equals the input (unchanged).
3. `resolveDisplayName('individual', {}, ['Dana'])` === `'Dana'`.
4. `resolveDisplayName('team', { teamName: 'Reds' }, ['Dana'])` === `'Reds'`.
5. Edge: individual mode with only `DEFAULT_REGISTRATION_FIELDS` → one name field, unchanged count.

**UI verification:** preview play-web join for a solo game (one name field) vs a team game
(team-name + member list).

## Risks / Trade-offs

- [Risk: name-field detection too broad/narrow] → restrict to canonical ids (`name`, `teamName`) plus
  `level` so custom text fields (e.g. "Nickname") are not accidentally dropped; tests pin this.
- [Trade-off: solo still posts `memberNames`] → harmless; the server already accepts it and scoring
  treats a solo team as a one-member team.
