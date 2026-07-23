## Why

Joining is the first thing every participant does, and it happens in the worst conditions: a whole
group at once, outdoors, on cellular, with the host watching. Two dead ends were confirmed by
reading this working tree.

1. **The code field destroys a pasted join link.** `JoinScreen.tsx:242` uppercases the raw input and
   `JoinScreen.tsx:258` caps the field at `maxLength={8}`. A participant who copies the WhatsApp
   link instead of tapping it (`https://…/?code=ABC123`) has the paste truncated by the browser to
   `HTTPS://` before `onChange` ever runs, and then sees "invalid code". The same field also passes
   an internal space straight through to the server (`code.trim().toUpperCase()` at
   `JoinScreen.tsx:93`), where `normalizeAccessCode` rejects it as non-alphanumeric
   (`packages/shared/src/validation.ts:206`) and it comes back as the same flat "invalid code". A
   dash typed out of habit does the same thing.
2. **Half of the join failures are shown in raw English server prose.** `joinError`
   (`JoinScreen.tsx:80-87`) maps only `resource-exhausted`, the connection codes, `not-found` and
   `invalid-argument`; everything else falls through to `e.message`. The two most likely non-network
   failures at an event fall through:
   - a finished run, thrown as `failed-precondition` with the literal string
     `'This race has already finished.'` (`functions/src/runs/index.ts:487`);
   - a revoked code, thrown as `permission-denied` with `'This code has been revoked'`
     (`functions/src/runs/index.ts:455`) and `'Code revoked'` from `getJoinInfo`
     (`functions/src/runs/index.ts:371`).

   The app is Hebrew by default, so a teenager reads an English sentence written for the host, with
   nothing to do next. The existing localized strings that DO fire are equally actionless: "קוד לא
   תקין", "המשחק מלא, בדקו מול המארגן".

## What Changes

**The code field forgives everything a phone and a group chat do to a code.** A new pure
`normalizeJoinCodeInput()` in `apps/play-web/src/lib/joinCode.ts` runs on every keystroke, on the
deep-link code, and again before each callable:

- a pasted join URL yields the value of its `code` parameter, never the URL;
- case, surrounding whitespace, internal spaces, dashes, punctuation and bidi/format characters are
  removed;
- the length cap moves off the DOM `maxLength` (which truncated the paste before we could read it)
  and into the normalizer.

Look-alike characters are deliberately NOT substituted, and a test pins that: the access-code
alphabet (`functions/src/runs/index.ts:175`) already excludes `I`, `O`, `0` and `1`, so a typed `O`
has no valid character to be rewritten into. Substituting would silently submit a DIFFERENT code
than the participant typed, which is worse than the honest failure.

**Every failure the callable can return becomes one localized, actionable sentence.** A pure
`joinErrorKey()` in the same module maps the callable's error code to one of `invalidCode`,
`revoked`, `finished`, `full`, `connection`, `unknown`. The screen renders `t.join.*` for that key,
in Hebrew and English, and each sentence names the next move (check the code with the host, ask for
a new code, ask for the current run's code, tell the host the run is full, check your signal, try
again). The raw-server-message fallback is gone.

The attach-a-second-phone path reuses the same mapper so a network blip there stops reading as a
wrong team code.

## Impact

- Affected specs: `participant-join` (two ADDED requirements).
- Affected code: `apps/play-web/src/lib/joinCode.ts` (new, pure),
  `apps/play-web/src/screens/JoinScreen.tsx` (input handler, `maxLength`, error mapping),
  `apps/play-web/src/i18n.ts` (HE + EN copy, additive), `scripts/test-join-code.ts` (new, in the
  no-emulator `npm test` lane).
- NOT touched: no server rule is relaxed, no eligibility decision moves to the client, no screen is
  redesigned, and no consent flow is added. `getJoinInfo`/`joinRun` stay authoritative; the client
  only cleans up what it sends and translates what it gets back.
