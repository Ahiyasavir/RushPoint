## Context

`JoinScreen.tsx` is the only participant-facing surface that runs before anything else exists: no
team, no session, no map. Its two inputs are a string the participant typed or pasted, and an error
object from a callable. Both are currently handled inline in the component, which is why neither is
tested and why both leak implementation detail to the participant.

The server side is already correct and stays untouched:

- `normalizeAccessCode` (`packages/shared/src/validation.ts:201`) rejects non-strings, empty,
  over-length and non-alphanumeric codes as a typed `ValidationError` before any doc path is built.
- `joinRun` (`functions/src/runs/index.ts:408`) is idempotent for a device that already joined
  (`alreadyJoined: true`, both for its own team and for a uid already attached to another team) and
  enforces capacity inside a transaction.

So this change is confined to the client's two pure decisions.

## Goals / Non-Goals

Goals

- A code the participant believes they entered correctly is accepted whenever the characters are
  actually there, whatever the phone, the keyboard or the group chat wrapped around them.
- Every failure reachable from `getJoinInfo` / `joinRun` reads as one localized sentence that names
  the next move.

Non-Goals

- No relaxation of any server rule, and no client-side eligibility decision. The client never
  decides that a run is joinable.
- No look-alike character substitution (see D2).
- No consent or age-gate UI (see "Deliberately left").
- No redesign of the screen, no change to the registration step, no new callable.

## Decisions

### D1. Normalization is one pure total function, applied at three points

`normalizeJoinCodeInput(raw: unknown): string` in `apps/play-web/src/lib/joinCode.ts`.

Order of operations, chosen so each step cannot undo the previous one:

1. Non-string input returns `''` (the field is also fed from a deep-link param of unknown shape).
2. Trim. The bidi/format characters an RTL paste carries (`U+200E/200F`, `U+202A-202E`,
   `U+2066-2069`, `U+FEFF`) need no dedicated step: they sit outside the code itself, so the URL
   match in step 3 still finds the code, and step 5 removes them with every other non-alphanumeric.
3. If the string contains `code=<alphanumerics>` (case-insensitive), take that group and stop
   looking. This is the shape of every link the app itself produces (`?code=ABC123`,
   `&code=ABC123`), and it is the only reliable way to find a code inside a URL.
4. Otherwise, if the string contains `://`, keep only the part after the last `/` so a
   `https://host/path/ABC123` style link cannot contribute its host and scheme letters.
