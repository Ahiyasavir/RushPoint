## 1. RED — GPS error-UX pure-logic tests (failing)

Write `scripts/test-gps-error-ux.ts` before touching production code.
Run `npm test`; confirm these tests fail for the right reason.

- [ ] 1.1 Create `scripts/test-gps-error-ux.ts`. Import `withLocation` from
  `apps/play-web/src/components/TaskRunner.tsx` (or extract it to a testable module first
  — see note in 2.1). Write the following assertions, all of which must FAIL now:
  ```
  test("withLocation — GPS denied: onDenied called, cb not called")
    mock getCurrentPosition to call its error callback
    assert onDenied() was called once
    assert cb was NOT called

  test("withLocation — geolocation absent: onDenied called, cb not called")
    delete navigator.geolocation from the test context
    assert onDenied() was called once
    assert cb was NOT called

  test("withLocation — GPS success: cb called with coordinates, onDenied not called")
    mock getCurrentPosition to call success with lat=32.08, lng=34.78
    assert cb(32.08, 34.78) was called
    assert onDenied was NOT called

  test("withLocation — no onDenied provided, GPS error: no crash")
    call withLocation(cb) with no second argument; mock error
    assert function does not throw
    assert cb was NOT called
  ```
- [ ] 1.2 Run `npm test`. Confirm tests fail (currently `withLocation` has no `onDenied`
  parameter and calls `cb(0, 0)` on error). Record the exact failure message.


## 2. GREEN — Implement withLocation onDenied + routing error handling

Minimum code to make the 1.x tests green.

- [ ] 2.1 Extract `withLocation` from the bottom of `TaskRunner.tsx` into a new module
  `apps/play-web/src/utils/withLocation.ts` so `test-gps-error-ux.ts` can import it
  without pulling in React. Update `TaskRunner.tsx` to import from the new path.
  Signature:
  ```ts
  export function withLocation(
    cb: (lat: number, lng: number) => void,
    onDenied?: () => void,
  ): void
  ```
  Implementation: on `GeolocationPositionError` (any code) or absent
  `navigator.geolocation`, call `onDenied?.()`. Remove the `() => cb(0, 0)` fallback
  entirely.
- [ ] 2.2 In `TaskRunner.tsx`, update the `field()` async function to pass an `onDenied`
  callback:
  ```ts
  withLocation(
    async (lat, lng) => { /* existing completeTask call */ },
    () => setMsg(t.task.gpsWarning),
  );
  ```
  Set `setBusy(false)` in both the success path's `finally` block AND in `onDenied`. After
  setting the GPS warning message, re-enable the button (do NOT lock `busy` to `true`).
- [ ] 2.3 Update the routing `useEffect` (the one that calls `requestNextTask` when no task
  is assigned). Add a `routingError` state variable. Wrap the `requestNextTask` call in a
  try/catch that sets `routingError`. Render:
  - While in-flight (`busy`): `<Card>{t.task.routing}</Card>`
  - On error: a Card with `t.task.routingError` text and a `<Button onClick={retry}>{t.task.retryRouting}</Button>` that resets `routingError` and calls `requestNextTask` again.
  - On success: existing `onChanged()` path; clear `routingError`.
- [ ] 2.4 Run `npm test`. Confirm the 1.x tests are now GREEN. Fix any regressions.


## 3. GREEN — GeofenceAuto + DistanceBadge GPS improvements

No new test required beyond the existing `test-gps-error-ux.ts` (these are UI-only paths
that will be verified via preview in step 3.2).

- [ ] 3.1 In `GeofenceAuto` in `TaskRunner.tsx`, replace the `() => undefined` error
  callback of `watchPosition` with a callback that:
  - Sets a `gpsError` state variable to `true`
  - Calls `navigator.geolocation.clearWatch(id)` (stop retrying)
  Render an error state when `gpsError === true`:
  ```tsx
  <div className="text-center py-2 space-y-2">
    <div className="text-3xl">📡</div>
    <p className="text-sm text-rp-alert font-medium">{t.task.gpsUnavailable}</p>
    <p className="text-xs text-zinc-500">{t.task.gpsContactHost}</p>
  </div>
  ```
