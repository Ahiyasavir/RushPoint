## 1. Shared payload + SSRF guard — RED then GREEN (pure)
- [x] 1.1 RED: `scripts/test-webhook-payload.ts` — `isAllowedWebhookUrl` (slack/teams/azure
  allowed; http/unknown/localhost/ip/suffix-spoof/empty/null rejected), `detectPlatform`,
  `buildSlackPayload`/`buildTeamsPayload`/`buildWebhookPayload` per event kind, leaderboard
  top-5 cap. Confirm fail.
- [x] 1.2 GREEN: implement `webhookPayload.ts` (`WebhookEvent`, builders, `isAllowedWebhookUrl`,
  `detectPlatform`, `buildWebhookPayload`); export from `@rushpoint/shared`. `npm test` → 22 pass.

## 2. Shared types
- [x] 2.1 `Game.integrationWebhookUrl?` / `integrationPlatform?` + `UpdateGamePayload.integrationWebhookUrl?`. Typecheck.

## 3. functions
- [x] 3.1 `updateGame` persists + validates the URL via `isAllowedWebhookUrl` (empty clears via
  FieldValue.delete; off-allowlist → invalid-argument); derives `integrationPlatform`.
- [x] 3.2 `mirrorToChat(ownerUid, gameId, event)` helper (loads game doc, SSRF-guard, global
  `fetch` POST, try/catch — never fails the broadcast).
- [x] 3.3 Call `mirrorToChat` at the end of `pushAnnouncement` + `pushFlashMission`.
- [x] 3.4 Confirm `publishGame`'s `PublicGame` build does NOT copy the secret (it constructs
  field-by-field — verified). Typecheck.

## 4. creator-web
- [x] 4.1 Builder Settings `WebhookField` (client-side validated on blur via shared guard);
  add `integrationWebhookUrl` to `buildSavePayload`.
- [x] 4.2 i18n keys (`webhookLabel`, `webhookHelp`, `webhookInvalid`) EN + HE (HE Latin-free).

## 5. Tests / gates
- [ ] 5.1 e2e: a game with a webhook pointed at an unreachable/404 URL still broadcasts OK;
  an off-allowlist URL is rejected by `updateGame` (batch gate).
- [x] 5.2 `npm run typecheck` (green).
- [ ] 5.3 `npm run i18n:check` (pending run).
- [ ] 5.4 builds + `npm run e2e` (batch gate).
