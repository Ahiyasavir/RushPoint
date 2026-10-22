# Writing a mission into the bank

Only when he asks. The bank is `apps/creator-web/src/taskBank.ts` (`TASK_BANK`). Read its header
PRE-FLIGHT (nine items) before adding anything; the full numbered rules are a reference.

## Entry shape (`TaskBankEntry`)
```ts
{
  key: 'egg-teammate',            // stable, never reused
  sourceTemplateKey: 'mission-studio',
  family: 'ongoing-object',       // optional: groups near duplicates (one per game)
  tags: ['action', 'camera', 'teamwork', 'noPrep', 'fromAnywhere', 'youth', 'medium'],
  difficulty: 5,                  // MUST equal build().difficulty
  transitMinutes: 8,              // located missions only; omitted = 0
  setup: [PLACE_IT, { field: 'media', required: true, prompt: 'עברית\n\nEnglish' }],
  siting: 'never' | 'possible' | 'must',   // optional
  spot: 'bench' | 'bigTree' | 'sign' | 'openGrass' | 'entrance' | 'anyCorner',
  exclusiveStation: true,         // ONLY for one physical non-duplicable resource; then maxConcurrentTeams: 1
  build: () => anywhere({ title, description, type, difficulty, estimatedMinutes, pointValue, smart: upload(...) }),
}
```
Helpers in the file: `anywhere(...)` (locationless), `sited(...)` (pinned, `triggerMode: 'radius'`),
`base(...)`, `upload({ captureKind: 'video', videoMaxSeconds: 30 })`, `PLACE_IT`, `ATTACH_PHOTO`,
`SET_CODE`, `codeStation(...)`, `OPEN_SPACE_CAPACITY` (use for public spots with no scarcity).

Task types: `field`, `self_report`, `smart_station`, `photo`, `quiz` (`answers[]`), `numeric`
(`numericAnswer`, `numericTolerance`), `geofence` (`geofenceRadiusMeters`), `sequence` (`steps[]`).
Useful fields: `timeLimitMinutes`, `hint` + `hintPenalty`, `pausesTimer`, `hideLocation` +
`locationClue` (no pin on the map; the clue guides; `locationHidden` is only what the player
payload carries, never set it on a Task).

## Tags (from `bankTags.ts`)
- bookend: `start`, `finish`
- activity: `action`, `camera`, `thinking`, `teamwork`, `creative`, `educational`, `chores`
- setting: `outdoor`, `indoor`, `fromAnywhere`, `locationBased`
- area: `forest`, `beach`, `park`, `neighborhood`, `cityCenter`, `home`, `mall`, `office`, `school`, `crowded`, `historic`
- prep: `noPrep`, `needsSetup`, `needsPartner`
- audience: `kids`, `youth`, `adults`, `corporate`, `mixed`
- difficulty band: `easy`, `medium`, `hard` (must match `difficulty`)
- mechanic (descriptive, 2026-10-22): `strangers`, `hunt`, `puzzle`, `navigation`, `observation`,
  `physical`, `againstClock`, `building`, `performance`, `humor`, `dare`, `splitUp`, `nature`,
  `kindness`, `music`, `history`, `ongoing`, `versus`, `record`, `calm`. EVERY mission carries every
  one that is true of it (he: "לכל משימה תכניס הרבה תיוגים שהם רלוונטיים"). A `strangers` mission
  also carries `crowded`; a mission about the past at a real place also carries `historic`.

Tag what is true, not what flatters (bank rule 13). `mixed` claims it suits ten year olds AND a
corporate offsite; it usually is false. Anything the creator must arrange is `needsSetup`, and
every such action gets a Quick Setup step (bilingual prompt "עברית\n\nEnglish").

The old rule 71 gate ("a crowded photo mission must say ask permission") was removed on
2026-10-22 at his request; do not re-add the phrase or the gate.

## Tests to run after editing
```bash
npx tsx scripts/test-task-bank.ts
npx tsx scripts/test-task-bank-tag-laws.ts
npx tsx scripts/test-task-bank-setup-quality.ts
npx tsx scripts/test-bank-tags.ts
npx tsx scripts/test-hebrew-voice.ts
npx tsx scripts/test-source-control-chars.ts
```
Then the project gates in CLAUDE.md (`npm run verify` at least). Never pipe a gate into
`head`/`tail` and trust the exit code.