- [ ] 3.2 In `DistanceBadge`, replace `navigator.geolocation.getCurrentPosition` with
  `navigator.geolocation.watchPosition`. In the `useEffect` cleanup, call
  `navigator.geolocation.clearWatch(id)`. The rest of the logic is unchanged (compute
  `haversineKm`, call `setDist`). Errors in `watchPosition` are silently ignored (no
  badge shown is the existing correct behavior for absent coords).
- [ ] 3.3 Verify via preview: start the dev stack, load a game with a geofence task, deny
  GPS — confirm the error text appears. Enable GPS — confirm the distance badge updates
  in real time as position changes.


## 4. RED — i18n parity tests for `task` + `final` namespaces (failing)

Extend the existing parity test to cover the two new namespaces BEFORE adding the keys.

- [ ] 4.1 Read `scripts/test-i18n-parity.ts`. Extend it to assert:
  - `t.task` exists in both `HE` and `EN`
  - Every key listed in `specs/taskrunner-i18n/spec.md` table exists in `HE.task`
  - Every key listed in `specs/finalscreen-i18n/spec.md` table exists in `HE.final`
  - `typeof HE` TypeScript constraint still compiles (verified by `npm run typecheck`)
  - All fn-type keys are functions (use `typeof val === 'function'`)
- [ ] 4.2 Run `npm test`. Confirm failure: `t.task` and `t.final` do not exist yet. Record
  the exact missing-key list.


## 5. GREEN — Add `task` and `final` namespaces to i18n.ts

- [ ] 5.1 In `apps/play-web/src/i18n.ts`, add the `task` namespace to the `HE` object with
  all 28 keys from `specs/play-web-i18n-hebrew/spec.md`'s HE table. Function-valued keys
  (marked `(fn)`) must be typed as arrow functions taking an object of named params.
  Example: `stopOf: ({ done, total }: { done: number; total: number }) => ...`
- [ ] 5.2 In `apps/play-web/src/i18n.ts`, add the `final` namespace to the `HE` object with
  all 20 keys from `specs/play-web-i18n-hebrew/spec.md`'s HE table, including the three
  `shareText`/`shareRankPart`/`shareTimePart` function keys.
- [ ] 5.3 Add the `task` namespace to the `EN` object with all English values from
  `specs/taskrunner-i18n/spec.md`.
- [ ] 5.4 Add the `final` namespace to the `EN` object with all English values from
  `specs/finalscreen-i18n/spec.md`.
- [ ] 5.5 Run `npm run typecheck`. The `typeof HE` constraint on `EN` must compile without
  error — any missing key in `EN` will appear here. Fix until green.
- [ ] 5.6 Run `npm test`. Confirm the 4.x tests are now GREEN.


## 6. GREEN — Wire TaskRunner to useT()

- [ ] 6.1 At the top of `TaskRunner.tsx`, add `const { t } = useT();`. Replace every
  hardcoded string in the component and sub-components with the corresponding `t.task.*`
  key. Full list (use the spec table as the checklist):
  - `"Finding your next task…"` → `t.task.routing`
  - `"Your task"` → `t.task.yourTask`
  - `"Routed task"` → `t.task.routedTask`
  - `"Stop N of M"` → `t.task.stopOf({ done: completedHere + 1, total: requiredHere })`
  - `"Mark complete"` → `t.task.markComplete`
  - `"I'm here"` → `t.task.imHere`
  - `"Verify"` (CodeEntry) → `t.task.verify`
  - `"Wrong code. Try again."` → `t.task.wrongCode`
  - `"Your answer"` (QuizEntry) → `t.task.yourAnswer`
  - `"Submit answer"` (QuizEntry) → `t.task.submitAnswer`
  - `"Enter a number"` (NumericEntry) → `t.task.enterNumber`
  - `"Submit"` (NumericEntry) → `t.task.submit`
  - `"Uploading photo…"` → `t.task.uploadingPhoto`
  - `"Approved!"` → `t.task.approved`
  - `"Submitted. Waiting for review."` → `t.task.pendingReview`
  - `"Submit photo"` (PhotoEntry) → `t.task.submitPhoto`
  - `"Working…"` (PhotoEntry) → `t.task.working`
  - `"…or paste a photo URL"` → `t.task.pastePhotoUrl`
  - `"Stuck? Reveal a hint (−N pts)"` → `` `💡 ${t.task.hintStuck({ cost: task.hintPenalty ?? 25 })}` ``
  - `"Step N of M"` (SequenceRunner) → `t.task.stepOf({ step: idx + 1, total: steps.length })`
  - `"Answer (or leave blank to confirm)"` → `t.task.stepAnswer`
  - `"Submit step"` → `t.task.submitStep`
  - `"Finding your location…"` (GeofenceAuto) → `t.task.findingLocation`
  - `"You're here! Checking in…"` → `t.task.youreHere`
  - `"N m away. Walk closer…"` → `t.task.walkCloser({ dist: Math.round(dist), radius })`
  - Routing error messages from 2.3 → `t.task.routingError`, `t.task.retryRouting`
  - GPS warning from 2.2 → `t.task.gpsWarning`
  - GeofenceAuto error text from 3.1 → `t.task.gpsUnavailable`, `t.task.gpsContactHost`
  - Distance badge: `"{N} m away"` / `"{N} km away"` — keep the numeric format but use
    `t.task.walkCloser`-style interpolation is not applicable here since it is already
    a one-liner — leave the `m away` / `km away` unit strings as-is (unit abbreviations
    are whitelisted).