5. Drop every character outside `[A-Za-z0-9]`. This covers spaces (leading, trailing, internal),
   dashes (the repo's no-dashes convention means a dash in a code is always noise), punctuation and
   any non-ASCII the keyboard produced.
6. Upper-case, then truncate to `MAX_JOIN_CODE_LEN`.

`MAX_JOIN_CODE_LEN = 12`. Generated codes are 6 characters (`generateCode`,
`functions/src/runs/index.ts:174`); the headroom covers hand-authored seed/demo codes (for example
the 7-character playtest code) without letting a pasted essay reach the callable. The truncation
lives here and NOT on the input element: `maxLength={8}` is what silently ate the pasted link,
because the browser truncates a paste before `onChange` fires.

### D2. Look-alike characters are NOT substituted, and that is asserted

The access-code alphabet is `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — it already excludes `I`, `O`, `0`
and `1` precisely so codes cannot be misread. A participant who types `O` therefore has no valid
target character: `0` is not in the alphabet either. Any substitution table would submit a code the
participant did not type, turning "you mistyped one character" into "the app tried a different
code", and it can never be right more often than it is wrong. So `O`, `0`, `I`, `1` and `l` are
passed through unchanged (only case-folded), and the test suite pins that behaviour so nobody adds a
substitution table later without deciding this again.

### D3. Error mapping is one pure total function over the callable's error code

`joinErrorKey(e: unknown): JoinErrorKey` in the same module, where
`JoinErrorKey = 'invalidCode' | 'revoked' | 'finished' | 'full' | 'connection' | 'unknown'`.

The code is read from `e.code`, with the `functions/` prefix stripped (the Firebase JS SDK reports
`functions/not-found`, the emulator sometimes reports `not-found`).

| callable code | key | thrown by |
| --- | --- | --- |
| `not-found`, `invalid-argument` | `invalidCode` | unknown code, or a code the validator refused |
| `permission-denied` | `revoked` | `getJoinInfo:371`, `joinRun:455` |
| `failed-precondition` | `finished` | `joinRun:487` |
| `resource-exhausted` | `full` | the capacity transaction, `joinRun:529` and the device ceiling |
| `unavailable`, `internal`, `deadline-exceeded`, `unauthenticated`, `aborted`, `cancelled` | `connection` | transport, cold start, anonymous sign-in not yet settled |
| anything else, no code, a non-Error throw | `unknown` | by construction |

The function is total: every input, including `null`, `undefined`, a string, a plain object and an
`Error` with no `code`, returns a key. It returns a KEY, not a sentence, so the copy stays in
`i18n.ts` and the mapping stays testable without a React tree.

`unauthenticated` is treated as a connection problem on purpose. On this screen it means anonymous
sign-in has not landed yet, which the participant fixes by waiting or retrying, not by re-reading
the code.

### D4. The copy names the next move

One sentence per key, HE and EN, no em-dashes:

| key | Hebrew | English |
| --- | --- | --- |
| `invalidCode` | הקוד לא נמצא. בדקו את הקוד מול המארגן ונסו שוב. | We could not find that code. Check it with your host and try again. |
| `codeRevoked` | הקוד הזה כבר לא פעיל. בקשו מהמארגן קוד חדש. | This code is no longer active. Ask your host for a new one. |
| `finished` | המירוץ הזה כבר הסתיים. אם זו הפתעה, בקשו מהמארגן את הקוד העדכני. | This race has already finished. If that is a surprise, ask your host for the current code. |
| `gameFull` | המירוץ מלא. עדכנו את המארגן, הוא יכול לפתוח עוד מקומות. | This race is full. Tell your host, they can open more spots. |
| `connectionError` | בעיית חיבור. בדקו את הקליטה ונסו שוב. | Connection problem. Check your connection and try again. |
| `joinFailed` | ההצטרפות לא עברה. נסו שוב, ואם זה חוזר פנו למארגן. | The join did not go through. Try again, and if it keeps happening ask your host. |

`connectionError` is unchanged; `invalidCode`, `finished`, `gameFull` and `joinFailed` are rewritten
in place (same keys, so no other caller breaks); `codeRevoked` is new.

### D5. What the screen does with them

- `onChange` stores `normalizeJoinCodeInput(e.target.value)`, so the field always displays exactly
  what will be sent. The deep-link code goes through the same function at mount.
- `maxLength` is removed from the code input.
- Each of `lookup`, `submit` and `attach` sends `normalizeJoinCodeInput(code)`.
- `joinError(e)` becomes a lookup of `joinErrorKey(e)` in a `t.join.*` table.
- `attach` maps `connection` to the connection copy and everything else to the existing
  `t.devices.attachFailed`, which already says what to do about a wrong team code.

## Risks / Trade-offs

- **Silent truncation at 12 characters.** A participant pasting a longer string sees it cut. This is
  strictly better than the current 8-character cut, which was invisible for the exact input this
  change is about, and no real code approaches 12.
- **Stripping non-alphanumerics is unconditional.** A future code format containing a separator
  would be mangled. The repo's no-dashes convention (`scripts/test-no-dashes.ts`) and the generator
  both make that a deliberate, breaking change that would come here anyway.
- **`aborted` / `cancelled` mapped to connection.** If either ever came from a real business rule it
  would read as a network blip. Neither is thrown on this path today.

## Test Strategy

New `scripts/test-join-code.ts` (tsx assertion script, house `check(label, cond)` style, picked up
by `scripts/run-unit-tests.mjs`, no emulator). It imports the pure module directly and also greps
`JoinScreen.tsx` for the wiring, so the pure function cannot pass while the screen still uses the
old inline logic.

`normalizeJoinCodeInput`:

- lower-case `abc123` becomes `ABC123`;
- surrounding whitespace, tabs and newlines are removed;
- an internal space (`AB C123`) is removed;
- a dash (`ABC-123`) is removed;
- a pasted full link `https://play.example.com/?code=abc123&ref=x` yields `ABC123`, and the
  `&code=` and uppercase `CODE=` variants too;
- a pasted link with no code parameter contributes no scheme or host letters;
- an RTL-marked paste (`‏ ABC123 ‎`) yields `ABC123`;
- empty, whitespace-only, `null`, `undefined`, a number and an object all yield `''`;
- a 200-character string yields exactly `MAX_JOIN_CODE_LEN` characters;
- idempotence: normalizing a normalized value is a no-op, over every fixture;
- the output always matches `/^[A-Z0-9]*$/`, over every fixture;
- look-alikes are NOT substituted: `o0i1l` yields `O0I1L`.

`joinErrorKey`: every row of the D3 table, plus `functions/`-prefixed variants, plus an unknown code
(`something-else`), an `Error` with no code, a bare string, `null` and `undefined`.

Wiring guards over `JoinScreen.tsx` source: it imports from `lib/joinCode`, calls
`normalizeJoinCodeInput` in the code input's `onChange`, calls `joinErrorKey`, no longer carries
`maxLength={8}` on the code input, and no longer falls back to a raw `e.message`.

Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run bundle:budget`, `npm run i18n:check:strict`.

Not run here (a live playtest stack serves from this tree): `npm run e2e`. The assertions that
belong there and were NOT added: `joinRun` with a lower-case code and with surrounding whitespace
both resolve the same run as the canonical code, and a second `joinRun` from the same uid returns
`alreadyJoined: true` without incrementing `participantCount`. No callable is added or removed, so
the e2e callable-coverage guard is unaffected.

## Deliberately left

- **Guardian consent has no participant-facing surface at all.** `startTeams` holds a minor's team
  via `partitionTeamsByConsent` (`functions/src/runs/index.ts:614`), and `apps/play-web` contains no
  occurrence of "consent". A held participant joins normally and then waits on the registered screen
  with no explanation while everyone else starts. Building that flow, and writing the legal copy it
  needs, is out of scope here and is reported rather than invented.
- **Double submit is already guarded.** `useAsyncAction` / `createAsyncGuard` is a real in-flight
  guard held for the whole promise (`apps/play-web/src/hooks/useAsyncAction.ts`), and
  `JoinScreen.tsx:162-165` wraps all three actions in it. Nothing to fix.
- **The returning participant is already handled.** `resolvePlayRoute`
  (`apps/play-web/src/lib/playRoute.ts:142`) resumes a stored session, and re-scanning the same
  code resolves to `play` rather than a rejoin; a genuine rejoin is idempotent server-side.
- **`runStatus === 'draft'`** is not surfaced. An access code only exists once a run has launched,
  so it is unreachable from this screen.
