# Design — builder-analytics-tab-signpost

## 1. Current code, audited

- `BUILDER_TAB_IDS: BuilderTab[] = ['build', 'preview', 'analytics', 'settings']`
  (`BuilderPage.tsx:141`); the strip renders each with `TAB_LABEL[id]` (`:488-503`).
- The Analytics tab body (`:555-561`):

  ```tsx
  {tab === 'analytics' && (
    <Card className="p-10 text-center space-y-2">
      <div className="text-3xl">📊</div>
      <p className="font-semibold text-[--ink-1]">{b.analyticsTitle}</p>
      <p className="text-sm text-[--ink-3]">{b.analyticsBody}</p>
    </Card>
  )}
  ```

- Copy: `analyticsTitle` ("Analytics" / "ניתוח"), `analyticsBody`
  ("Run analytics appear here after your first live run." / the HE equivalent)
  (`i18n.ts:1030-1031`, `:2534-2535`).
- Navigation: the Builder already uses `nav(...)` (react-router) and navigates to run routes
  (`:357,380`). The creator's runs overview is the `/live` route (`App.tsx:182` ⇒ `RunsOverviewPage`),
  and an individual run console is `/run/:gameId/:runId` (`App.tsx:183`). Analytics render inside the
  Run Console's post run panel via `getRunAnalytics`.

The Builder does not hold a completed run's id in scope (it only learns a `runId` at the moment it
launches, `:379`), so the correct, always valid signpost target is `/live` — the runs overview, which
lists this creator's runs and links into each run's console.

## 2. The two options (both spec'd; (a) chosen)

- **(a) Signpost.** Keep the tab in `BUILDER_TAB_IDS`; replace its body with one honest sentence and a
  button that navigates to `/live`. Pros: nothing moves in the nav strip (no broken habit / deep
  link); the dead end becomes a discoverable path to the real analytics; smallest behavioral surprise.
  Cons: the tab still exists without rendering analytics itself (mitigated: it now clearly says so and
  leads somewhere).
- **(b) Drop the tab.** Remove `'analytics'` from `BUILDER_TAB_IDS` so the strip is Build · Preview ·
  Settings; delete the placeholder body; remove the now unused `analyticsTitle`/`analyticsBody` keys
  and re run `i18n:check:strict` (PART A parity). Pros: no dead tab at all. Cons: removes a nav entry
  (muscle memory / any deep link to the tab), and leaves no in Builder pointer toward where analytics
  live, which is the exact discoverability gap the onboarding change flagged.

**Recommendation: (a).** It preserves every ability (analytics were never here), removes the false
promise, and adds discoverability rather than removing an affordance. This design implements (a); (b)
is recorded here as the reversible alternative.

## 3. The change (option a)

Replace the Analytics tab body with a signpost `Card`:

```tsx
{tab === 'analytics' && (
  <Card className="p-10 text-center space-y-3">
    <div className="text-3xl">📊</div>
    <p className="font-semibold text-[--ink-1]">{b.analyticsTitle}</p>
    <p className="text-sm text-[--ink-3]">{b.analyticsBody}</p>
    <Button onClick={() => nav('/live')}>{b.analyticsOpenRuns}</Button>
  </Card>
)}
```

- `analyticsBody` copy is revised from the false "appear here after your first live run" to the true
  "each run's analytics live with the run; open a run to see them" (HE + EN).
- `analyticsOpenRuns` is a new button label ("Open runs" / "פתיחת ריצות" or similar) in both maps.
- `analyticsTitle` is reused unchanged.
- Uses the existing `nav` from the component and the existing `Button` primitive; no new import beyond
  what BuilderPage already has.

## 4. i18n and RTL

- Revise `builder.analyticsBody` in BOTH language maps and add `builder.analyticsOpenRuns` in BOTH.
  All copy routes through `t.*`; no hardcoded string. No em dash, no en dash, no spaced hyphen.
- The `Card` is `text-center` and the `Button` is symmetric, so there is no physical direction class
  to correct; RTL is inherited.
- If option (b) were taken instead, `analyticsTitle` and `analyticsBody` would be removed from both
  maps and `i18n:check:strict` re run to confirm PART A parity; that is not done here.

## 5. Test strategy

There is **no pure logic** in this change — it is a copy revision plus a `nav('/live')` button, both
UI. Per CLAUDE.md's UI lane:

- `npm run typecheck` and `npm run creator:build` stay green.
- `npm run i18n:check:strict` clean, zero new PART B findings, and PART A parity holds (the revised
  `analyticsBody` and the new `analyticsOpenRuns` are defined in both maps).
- Preview check: Builder ▸ Analytics tab shows the signpost; the button navigates to `/live`; the copy
  no longer claims analytics render in the tab.

**Lane: e2e.** Nothing to add. No callable, no `Task` field. `getRunAnalytics` is unchanged, so the
callable coverage guard is unaffected.

## 6. Non decisions worth recording

- **The tab is not removed.** Keeping it avoids breaking a nav position and any link, and gives the
  Builder a discoverable pointer to analytics, which is the gap the onboarding change named.
- **The signpost targets `/live`, not a specific run.** The Builder does not hold a finished run's id;
  `/live` is always valid and is where a creator picks the run whose analytics they want.
- **No analytics are rendered in the Builder.** That would duplicate the Run Console and require
  wiring `getRunAnalytics` into the Builder for no gain; out of scope.