- [ ] 6.2 Pass `t` down to sub-components that are defined outside `TaskRunner` (e.g.,
  `CodeEntry`, `QuizEntry`, `NumericEntry`, `PhotoEntry`, `GeofenceAuto`, `SequenceRunner`)
  by adding a `t: T['task']` prop to each, OR by calling `useT()` at the top of each
  sub-component that is defined as a standalone function. Choose the `useT()` inside
  each sub-component approach (less prop-drilling).
- [ ] 6.3 Run `npm run typecheck` and `npm run lint` (0 errors). Fix all TypeScript and lint
  errors before proceeding.


## 7. GREEN — Wire FinalScreen to useT() + fix share text language

- [ ] 7.1 In `FinalScreen.tsx`, add `const { t, lang } = useT();`. Replace every hardcoded
  string with the corresponding `t.final.*` key. Full list:
  - `"Finished!"` → `t.final.title`
  - `"{name}, you completed every stage."` → `t.final.subtitle({ name: team.displayName })`
  - `"Final Score"` → `t.final.scoreLabel`
  - `"Rank #{n}"` → `t.final.rankLabel({ rank: myRank })`
  - `"Your race, wrapped"` → `t.final.recapTitle`
  - `"Total time"` → `t.final.statTotalTime`
  - `"Stages done"` → `t.final.statStages`
  - `"Fastest stage"` → `t.final.statFastest`
  - `"Hints used"` → `t.final.statHints`
  - `"Share my result"` → `t.final.shareBtn`
  - `"Creating…"` → `t.final.shareCreating`
  - `"✓ Saved!"` → `t.final.shareSaved`
  - `"Leaderboard"` → `t.final.leaderboardTitle`
  - `"Waiting for the host to finalize the leaderboard…"` → `t.final.waitingFinalize`
  - `"Powered by RushPoint"` → `t.final.poweredBy`
  - `"Build your own race, free →"` → `t.final.buildOwn`
  - `"Leave"` → `t.final.leave`
- [ ] 7.2 Rewrite the `share()` function's `text` variable to use `t.final.shareText`:
  ```ts
  const rankPart = myRank ? t.final.shareRankPart({ rank: myRank }) : '';
  const timePart = totalSec != null ? t.final.shareTimePart({ time: fmtDuration(totalSec) }) : '';
  const text = t.final.shareText({
    team: team.displayName,
    game: game.branding?.name ?? game.title,
    rankPart,
    timePart,
    url: CREATOR_URL.replace(/^https?:\/\//, ''),
  });
  ```
  Remove the hardcoded Hebrew template string entirely.
- [ ] 7.3 Run `npm run typecheck` and `npm run lint`. Fix all errors.


## 8. RED — Photo URL validation e2e test (failing)

Add the failing assertion to `scripts/e2e-verify.mjs` before touching the server.

