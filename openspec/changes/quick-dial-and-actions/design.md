## Decisions

### D1: numbers are normalised once

`packages/shared/src/phoneLink.ts` (pure): `toTelHref(raw)` and `toWhatsAppHref(raw)` with Israeli
defaults (`05X-XXXXXXX` → `+9725X…`; `+` numbers kept; anything unparsable ⇒ `null`, no link
rendered). Total. The display keeps what the person typed.

### D2: where contacts live

`Run.contacts?: { id, label, phone, visibleTo: ('players' | 'staff')[] }[]` (max 5), written only by
`setRunContacts` (owner/admin; audited; validation through D1, a number that does not parse is
refused with a message). On the RUN, not the game: a phone number for tonight's event is an
operational fact (the CLAUDE.md run-override rule). The console pre-fills the first contact from the
creator's own profile phone if they saved one before (optional field on `users/{uid}`).

Delivery:
- players: `getMyTeamState` adds `contacts` filtered to `visibleTo ⊇ players` (run doc is already read
  there via `cachedGetDoc`; zero added reads).
- staff: `staffGrants` payload / staff session bootstrap returns `visibleTo ⊇ staff`.

### D3: a team's number

The game's registration fields of type `phone` are looked up by id; the team page and staff app show
call/WhatsApp for each non-empty value (team-level first, then members). Staff visibility follows
`staff-capabilities`: a new capability `contactTeams` (default in "judge" and "full"). Honest
limitation, stated in the UI copy for organizers: staff can already read the raw team document for
their run, so the capability hides the button, not the data; field-level projection for staff is a
separate hardening change.

### D4: the quick-actions catalogue

`packages/shared/src/quickActions.ts`: a closed list of action ids with `{ needsTeam: boolean,
capability?: StaffCapability, ownerOnly?: boolean }`. The console maps each id to the handler it
already has (no new behaviour, only a shortcut). Default set: message all teams, open photo queue,
add points, find a team, call HQ (if set). Max 6.

Storage: organizer → `users/{uid}.consolePrefs = { quickActions: string[] }` written as a NESTED
object with `set(..., { merge: true })` (never a dotted key; CLAUDE.md footgun); unknown ids dropped
on read (total), so removing an action from the catalogue can never break a saved bar. Staff → device
`localStorage`, try/catch.

### D5: the bar

Under the run header, above the section tabs of `run-console-tabs-up-front`; horizontally
scrollable chips on a phone (it is a chip row, not navigation). "Customise" opens a sheet with the
catalogue as toggles and drag-to-reorder (dnd-kit is already in creator-web). A team-needing action
opens a searchable team picker (reuses `teamSearch`).

## Test strategy

- Pure: `scripts/test-phone-link.ts` (Israeli mobile/landline, spaces/dashes, `+972`, garbage);
  `scripts/test-quick-actions.ts` (catalogue totality, unknown ids dropped, max 6, capability filter).
- e2e: `setRunContacts` owner-only (authz matrix: participant/stranger/staff denied), invalid phone
  refused, `getMyTeamState` returns only player-visible contacts, a staff session returns staff-visible
  ones; callable coverage guard.
- UI via preview: set a contact, see "call the organizer" in the player's SOS sheet; add/reorder
  quick actions, reload on another browser profile and see the same bar; team page shows call/WhatsApp
  for a game with a phone registration field. `i18n:check:strict`, tap-target guard.
