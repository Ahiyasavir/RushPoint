## 1. Shared types
- [x] 1.1 `Game.allowInstantPlay?`, `Run.selfGuided?`, `PublicGame.allowInstantPlay?`,
  `UpdateGamePayload.allowInstantPlay?`.

## 2. functions
- [x] 2.1 `updateGame` persists `allowInstantPlay`; `publishGame` denorm carries it to
  `publicGames` (never the webhook secret).
- [x] 2.2 `startInstantPlay` (participant) — resolves the public game → owner, verifies
  `allowInstantPlay`, creates a free `selfGuided` run + access code + the caller's team, starts
  it (buildInitialStages + assignNextInActiveStage), returns the run context. No credit consumed.
  Re-export.

## 3. play-web
- [x] 3.1 GamePromo "Play now" button when `allowInstantPlay` → `startInstantPlay` → save
  session → drop into the normal Play flow (`onInstantPlay` wired in App).
- [x] 3.2 `startInstantPlay` wrapper; `promo.playNow`/`starting`/`soloPlayer` i18n EN + HE.

## 4. creator-web
- [x] 4.1 Builder Settings "Allow instant play" toggle; persisted via `buildSavePayload`;
  `instantPlayLabel`/`instantPlayHelp` i18n EN + HE.

## 5. Tests / gates
- [x] 5.1 e2e: publish an opted-in game → `startInstantPlay` as an anon player → active
  self-guided run → play to finished; a non-opted-in game is refused. (Coverage guard.)
- [x] 5.2 typecheck · i18n · no-dashes · lint · builds — green; e2e + rules green
  (adversarial sim is environmentally flaky on this machine, not code-related).

## Notes
- v1 = one fresh solo run per instant play (per-player instance) — no shared evergreen run,
  no "near me" discovery ranking, no credit consumption. Those are follow-ups.