- [ ] 8.1 In `scripts/e2e-verify.mjs`, after the existing photo-submission section, add:
  ```js
  // [RED] submitStationPhoto — external URL must be rejected
  try {
    await submitStationPhoto({
      ...ctx,
      teamId: testTeamId,
      taskId: photoTaskId,
      photoUrl: 'https://example.com/evil.jpg',
    });
    throw new Error('Expected INVALID_ARGUMENT but call succeeded');
  } catch (e) {
    assert(e.code === 'invalid-argument', `Expected invalid-argument, got: ${e.code}`);
    console.log('✓ submitStationPhoto rejects external URL');
  }
  ```
- [ ] 8.2 Run `npm run e2e`. Confirm the test FAILS (currently the call succeeds).


## 9a. RED — Photo URL validation pure-logic test (failing)

- [ ] 9a.1 Create `scripts/test-photo-url-validation.ts` that imports the helper from shared
  (the import fails until 9b.1 adds it — that is the RED state):
  ```ts
  import assert from 'node:assert/strict';
  import { isFirebaseStorageUrl } from '../packages/shared/src/validation';

  assert(isFirebaseStorageUrl('https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/o/runs%2F...'), 'valid URL accepted');
  assert(!isFirebaseStorageUrl('https://example.com/photo.jpg'), 'external URL rejected');
  assert(!isFirebaseStorageUrl('http://firebasestorage.googleapis.com/...'), 'HTTP rejected');
  assert(!isFirebaseStorageUrl(''), 'empty string rejected');
  assert(!isFirebaseStorageUrl('javascript:alert(1)'), 'JS URL rejected');
  assert(!isFirebaseStorageUrl(undefined as unknown as string), 'non-string rejected');
  console.log('PASS photo-url-validation');
  ```
  > The aggregator auto-discovers `scripts/test-*.ts`; no manual registration needed.
- [ ] 9a.2 Run `npm test`. Confirm FAILURE — `isFirebaseStorageUrl` is not exported from
  `packages/shared/src/validation.ts` yet.

## 9b. GREEN — Server-side photo URL validation (shared helper)

- [ ] 9b.1 In `packages/shared/src/validation.ts`, add and export the pure helper (no admin
  imports — it must stay importable by the unit-test lane):
  ```ts
  export const FIREBASE_STORAGE_ORIGIN =
    'https://firebasestorage.googleapis.com/v0/b/rushpoint-pwa-7daaa.appspot.com/';
  export function isFirebaseStorageUrl(url: unknown): boolean {
    return typeof url === 'string' && url.startsWith(FIREBASE_STORAGE_ORIGIN);
  }
  ```
  Confirm it is re-exported via `packages/shared/src/index.ts` (the `@rushpoint/shared`
  barrel) so functions can import `{ isFirebaseStorageUrl }` from `@rushpoint/shared`.
- [ ] 9b.2 In `functions/src/runs/index.ts`, import the helper from `@rushpoint/shared`. At the
  start of `submitStationPhoto` (before any Firestore read), add:
  ```ts
  if (!isFirebaseStorageUrl(data.photoUrl)) {
    throw new functions.https.HttpsError('invalid-argument', 'Photo URL must be a Firebase Storage URL.');
  }
  ```
- [ ] 9b.3 Run `npm test`. Confirm `test-photo-url-validation.ts` passes (`PASS photo-url-validation`).
- [ ] 9b.4 Run `npm run e2e`. Confirm the 8.x assertion now passes (external URL rejected).
  Confirm all other e2e assertions still pass.


## 10. GREEN — PhotoEntry object URL memory leak fix

- [ ] 10.1 In `PhotoEntry` inside `TaskRunner.tsx`, replace the direct `setPreview(...)` call
  with a `useEffect` pattern that revokes the previous URL:
  ```tsx
  const prevPreviewRef = useRef<string | null>(null);

  function pickFile(e: ...) {
    // ... existing validation ...
    const objectUrl = f ? URL.createObjectURL(f) : null;
    if (prevPreviewRef.current) {
      URL.revokeObjectURL(prevPreviewRef.current);
    }
    prevPreviewRef.current = objectUrl;
    setPreview(objectUrl);
    // ... rest unchanged
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (prevPreviewRef.current) URL.revokeObjectURL(prevPreviewRef.current);
    };
  }, []);
  ```
- [ ] 10.2 Run `npm run typecheck`. Fix any type errors.


## 11. GREEN — JoinScreen required field client-side validation

