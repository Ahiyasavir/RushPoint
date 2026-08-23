# Proposal — builder-analytics-tab-signpost

## Why

One of the Builder's four top level tabs, "Analytics" (`BUILDER_TAB_IDS`, `BuilderPage.tsx:141`),
renders **only a static placeholder** (`:555-561`): a 📊 glyph and the sentence "Run analytics appear
here after your first live run." (`i18n.ts:1031` / `:2535`). They never appear there. Run analytics
live in the **Run Console** post run panel and are served by `getRunAnalytics`; the Run Console is
reachable from the creator at `/live` (the runs overview) and `/run/:gameId/:runId`.

So a full quarter of the Builder's primary navigation is a dead tab whose own copy makes a promise it
structurally cannot keep. This is the same "prominent affordance that does nothing" and "analytics
has two homes" ambiguity that `creator-onboarding-and-plain-language` already named but did not close.

## What Changes

**The Analytics tab becomes a real signpost that points the creator at where analytics actually
live**, instead of a placeholder that promises data it never shows.

- The tab body (`:555-561`) is replaced with one honest sentence plus a button that navigates to
  `/live` (the runs overview), where a creator opens a run's console and its post run analytics.
- The tab and its label stay in `BUILDER_TAB_IDS`, so the strip is unchanged and no muscle memory
  breaks; only the body content changes.
- The misleading copy (`analyticsBody`: "Run analytics appear here after your first live run.") is
  replaced with copy that tells the truth: analytics live with each run; open a run to see them.

The two options considered — (a) signpost, (b) drop the tab entirely — are both spec'd in
`design.md`; this proposal implements **(a)**, the more discoverable and lower churn choice.

## What does not change

- **Viewing per run and per task analytics is unchanged.** That ability is fully provided by the Run
  Console's post run analytics panel and `getRunAnalytics`; this tab contributes zero analytics
  capability today and contributes zero after the change. Nothing that renders analytics is touched.
- **The tab strip keeps four tabs** (Build, Preview, Analytics, Settings); no navigation entry is
  removed, so existing links and habits keep working. The Analytics tab now leads somewhere instead of
  nowhere.
- **No backend, no callable, no `getRunAnalytics` change, no shared type, no savePayload, no layout
  data.**

## Non-goals

- No new analytics rendering inside the Builder (analytics stay in the Run Console).
- No new callable and no change to `getRunAnalytics`.
- No change to `functions/`, `packages/shared`, `firestore.rules`, or play-web.

## Impact

- Affected specs: `builder-navigation` (new)
- Affected code: `apps/creator-web/src/pages/BuilderPage.tsx` (replace the Analytics tab body with a
  signpost that navigates to `/live`), `apps/creator-web/src/i18n.ts` (revise `builder.analyticsBody`
  copy and add a button label, HE and EN; `builder.analyticsTitle` reused)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules.
