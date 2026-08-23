# Wave H — Live-ops broadcasts · chat webhook (SSRF) · payments/billing sweep

Read-only audit, branch `topographic-maps`, 2026-07-22. Scope: live-ops broadcast
callables, the Slack/Teams chat-integration webhook (SSRF surface), payments/wallet/
referral, `stripeWebhook`, and `launchRun` billing. Cross-checked `firestore.rules`.

**Headline: no P0 found.** The three surfaces the mission worried about most —
SSRF to metadata/internal IPs, self-granted credits/pro, and an unverified Stripe
webhook — are all **sound**. The webhook guard is a strict allow-list (not a
deny-list), every wallet mutation is server/webhook-only, and the Stripe signature
is verified before any mutation. Findings below are hardening (P2) and one by-design
info-leak caveat. Payments are currently **dark** (`PAYMENTS_ENABLED === false`,
`packages/shared/src/freeMode.ts:17`) — the billing paths are assessed for when the
flag flips on.

---

## Confirmed findings

| # | file:line | surface | issue | sev | one-line fix |
|---|-----------|---------|-------|-----|--------------|
| 1 | `functions/src/index.ts:141` | `mirrorToChat` outbound `fetch` | **No timeout / no AbortSignal.** The callable `await`s the webhook POST before returning (`pushAnnouncement:592`, `pushFlashMission:665`). A slow/hostile allow-listed endpoint hangs the owner's console call up to the function timeout and holds a billable instance. Participant broadcast is unaffected (doc write precedes the fetch), so it fails-open correctly — this is cost/latency only. | P2 | Add `signal: AbortSignal.timeout(3000)` to the `fetch`. |
| 2 | `functions/src/index.ts:141` | `mirrorToChat` `fetch` redirects | Node/undici `fetch` follows redirects by default. An allow-listed host with an open redirect could in theory bounce the POST elsewhere. Low value: response body is never read, method is POST, hosts are Slack/MS-owned. | P2 (needs runtime check) | Pass `redirect: 'error'` (Slack/Teams webhooks never 3xx). |
| 3 | `functions/src/index.ts:564-571`, `firestore.rules:72-77` | targeted announcement (`teamId`) | A "targeted" announcement is stored with a `teamId` field but the rules let **every run participant** read the whole `announcements` collection; targeting is client-side courtesy only (`announcementVisibleTo`). Any team can read an announcement aimed at another team via a direct Firestore listen. **Documented as intentional** (rules comment lines 68-71: "operational copy, never an answer key"). Flagged so it isn't mistaken for private messaging. | P2 (by-design) | If real privacy is ever wanted, move per-team announcements into the per-team doc or a CF-gated read; do NOT advertise targeting as private. |
| 4 | `packages/shared/src/webhookPayload.ts:23-28` | SSRF allow-list breadth | `office.com` and `logic.azure.com` are broad — any Azure Logic App / Power Automate HTTP trigger matches. This lets an **owner** point their own game's webhook at an arbitrary endpoint they control on those clouds. It is owner-controlled exfiltration of the owner's own broadcast text (no cross-tenant data, no internal reach), so not a real vuln — noted for awareness. | P3 | Acceptable; tighten to `*.webhook.office.com` / `*.logic.azure.com` if you want to be strict. |

---

## Clean bills (verified sound — do not re-flag)

- **SSRF guard is an allow-list, not a deny-list** (`webhookPayload.ts:30-44`). Host
  must `=== suffix` or `endsWith('.'+suffix)` for one of hooks.slack.com /
  webhook.office.com / office.com / logic.azure.com. Consequences:
  `127.0.0.1`, `::1`, `169.254.169.254`, `10.x`, decimal/hex IP literals, `.local`,
  `.internal`, and any non-allow-listed host **cannot match** — the explicit
  loopback/IP checks (lines 40-42) are belt-and-suspenders on top. `http:` rejected
  (https-only, line 34). `user:pass@host` userinfo rejected (line 37). **DNS-rebind is
  defeated** because the attacker would need to control DNS for slack.com/office.com/
  azure.com. The guard is re-run at fetch time (`index.ts:139`) as well as at store
  time (`games/index.ts:224`), so a legacy bad URL can't slip through. **Sound.**
- **Webhook URL is secret.** Never placed in `publicGames` (`games/index.ts:387-410`
  omits it), stripped when duplicating a game (`games/index.ts:331`
  destructures `integrationWebhookUrl`/`integrationPlatform` out of the copy), and
  never returned to participants. **Sound.**