- [ ] 11.1 In `scripts/test-registration-fields.ts` (which already exists per the git
  status), add or extend assertions for a new helper `validateRequiredFields`:
  ```ts
  // Returns a Set of field IDs that are required but empty
  test("all filled — no errors")
    fields = [{ id: 'phone', required: true, ... }]
    values = { phone: '0501234567' }
    assert validateRequiredFields(fields, values).size === 0

  test("required field empty — returned in error set")
    fields = [{ id: 'phone', required: true, ... }]
    values = { phone: '' }
    assert validateRequiredFields(fields, values).has('phone')

  test("optional field empty — NOT in error set")
    fields = [{ id: 'note', required: false, ... }]
    values = {}
    assert validateRequiredFields(fields, values).size === 0

  test("checkbox required — false value is invalid")
    fields = [{ id: 'consent', type: 'checkbox', required: true, ... }]
    values = { consent: 'false' }
    assert validateRequiredFields(fields, values).has('consent')
  ```
  Run `npm test`, confirm the new tests FAIL (helper not yet exported).
- [ ] 11.2 In `packages/shared/src/registration.ts`, export the new helper:
  ```ts
  export function validateRequiredFields(
    fields: RegistrationField[],
    values: Record<string, string>,
  ): Set<string> {
    const errors = new Set<string>();
    for (const f of fields) {
      if (!f.required) continue;
      const v = values[f.id] ?? '';
      if (f.type === 'checkbox') { if (v !== 'true') errors.add(f.id); }
      else if (!v.trim()) errors.add(f.id);
    }
    return errors;
  }
  ```
  Ensure `packages/shared/src/index.ts` re-exports `validateRequiredFields`.
- [ ] 11.3 In `JoinScreen.tsx`, import `validateRequiredFields` from `@rushpoint/shared`.
  Add a `fieldErrors` state: `const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set())`.
  In `submit()`, before calling `joinRun`, run:
  ```ts
  const allFields = resolveRegistrationFields(info.mode, info.registrationFields);
  const errors = validateRequiredFields(allFields, values);
  if (errors.size > 0) { setFieldErrors(errors); setBusy(false); return; }
  setFieldErrors(new Set());
  ```
  In `FieldInput`, add a `hasError?: boolean` prop. When `hasError` is true, apply a
  red border class (`border-rp-alert`) to the input/select. In `JoinScreen`, pass
  `hasError={fieldErrors.has(f.id)}` to each `<FieldInput>`.
- [ ] 11.4 Run `npm test`. Confirm all `test-registration-fields.ts` tests pass.
- [ ] 11.5 Run `npm run typecheck` + `npm run lint`.


## 12. GREEN — BuilderPage error state

- [ ] 12.1 In `BuilderPage.tsx`, wrap the `getGame` call in a try/catch. Add an `error`
  state: `const [error, setError] = useState<string | null>(null)`.
  ```ts
  useEffect(() => {
    if (!gameId) return;
    void getGame({ gameId })
      .then(({ game }) => {
        setGame(game);
        savedSnapshot.current = serializeGame(game);
        setStatus('saved');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message.replace('Firebase: ', '') : 'Could not load game');
      });
  }, [gameId]);
  ```
  Render an error card when `error` is set (and `game` is still null):
  ```tsx
  if (error) return (
    <Card className="p-8 text-center space-y-4">
      <div className="text-3xl">⚠️</div>
      <p className="font-semibold text-[--ink-1]">Could not load game</p>
      <p className="text-sm text-[--ink-3]">{error}</p>
      <Button onClick={() => { setError(null); /* re-trigger effect via key trick or re-fetch */ }}>
        Try again
      </Button>
    </Card>
  );
  ```
  For the retry, use a `loadKey` counter state incremented on retry; include it in the
  `useEffect` deps array to re-run the load.
- [ ] 12.2 Run `npm run typecheck` + `npm run lint`.


## 13. GREEN — LocationPicker Nominatim production warning + DEPLOY.md

