# Tasks — builder-analytics-tab-signpost

There is **no pure logic** in this change: it is a copy revision plus a navigation button, both UI.
Per CLAUDE.md's UI lane there is no RED unit test to write; the gates are typecheck + creator:build +
i18n:check:strict + browser. (Design records option (b), dropping the tab, as the reversible
alternative; this change implements option (a), the signpost.)

## GREEN

- [x] 1. Revise `builder.analyticsBody` in BOTH language maps in `apps/creator-web/src/i18n.ts` from
      the false "appear here after your first live run" to the true "each run's analytics live with the
      run; open a run to see them", and add `builder.analyticsOpenRuns` (the button label) in BOTH
      maps. Additive/edit only; re-read immediately before editing, the file is contended. No em dash,
      no en dash, no spaced hyphen.
- [x] 2. In `apps/creator-web/src/pages/BuilderPage.tsx`, replace the Analytics tab body (`:555-561`)
      with the signpost `Card`: keep the glyph and `b.analyticsTitle`, show the revised
      `b.analyticsBody`, and add a `Button` that calls `nav('/live')` labelled `b.analyticsOpenRuns`.
      Keep `'analytics'` in `BUILDER_TAB_IDS`.

## REFACTOR / VERIFY

- [x] 3. `npx tsx scripts/check-i18n.ts --strict` clean: zero new PART B findings, PART A parity holds
      (revised `analyticsBody` and new `analyticsOpenRuns` present in both maps).
- [ ] 4. Preview check (creator-web): Builder ▸ Analytics tab shows the signpost; the button navigates
      to `/live`; the copy no longer claims analytics render in the tab; per run analytics still render
      in the Run Console as before.
- [ ] 5. Hand the full gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`). This lane must not run them: they rewrite `packages/shared/dist`
      in place and other agents are live on this tree.
- [x] 6. Confirm no e2e owed: no callable added or changed, `getRunAnalytics` untouched,
      `ALLOWED_TASK_KEYS` untouched.
