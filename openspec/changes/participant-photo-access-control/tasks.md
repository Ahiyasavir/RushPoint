# Tasks — participant photo access control

> ⚠️ **NOT APPROVED — DO NOT IMPLEMENT.**
> This change is an assessment + decision document. The list below is the RED → GREEN → REFACTOR
> shape that the **recommended** option (design.md § Option D, Phase 1) *would* take if the product
> owner approves it. It is written now so the effort is legible at decision time. If Option A, B or C
> is chosen instead, this file is rewritten before any code is touched.
>
> **Gate 0 (blocks every task below): the product owner selects an option**, and answers the five
> open questions in design.md §7 — in particular whether the public ceremony slideshow survives, what
> the retention window should be, and (with counsel) whether the privacy copy or the behavior moves.

- [ ] 0. **DECISION GATE.** Owner picks an option and answers design.md §7 Q1–Q5. Record the choice
      at the top of design.md. No task below starts until this is done.

## Part 1 — Stop the public escape (design.md § Option D item 1)

- [ ] 1.1 **RED (pure):** add `scripts/test-ceremony-audience.ts` asserting a pure
      `ceremonyAudienceAllowed({ isOwner, isStaff, gamePublicOptIn })` predicate — owner ⇒ allowed,
      staff ⇒ allowed, non-owner without opt-in ⇒ denied, non-owner with explicit opt-in ⇒ allowed,
      absent/undefined opt-in ⇒ denied (fail closed). Run `npm test`; confirm it fails because the
      predicate does not exist.
- [ ] 1.2 **RED (e2e):** add a scenario to `scripts/e2e-verify.mjs` — a **non-owner** anonymous caller
      invoking `getPublicLeaderboard` on a published run that has approved feed photos receives a
      payload containing **no** `photoUrl` at any depth (deep-scan the JSON, not just the top level).
      Confirm it fails today.
- [ ] 1.3 **GREEN:** implement the pure predicate in `packages/shared` (export it), and apply it at
      the `ceremonyFeed` assembly site in `functions/src/runs/index.ts` (`getPublicLeaderboard`).
      Minimum code to turn 1.1 + 1.2 green.
- [ ] 1.4 **GREEN (owner parity):** extend the e2e scenario to assert the **owner** still receives the
      ceremony selection, so the organizer-operated big screen is provably unbroken.
- [ ] 1.5 **GREEN (opt-in + UI):** add the per-game public-ceremony-media setting (default off) to
      the game type + Builder, with bilingual `t.*` helper text stating that enabling it makes
      participant photos visible to anyone holding the board link. Run `npm run i18n:check` and
      `npm run i18n:check:strict`.

## Part 2 — Removal must remove (design.md § Option D item 2)

- [ ] 2.1 **RED (pure):** extend `functions/src/storagePaths.test.ts` with the single-object
      derivation used by removal — blank/missing run or team id throws; a `/` in an id throws.
      Confirm the new cases fail.
- [ ] 2.2 **RED (e2e):** assert in `scripts/e2e-verify.mjs` that after `hideFeedItem`, the underlying
      Storage object is gone (Admin SDK `exists()` is false), and that a second `hideFeedItem` is a
      no-op that does not error. Confirm it fails today.
- [ ] 2.3 **GREEN:** make `hideFeedItem` (`functions/src/index.ts`) delete the object through the
      hardened helper, best-effort and idempotent, without changing its authorization or its
      `active:false` write.
- [ ] 2.4 **RED → GREEN (authz):** add `hideFeedItem`-with-deletion to the e2e authorization denial
      matrix (participant / stranger / other-run staff denied; owner + run staff allowed). Implement
      nothing new — assert the existing gate holds after the change.
- [ ] 2.5 **GREEN (UI resilience):** ensure the feed/review surfaces render a graceful placeholder
      for a removed object rather than a broken image, in both apps. `npm run i18n:check`.

## Part 3 — Retention reaches every run (design.md § Option D item 3)

- [ ] 3.1 **RED (pure):** add `scripts/test-run-prunable.ts` for a pure
      `isRunPrunable(run, now, retentionDays)` — finished + past window ⇒ true; never-finalized but
      inactive past the window ⇒ true; active/recent ⇒ false; already stamped pruned ⇒ false;
      unparseable timestamps ⇒ false (fail closed). Confirm it fails.
- [ ] 3.2 **GREEN:** implement the predicate in `packages/shared` and use it as the authority in
      `sweepExpiredRuns` (`functions/src/maintenance/index.ts`), keeping the Firestore query as the
      cheap pre-filter and widening it to reach non-finished runs. Preserve the `piiPrunedAt`
      idempotence guard.
- [ ] 3.3 **RED → GREEN (e2e):** assert that an abandoned (never finalized, artificially aged) run is
      pruned by `pruneExpiredRunDataNow` — media objects deleted, `photoUrl` fields cleared, run
      stamped — and that a live run is untouched.
- [ ] 3.4 **REFACTOR:** if the owner chose a shorter window, change the single shared retention
      constant only; assert no other call site hardcodes a day count.

## Part 4 — No raw permanent link in a share (design.md § Option D item 4)

- [ ] 4.1 **RED (pure):** unit-test the share fallback's text builder — given a caption and a media
      URL it returns text containing the caption and **not** the URL. Confirm it fails.
- [ ] 4.2 **GREEN:** change `apps/play-web/src/lib/sharePhoto.ts` so the fallback shares a
      link-free branded caption; the share still never throws.
- [ ] 4.3 **GREEN (ops, not code):** configure bucket CORS so the branded-canvas path succeeds and the
      fallback becomes rare. Verify with a real bucket fetch — this is the one item in this change
      that cannot be proven from the repo (design.md §1.6 marks it INFERRED).
- [ ] 4.4 **UI verification:** exercise "share a photo" on the finish screen in the preview and
      confirm the branded image path. `npm run i18n:check`.

## Part 5 — Disclosure (design.md § Option D item 5)

- [ ] 5.1 **Owner + counsel:** decide whether §3.4 of the Privacy Policy is corrected or the behavior
      is constrained to match it. **Engineering does not decide this and does not draft the copy.**
- [ ] 5.2 **GREEN:** apply the owner-supplied copy to `apps/creator-web/src/pages/LegalPage.tsx` in
      both HE and EN, keeping the Privacy Policy and the Terms describing the same audience.
      `npm run i18n:check` must be clean.

## Part 6 — Gates

- [ ] 6.1 **REFACTOR:** collapse any duplication introduced across the ceremony/recap/feed media
      selection into the single shared predicate; verify the participant sanitizer allowlist in
      `scripts/e2e-verify.mjs` (`ALLOWED_TASK_KEYS` / `ALLOWED_SMART_KEYS`) is updated for any field
      added or removed, so a stray field fails loud.
- [ ] 6.2 **FULL GATE SET — all must be green:** `npm run typecheck` · `npm run lint` · `npm test` ·
      `npm run creator:build` · `npm run play:build` · `npm run e2e` · `npm run test:rules` ·
      `npm run i18n:check` (and `npm run i18n:check:strict` for the new Builder + legal copy).
      Confirm the callable coverage guard still reports full coverage.

## Deferred — Phase 2 (a separate change, only if the owner wants it)

- [ ] 7.1 Author a follow-up change for the Option B migration: store storage **paths** not URLs,
      suppress the download token at upload, mint short-lived signed URLs at each read boundary, and
      run the backfill described in design.md §3 (token rotation over `runs/**` plus a matching
      rewrite of every persisted `photoUrl`). It carries its own decision on the offline-caching and
      forwarded-link regressions and is **not** authorized by this change.
