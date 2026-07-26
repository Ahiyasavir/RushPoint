# Stay under $10/month on Blaze — the ordered checklist

For Firebase project **`rushpoint-pwa-7daaa`**, upgrading from Spark to **Blaze (pay-as-you-go)**.

This is the **do-this-in-order** page. The deep reference — sources, Google's exact wording, the
kill-switch build + recovery runbook — is **[COST_CONTROLS.md](COST_CONTROLS.md)**. This page links
to it rather than repeating it.

> **The card is a family member's. Treat that as a hard constraint, not a preference.**
> Steps 1–3 are the ones that actually protect money. Do them the same day you upgrade.

Run `npm run cost:preflight` any time to confirm the **repo-side** controls. It cannot see the
console steps below — those are on you, and it says so.

---

## ✅ The checklist

### 1. Lower the Cloud Functions quota — DO THIS FIRST ⛔

**This is the single most important step, and the ONLY control that is an enforced hard wall.**
Everything else on this page is a notification or a lagging tripwire.

**Click path:** [IAM & Admin → Quotas & System Limits](https://console.cloud.google.com/iam-admin/quotas)
→ make sure the project is `rushpoint-pwa-7daaa` → filter/search for **Cloud Functions** → tick the
quota → **Edit** → enter a lower value → submit.

Lower all three:

| Quota | Start with |
|---|---|
| **Max concurrent invocations for background functions** | **5–10** |
| **Max project CPU** | the smallest value the form accepts near 5–10 concurrent instances |
| **Max project memory** | likewise |

**Why it works:** over-quota returns **HTTP 500** — a real failure. Requests fail immediately; they
do not queue and bill you later. And because RushPoint is **server-write-only** (clients cannot write
run/team/score docs), capping function concurrency also indirectly bounds Firestore *writes*.

**The severity math, plainly:**

| Setting | Worst-case burn in 24 h |
|---|---|
| Default quota (~960 concurrent instances possible) | **≈ $2,000 – $2,500/day** |
| Low quota (~5–10 concurrent) | **≈ $10 – $25/day** |

That is the difference between "a bad day" and "a bad year".

> ⚠️ **Quota *decreases* go through Google review and are NOT instant.** Request the reduction now,
> while nothing is wrong — not during an incident.

> 🎯 **Start LOW while you are testing alone.** Then, *deliberately and in advance*, raise the
> concurrency before a real event with many players — a low quota during a live game means real
> participants standing outdoors getting HTTP 500s. Raise it for the event, lower it after.

---

### 2. Create the "Awareness" budget at **$5** — with alerts at 20 / 50 / 80 / 100%

Set it at **$5, not $10.** You want the warning while you still have headroom, not as you cross the
line.

**Click path:** [Billing](https://console.cloud.google.com/billing) → your billing account →
**Budgets & alerts** → **Create budget** → **Scope: Projects = `rushpoint-pwa-7daaa`** → **Target
amount $5** → add threshold rules at **20 / 50 / 80 / 100%** on **Actual** spend → Finish.

**No Pub/Sub topic on this budget.** It is email-only, and it is *allowed* to fire.

| Alert | What you do |
|---|---|
| 20% ($1) | Nothing. Awareness. |
| 50% ($2.50) | Fine if you ran events. If you ran none, investigate. |
| 80% ($4) | Open the billing report **now** — this is where you catch a runaway by hand. |
| 100% ($5) | Decide: raise the budget, or shut something down yourself. |

---

### 3. Build the kill switch — set it **well above** $10

A **second, separate** budget, wired to Pub/Sub → a Cloud Function that detaches billing.

**Full build + IAM + safe-test + recovery runbook: [COST_CONTROLS.md](COST_CONTROLS.md)**
(use Option (b), Google's own DIY sample — not the deprecated Firebase Extension).

> ⚠️ **One line to remember:** the kill switch is a **tripwire with hours of lag, not a wall.**
> Google publishes no latency SLA. By the time it fires, real spend is already higher than the
> number that triggered it — so set it at a level only an attack or a bug could reach (e.g. $50+),
> never at $10. If it fires mid-event the game dies instantly with players outdoors.

---

### 4. Deploy cheaply — the most likely accidental charge 💥

**A full functions deploy rebuilds ~96 functions ≈ 96 Cloud Build minutes ≈ the ENTIRE 120-minute
DAILY free tier.** A *second* full deploy on the same day is billed. This is, by a wide margin, the
easiest way to accidentally spend money on this project.

```bash
npm run deploy:fn -- launchRun joinRun    # ✅ deploy ONLY these (~1–2 build-minutes)
npm run deploy:fn -- --changed            # suggest names from your git diff — deploys NOTHING
npm run deploy:fn -- --all                # ❌ full rebuild; needs explicit confirmation
```

`scripts/deploy-functions.mjs` is built to protect you: with **no arguments it refuses**, prints the
cost, and demands `--all`; a typo'd function name **fails fast** instead of silently deploying
nothing; >20 functions requires a confirmation. `npm run deploy:backend` also rebuilds everything —
prefer `deploy:fn`.

Rules and indexes are cheap and unrelated to build minutes: `npm run deploy:rules`.

---

### 5. Enforce App Check — after a soak

App Check is **wired and shipping dark** in both apps (`VITE_APP_CHECK_ENFORCE=off`). It blocks calls
from anything that isn't your real app, which is the main defence against a scripted abuse spike.

Order: register both web apps in the Firebase console (**Blaze required**) → get the reCAPTCHA site
key → set `VITE_APP_CHECK_SITE_KEY` → run it **unenforced for a while** and watch the App Check
metrics for legitimate traffic being marked unverified → only then turn **enforcement** on.

Cross-reference: the App Check layer is part of the recommended stack described in
[COST_CONTROLS.md](COST_CONTROLS.md).

---

### 6. Check the Cloud Storage bucket region 🌍

**The Cloud Storage free tier applies ONLY in `us-central1`, `us-west1`, and `us-east1`.** A bucket
in any other region (including anything European or `me-west1`) **bills from the very first byte**.

**You must check this in the console — it cannot be read from this repo.**
[Firebase Console → Storage](https://console.firebase.google.com/project/rushpoint-pwa-7daaa/storage)
→ the bucket's **Location** is shown on the Files tab / in bucket details.

If it is already outside those three regions, you cannot move it in place — you would create a new
bucket in a free-tier region and migrate. Check *before* you start uploading event photos.

---

## 📶 Know about it: Hosting data transfer is the one per-DAY allowance

Not an alarm — an item to be aware of before a big event. Firebase Hosting's free tier includes
**360 MB of data transfer per DAY**. Note **per day, not per month** — that is unusual for a free
tier and easy to misread. Overage is **$0.15/GB**.

**The arithmetic, with real measured bytes** (gzip, from the committed `apps/play-web/dist`):

| What a fresh install downloads | gzip |
|---|---|
| Entry chunk `index-*.js` | **241 KB** (246,851 B) |
| Entry stylesheet `index-*.css` | 7 KB (7,653 B) |
| Lazy `NavMap` chunk (MapLibre) — fetched once the map opens | **216 KB** (220,896 B) |
| `NavMap` stylesheet | 9 KB (9,220 B) |
| **Total per fresh install** | **≈ 473 KB** (484,620 B) |

**360 MB/day ÷ ~473 KB ≈ ~740 fresh first-loads per day** before a single cent is charged.
(Before the map opens it is only ~249 KB, so ~1,400 loads/day if players never open the map.)

**The service worker caches the app shell, so a returning player on the same device costs ~0.**
It is *fresh installs on new devices* that consume the allowance — not gameplay, not repeat sessions.

**So how much should you care?** At **10–100 participants this is comfortably free** and simply not
a concern. It only becomes relevant at a **large single-day event with several hundred+ new
devices**. And even then the damage is small: running **10x over** the allowance (3.6 GB in a day)
costs roughly **$0.50 for that day**. This is a "know about it" line, not a risk.

> 💡 **Practical mitigation:** because the allowance is **per day**, a single large event
> concentrates all the load into one 24-hour window. **Spreading test events across different days
> keeps each day inside the free tier** — two 400-device days are free where one 800-device day is
> not.

---

## 🛡 What's already built into the code — do NOT redo these

`npm run cost:preflight` verifies the first, second and fourth of these automatically.

| Control | Where | What it does |
|---|---|---|
| **Per-callable `maxInstances` cap** | `functions/src/obs/log.ts` (`DEFAULT_MAX_INSTANCES`) | Every callable carries an instance ceiling, so one abused endpoint cannot scale without bound. |
| **Per-uid rate limiting** | `functions/src/rateLimitStore.ts` | Transactional per-user limits on callables — a retry loop or a script gets cut off. |
| **Server-write-only Firestore rules** | `firestore.rules` | Clients cannot write run/team/score/leaderboard docs at all. All writes flow through functions, so step 1's cap bounds writes too. |
| **App Check, wired but dark** | both apps' `.env.example` | Ready to enforce (step 5) without a code change. |
| **Bounded listeners + composite indexes** | `firestore.indexes.json` | The live-ops listeners (`feedItems`, `announcements`, `flashMissions`) are indexed and bounded, not full-collection scans. |

---

## 💵 What a normal month actually costs

| Line item | Expected | Note |
|---|---|---|
| **Artifact Registry** (function container images) | **~$0 – $2** | Usually the **largest** line. `firebase-tools` ≥ 14 auto-cleans images older than 1 day, which keeps this near zero. |
| Cloud Functions invocations + compute | ~$0 | Free tier covers hobby/testing volume comfortably. |
| Firestore reads / writes | ~$0 | A handful of runs is far below the free tier. |
| Cloud Storage | ~$0 | **Only if the bucket is in a free-tier region** — see step 6. |
| Cloud Build | ~$0 | 120 min/day free; only a *second* full deploy in one day bills. |
| Hosting data transfer | ~$0 | 360 MB **per DAY** free ≈ ~740 fresh installs/day; $0.15/GB after. See the section above. |
| **Realistic total** | **$0 – $2 / month** | |

**Reaching $10 would require something anomalous** — a runaway retry loop, an abuse spike, a bucket
in a paid region, or repeated full deploys in a single day. That is exactly what steps 1–3 exist to
catch.

---

## 🙏 An honest closing note

Do all six steps and you are very well protected. You are **not** absolutely protected, and it would
be dishonest to say otherwise:

- **Firestore reads cannot be hard-capped.** There is no user-lowerable quota on Firestore reads,
  writes, or deletes anywhere in GCP. Enabling billing simply removes the free-tier daily caps and
  puts nothing in their place. Direct client `onSnapshot` listeners bypass Cloud Functions entirely,
  so the step-1 quota does not bound them.
- **There is no spending limit feature in GCP.** The old App Engine daily spending limit was shut
  down in 2023 and nothing replaced it. A budget is a notification.
- **Prepaid/virtual cards are not accepted**, so you cannot bound the blast radius with a $50 card.
- **The kill switch lags by hours** and can overshoot.

So: a determined abuse case, or a bug that runs unnoticed overnight, **could still exceed $10**. The
controls on this page make that **unlikely, not impossible**. Keep the 80% alert on a phone you
actually check, and don't leave a fresh deploy running unwatched overnight.

Every claim above is sourced in **[COST_CONTROLS.md](COST_CONTROLS.md)** — read its
"What has NO hard limit" section before you decide you're safe.
