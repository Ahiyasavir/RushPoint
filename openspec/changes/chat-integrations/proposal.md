## Why

Corporate and youth-group organizers run their event alongside a Slack or Microsoft
Teams channel. Today RushPoint's live-ops broadcasts (announcements, flash missions) only
reach the participant phones. Mirroring them into the organizer's existing chat — where
remote staff, sponsors, and spectators already are — is a standard expectation of event
platforms and a cheap, high-visibility integration.

## What Changes

- A game gains an optional owner-only **`integrationWebhookUrl`** (+ derived
  `integrationPlatform: 'slack' | 'teams'`). When set, every `pushAnnouncement` and
  `pushFlashMission` on any run of that game also **POSTs a formatted message** to the
  Slack/Teams incoming webhook (fire-and-forget; a webhook failure never fails the
  participant-facing broadcast).
- The Builder **Settings** exposes a "Chat integration (Slack / Teams)" field where the
  creator pastes an incoming-webhook URL; the platform is auto-detected and validated.
- Payload rendering + SSRF URL validation are **pure, unit-tested** helpers in
  `@rushpoint/shared` (`buildSlackPayload` / `buildTeamsPayload` / `isAllowedWebhookUrl`);
  the server only does the `fetch` POST behind the allow-list guard.

## Capabilities

### New Capabilities
- `chat-integrations`: per-game Slack/Teams incoming-webhook mirroring of announcements &
  flash missions — the data field, the SSRF-guarded outbound POST, the pure payload
  builders, and the Builder authoring field.

## Non-goals

- No inbound commands from Slack/Teams (one-way, outbound only).
- No leaderboard auto-push in v1 (the builders support a `leaderboard` event for a later
  change; only announcement + flash mission are wired now).
- No OAuth app / bot — just a user-pasted incoming-webhook URL (the standard low-friction path).
- The webhook URL is a secret on the owner-only game doc; it is NEVER copied into
  `publicGames`/`publicTasks` or any participant payload.

## Surfaces touched
- **shared:** `webhookPayload.ts` (`WebhookEvent`, `buildSlackPayload`, `buildTeamsPayload`,
  `buildWebhookPayload`, `isAllowedWebhookUrl`, `detectPlatform`).
- **shared types:** `Game.integrationWebhookUrl?` / `integrationPlatform?` +
  `UpdateGamePayload`.
- **functions:** `games/index.ts` `updateGame` allowlist persists the field (validated via
  `isAllowedWebhookUrl`, else rejected); a `postWebhook` helper (global `fetch`, Node 20,
  Blaze egress) called at the end of `pushAnnouncement` + `pushFlashMission` in
  `index.ts` after the Firestore write, wrapped in try/catch.
- **creator-web:** Builder Settings webhook field + i18n.
- **Tests:** `scripts/test-webhook-payload.ts` (pure; done). e2e: point a game's webhook at
  a local capture URL and assert the broadcast still succeeds when the webhook 404s
  (resilience); assert an off-allowlist URL is rejected by `updateGame`.
- No Firestore index or rules change; no new env var (URL is per-game data).