- [ ] 13.1 In `LocationPicker.tsx`, immediately after the `const KEY = ...` line, add:
  ```ts
  if (!KEY && import.meta.env.PROD) {
    console.warn(
      '[LocationPicker] VITE_MAPTILER_KEY is not set. ' +
      'The public Nominatim geocoder is used as a fallback. ' +
      'This violates the Nominatim Usage Policy and must not be used in production. ' +
      'Set VITE_MAPTILER_KEY in apps/creator-web/.env'
    );
  }
  ```
  Additionally, in the JSX, render an amber banner inside the map container when `!KEY`:
  ```tsx
  {!KEY && (
    <div className="absolute top-2 inset-x-2 z-10 bg-amber-100 border border-amber-400 text-amber-800 text-xs px-3 py-1.5 rounded-lg">
      ⚠️ No MapTiler key — using public geocoder. Not suitable for production.
    </div>
  )}
  ```
  Guard the banner with `import.meta.env.DEV` so it only shows in development:
  `{!KEY && import.meta.env.DEV && ( ... )}` — warning in dev, silent in prod (prod
  should never reach this state; the console.warn on PROD covers that edge case).
- [ ] 13.2 In `DEPLOY.md`, under the required environment variables section for
  `apps/creator-web/.env`, mark `VITE_MAPTILER_KEY` as **required** (not optional) with
  a note:
  ```
  VITE_MAPTILER_KEY=<your-key>   # REQUIRED — get from maptiler.com. Without this, the
                                  # public Nominatim geocoder is used, which violates
                                  # the Nominatim Usage Policy for production use.
  ```
- [ ] 13.3 Run `npm run creator:build`. Confirm the banner does not appear in the production
  build output (it is dev-only).


## 14. REFACTOR — Polish and final cleanup

- [ ] 14.1 Review the `withLocation` module extraction (2.1): ensure the module is exported
  cleanly from `apps/play-web/src/utils/withLocation.ts` and the import in `TaskRunner.tsx`
  is clean. Add JSDoc comment describing the `onDenied` parameter.
- [ ] 14.2 Review all `t.task.*` function keys for consistent parameter naming. Ensure
  `stopOf`, `walkCloser`, `hintStuck`, `stepOf` all use named-object params (not positional)
  so future parameter additions don't break callers silently.
- [ ] 14.3 Native speaker review: Have a Hebrew native speaker verify all 48 new HE
  translation keys in `i18n.ts` (`t.task.*` + `t.final.*`). Update any awkward phrasing.
  This is a prerequisite for the production deploy.


## 15. FINAL GATES — All green before marking change done

- [ ] 15.1 `npm run typecheck` — must pass for all workspaces (creator-web, play-web,
  functions, packages/shared). Zero type errors.
- [ ] 15.2 `npm run lint` — creator-web eslint must show 0 errors (style warnings ok).
- [ ] 15.3 `npm test` — both lanes must be green:
  - `scripts/run-unit-tests.mjs` (aggregator): all `scripts/test-*.ts` pass, including:
    - `test-gps-error-ux.ts` (new — C1/C2 paths)
    - `test-photo-url-validation.ts` (new — M3 helper)
    - `test-registration-fields.ts` (extended — M5 `validateRequiredFields`)
    - `test-i18n-parity.ts` (extended — task + final namespace parity)
  - `turbo run test` (vitest in functions/): all existing tests pass + no new failures.
- [ ] 15.4 `npm run creator:build` — production build of creator-web must succeed.
- [ ] 15.5 `npm run e2e` — full lifecycle must pass, including:
  - New assertion: `submitStationPhoto` rejects `https://example.com/evil.jpg` with
    `invalid-argument` (added in 8.1).
  - All 26+ existing e2e assertions still pass.
- [ ] 15.6 Manual preview smoke test (play-web):
  - JoinScreen: attempt to submit with an empty required custom field → inline red border
    appears, form does not submit.
  - TaskRunner (any task type): deny GPS permission → `t.task.gpsWarning` banner shown;
    re-enable GPS, tap again → banner clears and task submits.
  - TaskRunner geofence task with GPS denied → `t.task.gpsUnavailable` + `t.task.gpsContactHost`
    shown; no infinite spinner.
  - FinalScreen: toggle language to EN → all labels in English; toggle to HE → all in Hebrew;
    tap "Share my result" in EN → share text is English.
- [ ] 15.7 Manual smoke test (creator-web):
  - Builder: kill network after opening a game URL → error card visible with "Try again".
  - LocationPicker in dev (no VITE_MAPTILER_KEY): amber banner visible in the map.