- **Broadcast fails open safely.** `mirrorToChat` wraps everything in try/catch and
  returns void (`index.ts:133-148`); the announcement/flash Firestore doc is written
  *before* the mirror runs. A bad/absent/slow webhook never breaks the participant
  broadcast. **Sound** (see #1 for the caller-latency caveat).
- **Stripe webhook signature IS verified before any mutation**
  (`payments/index.ts:329` `constructEvent(req.rawBody, sig, webhookSecret)`; 400 on
  failure at line 332, before the switch). Missing keys → 500 (line 316). Credits path
  is idempotent via `processedSessions.includes(session.id)` (line 352). **Sound.**
- **Every wallet + transaction write is server/webhook-only.** `firestore.rules:191-198`
  — `wallets/{uid}` and `.../transactions/{txId}` both `allow write: if false`, read
  owner-only. A client cannot grant itself credits or Pro. **Sound.**
- **`launchRun` billing is atomic and can't go negative** (`runs/index.ts:275-313`).
  Wallet is read inside the transaction; `resolveLaunchBilling` (`freeMode.ts:53-84`)
  only returns `consume:'credit'` when `credits > 0`, and the run + access-code + the
  `increment(-1)` all commit in one transaction. Pro is honored only while unexpired
  (line 281). The refuse branch throws `resource-exhausted`. Concurrent launch+purchase
  is safe (transaction retry on wallet contention). **Sound.**
- **Test-drive is not a paid-launch bypass** (`runs/index.ts:243-266`). `testDrive:true`
  is free but hard-capped at 2 participants (`TEST_DRIVE_MAX_PARTICIPANTS`,
  `freeMode.ts:26`) and limited to one live test run per game by the in-txn abuse guard
  (lines 255-263). A real event still needs a billed launch. **Acceptable by design.**
- **`claimReferral` is idempotent and anti-self/anti-farm** (`payments/index.ts:242-302`).
  Self-referral rejected (line 248); second claim blocked by `me.referredBy` inside the
  transaction (line 263); referrer bonus capped by `REFERRAL_MAX_PER_REFERRER` (line 267);
  inviter must be a real Auth account (line 251). Concurrent double-claim is defeated by
  transaction retry. Creator accounts are real email/Google auth, bounding Sybil. **Sound.**
- **Live-ops authz is correct.** `assertStaffOrOwner` (`index.ts:77-94`) gates
  `pushAnnouncement`/`deactivateAnnouncement`/`pushFlashMission`/`acknowledgeAlert`/
  `hideFeedItem`; a staff token must match BOTH `ownerUid` and `runId`, so a PIN for run
  A can't broadcast to run B, and no one can aim a broadcast at another owner's run
  (path + token both scoped). No emulator bypass. **Sound.**
- **Team chat can't be spoofed or cross-read.** `sendTeamChatMessage` (`index.ts:419-514`)
  ignores a participant-supplied `teamId` and resolves identity server-side
  (`resolveCallerTeam`, line 474); the HQ path re-asserts `assertStaffOrOwner`.
  `firestore.rules:106-111` lets a participant read only their own team's `chat/{teamId}`
  doc (founder uid or attached device). **Sound.**
- **SOS is rate-limited and doesn't leak location.** `triggerSOS` (`index.ts:373-410`)
  calls `enforceRateLimit`; alerts/teamLocations are owner+staff-read only
  (`firestore.rules:115-122`), so non-staff participants never see another team's
  coordinates. **Sound.**
- **No XSS in broadcasts/chat.** Announcement/flash/chat text is length-capped
  (`MAX_MESSAGE_LEN = 500`, `validation.ts:21`) and control-char-stripped
  (`sanitizeChatText`, `chat.ts:45-54`); render is via React (auto-escaped). The only
  `dangerouslySetInnerHTML` in source is `LegalPage` (static legal markdown) and the
  archived `apps/mobile` — never user content. **Sound.**

---

## Needs a runtime check (not reproduced statically)

- **#2 redirect-follow** — confirm undici default redirect behavior on the deployed
  Node-20 runtime and whether `redirect:'error'` is worth adding. Low priority.
- **Stripe `rawBody` availability** — signature verification depends on
  `functions.https.onRequest` populating `req.rawBody`. It does on Firebase Functions
  v1, but worth a one-time live smoke when payments go live so a body-parser change
  doesn't silently break verification (would surface as constant 400s, not a security
  hole).

## Highest-severity summary

No P0/P1. Top actionable item is **#1** (add a `fetch` timeout to `mirrorToChat`,
`functions/src/index.ts:141`) — a hardening fix against owner-console hangs / instance
cost, not a security breach. Everything money- or SSRF-related is sound.
