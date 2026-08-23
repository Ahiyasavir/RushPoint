# Cost Controls — budget-triggered billing kill switch

For Firebase project **`rushpoint-pwa-7daaa`** on the Blaze (pay-as-you-go) plan.

---

## ⚠️ READ THIS FIRST — what this can and cannot do

**A budget kill switch is a tripwire, not a wall. It cannot guarantee you stop at exactly $X.**

Google's own documentation says it plainly. These are Google's exact words:

> "Setting a budget does not automatically cap … usage or spending."
> — [Create, edit, or delete budgets and budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)

> "There's a delay between incurring costs and receiving budget notifications, so you might
> incur additional costs for usage that hasn't arrived at the time that all services are stopped."
>
> …and the mechanism "doesn't guarantee that you won't spend more than your budget."
> — [Disable billing with notifications](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)

Two separate delays stack up:

1. **Usage → cost data.** Google Cloud services report usage into billing at varying intervals.
2. **Cost data → alert fires.** Once a threshold is crossed in the data, the Pub/Sub notification
   still has to be delivered.

**Google publishes NO latency SLA for either step.** Community reports cluster around *hours*.
There is no documented ceiling, so **treat the possible overshoot as effectively unbounded** and
size your kill-switch number accordingly.

**Consequence: a runaway loop or an abuse spike can burn well past your limit before the switch
trips.** Set the kill-switch number high enough that overshoot is survivable, and treat the small
alert thresholds (20/50/80%) as your *real* early-warning system.

### The extension author's own assessment

Kurt Weston (author of the `functions-auto-stop-billing` extension) answered the delay question
directly in a Reddit comment on r/Firebase (thread "Prevent high bill firestore rtdb", ~2 years old,
u/No_Excitement_8091). **This is credible first-party context, not official documentation or a
spec** — weigh it as an informed practitioner's opinion.

- The delay is inherent to pay-as-you-go billing across **all** cloud providers (AWS, GCP, Azure) —
  not a flaw specific to his extension.
- In his words: *"You won't find a way to set an exact limit and stick to it, I would expect it to
  leak."*
- Useful calibration: a leak on the order of **10x** (a $100 budget becoming $1,000) would indicate
  the application itself wasn't designed with cost in mind. The tripwire is a backstop for a
  well-designed app, not a substitute for one.
- His actual recommendation — the important part: *"use the extension, apply security rules, use
  AppCheck, and apply rate limiting. You won't need much more."*

> ### ⚠️ Do not misread "a few seconds"
>
> Asked how long the trigger takes, he answered **"sub-second"** for the function itself, and
> **"a few seconds"** including Pub/Sub publish + receive + instance warm-up.
>
> **That is the latency AFTER the budget alert fires. It is NOT the billing-data pipeline lag.**
> These are two different clocks:
>
> | Clock | Duration |
> |---|---|
> | Usage → billing data → budget alert fires | **Hours. No SLA. This one dominates.** |
> | Alert fires → billing actually disabled | A few seconds (his figure) |
>
> A reader who sees "a few seconds" and concludes the whole mechanism responds in seconds has
> misunderstood it. The seconds-fast part is the last, smallest link in a chain whose first link is
> measured in hours.

**RushPoint already implements his full recommended stack**, so the kill switch is the last layer on
an already-defended app — exactly the posture he describes as appropriate:

- **Security rules** — `firestore.rules` (~19.7 KB of server-enforced authorization; run/team/score
  docs are server-write-only).
- **Rate limiting** — per-uid transactional limits in `functions/src/rateLimitStore.ts`.
- **App Check** — wired, shipping dark (see the App Check work in this repo).

### What "disabling billing" actually does

It detaches the billing account from the project. That is not a throttle — it is an off switch:

- **Cloud Functions stop.** Every callable in `functions/` returns errors. No scoring, no joining,
  no task assignment.
- **Firestore becomes inaccessible.** Creator console and play-web both break.
- **Hosting stops serving.** Public URLs go down.
- **A live game mid-run dies instantly.** Participants standing in the street lose the app with no
  warning and no graceful degradation. There is no "pause and resume".
- **Re-enabling is manual and not guaranteed to restore service.** Google states that re-enabling
  billing "requires manual configuration and there's no guarantee of service recovery." Disabling
  billing terminates resources, and Google warns that "resources might be irretrievably deleted."

> ### ❗ Possible data loss — an uncertainty I could not resolve
>
> **I could not find Google explicitly stating whether Firestore and Cloud Storage *data* is
> deleted, or merely made inaccessible, when billing is disabled on a project.** Google's warning
> about irretrievable deletion is generic about "resources" and does not settle this.
>
> Do not assume your data is safe. **Take a Firestore export (and a Storage copy) before you rely
> on this tripwire**, and keep taking them on a schedule. Treat "the kill switch fired" as a
> scenario where you might need to restore from a backup, not merely flip a switch back on.

This is why the kill switch must be set **far above** any realistic event cost. It exists to stop
an attack or a bug, not to manage a normal month.

---

## What has NO hard limit — verified

This is the most important section in this document. Three mitigations people commonly reach for
**do not work**, and there is exactly **one** enforced wall that does.

### ❌ Three things that DO NOT work — don't spend time on them

**1. Prepaid / virtual cards cannot cap your exposure.**
Google does not accept them. In Google's own words: *"Prepaid cards aren't accepted for payment."*
Debit cards that require 2FA are also rejected. You cannot bound the blast radius by attaching a
card with only $50 on it.
Source: <https://docs.cloud.google.com/billing/docs/how-to/payment-methods>

**2. There is no spending limit anywhere in GCP or Firebase.**
The old App Engine *daily spending limit* — the feature people remember — was **deprecated
2020-07-24 and shut down 2023-07-01**, and **nothing replaced it**.
Source: <https://docs.cloud.google.com/appengine/docs/standard/deprecations/shut-down>

Firebase states it directly: *"Firebase and Google Cloud don't turn off services and usage based on
your budget and thresholds."*
Source: <https://firebase.google.com/docs/projects/billing/avoid-surprise-bills>

A budget is a notification. It is not a limit. That is why this whole document exists.

**3. Firestore operations CANNOT be hard-capped — this is THE critical gap.**
There is **no user-lowerable quota on Firestore reads, writes, or deletes**. Enabling billing does
not raise a cap you can then lower again; it simply **removes the free-tier daily caps** (50k reads
/ 20k writes / 20k deletes per day) and leaves nothing in their place. The only Firestore quotas you
can adjust are **databases per project**, **composite indexes**, and **CMEK** — none of which
throttle traffic.
Sources: <https://docs.cloud.google.com/firestore/quotas> and
<https://firebase.google.com/docs/firestore/quotas>

So: a read/write explosion in Firestore has **no ceiling other than the billing kill switch**, which
(per the section above) is a lagging tripwire, not a wall.

### ✅ The ONE enforced wall that does exist — Cloud Functions quotas

This project uses **`firebase-functions` v1 (1st gen)**, so this applies to us.

Three Cloud Functions quotas are **user-lowerable**:

- **Max project memory**
- **Max project CPU**
- **Max concurrent invocations for background functions**

Path: **IAM & Admin → Quotas & System Limits → filter to Cloud Functions → select the quota →
Edit**.

Crucially, exceeding these is a **real failure, not a soft throttle**. Google: *"A function returns
an HTTP 500 error code when one of the resources is over quota."* Requests fail; they do not queue
up and bill you later.
Source: <https://docs.cloud.google.com/functions/quotas>

> ⚠️ **Quota *decreases* are subject to Google review and are not instant.** Request the reduction
> before you need it, not during an incident.

**Why this lever is unusually effective for RushPoint specifically:** the architecture is
**server-write-only** — `firestore.rules` denies client writes to run/team/score/leaderboard docs, so
essentially **all** Firestore writes flow through Cloud Functions. Capping function concurrency
therefore **indirectly bounds write volume too**. That is a much better ratio than most apps get
from the same lever.

The uncapped tail is **direct client READS** — `onSnapshot` listeners going straight to Firestore,
which bypass Cloud Functions entirely. Those are gated only by security rules (which do constrain
*who* reads *what*, but not *how much*).

### Worst case, with arithmetic

Assume every callable is flooded simultaneously and `maxInstances` is 10 per function. gen1 runs
**one request per instance** (concurrency 1), so:

**96 callables × maxInstances 10 = 960 concurrent instances.**

| Component | Calculation | Cost |
|---|---|---|
| Compute ceiling | 960 × 86,400 s = **82.9M instance-seconds** → ~$52 (GB-s) + ~$332 (GHz-s) | **≈ $385 / day** |
| Invocations | at ~200 ms each ⇒ ~415M calls × $0.40/M | **≈ $166 / day** |
| Firestore | at ~3 reads + 1 write per call ⇒ ~$750 (reads) + ~$747 (writes) | **≈ $1,500 / day** |
| **Absolute 24 h ceiling** | | **≈ $2,000 – $2,500** |

Heavier per-call Firestore use could push that to roughly **$5–10k/day**. A *realistic* single-endpoint
flood — one abused callable rather than all 96 saturated — lands around **$50–$500/day**.

**Read that honestly in both directions.** This is a **low-thousands** risk, not a $50k risk, and the
reason is `maxInstances = 10` capping compute. But it is emphatically **not zero**, and the Firestore
line is the largest term — which is exactly the component with no hard cap available.

---

## 💰 How to change my monthly limit

This is the one thing you'll do repeatedly. It takes about 30 seconds.

1. Go to <https://console.cloud.google.com/billing>
2. Pick your billing account.
3. In the left menu, click **Budgets & alerts**.
4. Click the budget's name in the list.
5. Click **Edit** (or the pencil), change the **Target amount**, click **Next** / **Finish** to save.

**That's all.** The budget amount is read at alert time — the Cloud Function receives the current
budget in the notification payload. **You do not need to redeploy anything, touch code, or restart
the function.** Changing the number in the console is the entire operation.

> Exact button/label wording in the Cloud Console changes over time. If a label below doesn't match
> what you see, look for the nearest equivalent — the structure (Billing → Budgets & alerts → your
> budget → Edit) has been stable.

---

## Two ways to build it

### Option (a) — Firebase Extension `kurtweston/functions-auto-stop-billing` ("Auto Stop Services")

- **Published?** Yes. Listed at
  <https://extensions.dev/extensions/kurtweston/functions-auto-stop-billing>, publisher Kurt Weston,
  **version 2.0.0** at the time of writing.
- **Last update date:** **I could not verify this.** The extensions.dev listing did not show a
  dated release, and the apparent source repo
  (<https://github.com/deep-rock-development/auto-stop-firebase-ext>) did not expose a last-commit
  date in what I could read. **Check both pages yourself before installing.**
- **Stated limitations (from its own listing):**
  - "Stopping billing will disrupt your application. Plan accordingly and test in non-production
    environments first."
  - "Google Cloud and Firebase report usage and cost at varying time intervals… expect billing
    information to be delayed and therefore some additional costs above your budget before services
    are stopped."
  - On trigger it "removes the billing account from your project" — all billable services stop
    immediately.
  - v1.x had a second, gentler strategy (disabling selected service APIs); that was **removed in
    2.0.0** because of Google Cloud API restrictions. So 2.0.0 is all-or-nothing.
- **The big structural problem:** **Firebase Extensions as a product is deprecated and shuts down
  on March 31, 2027**
  ([Firebase Extensions Deprecation FAQ](https://firebase.google.com/docs/extensions/faq-and-troubleshooting)).
  Already-installed extensions keep running, but after that date you cannot install, update,
  reconfigure, or uninstall them via console or CLI. Google says migration guidance arrives
  September 2026.

### Option (b) — DIY: Budget → Pub/Sub topic → Cloud Function → Cloud Billing API

Google's official, supported guide:
**<https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications>**

It ships copy-pasteable Node.js and Python function code, and the Python sample has a
`SIMULATE_DEACTIVATION` flag defaulting to `True` for safe testing.

### ✅ Recommendation: **Option (b), the DIY Google approach. Do not adopt the extension.**

The extension is a thin wrapper around exactly the same mechanism, but it is delivered on a
**platform Google has already announced it is shutting down (March 31, 2027)** — after which you
cannot update, reconfigure, or uninstall it. Putting a money-safety control on a dying delivery
mechanism is the wrong trade when the alternative is **~30 lines of Google's own sample code**
deployed as a normal Cloud Function you fully own, with a `SIMULATE_DEACTIVATION` dry-run flag that
makes it safe to test.

---

## Setup — click path for Option (b)

Assumes zero GCP familiarity. Console URLs are given so you can jump straight there.

### 1. Create the Pub/Sub topic

1. Go to <https://console.cloud.google.com/cloudpubsub/topic/list> and make sure the project selector
   at the top says **rushpoint-pwa-7daaa**.
2. Click **Create topic**.
3. Topic ID: `billing-kill-switch`. Leave the defaults (add a default subscription is fine).
4. Click **Create**.

### 2. Create the budget and wire it to the topic

1. Go to <https://console.cloud.google.com/billing> → your billing account → **Budgets & alerts**.
2. Click **Create budget**.
3. **Scope:** set **Projects** to just `rushpoint-pwa-7daaa`. (Scoping to one project matters — the
   kill switch disables billing for a project.)
4. **Amount:** set your **Target amount** (see the thresholds table below).
5. **Actions / Thresholds:** add the percentage rules you want (20 / 50 / 80 / 100), each on
   **Actual** spend.
6. Still on that page, expand **Manage notifications** (sometimes shown as "Connect a Pub/Sub topic
   to this budget") and **tick the option to connect a Pub/Sub topic**, then select
   `billing-kill-switch`.
7. **Finish**.

> This is the step people miss: the email alerts and the Pub/Sub notification are configured
> separately on the same budget. Without the Pub/Sub checkbox, nothing triggers the function.

### 3. Deploy the kill-switch function

1. Copy the function source from Google's guide
   (<https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications>).
   **Use the Python sample** — it has the `SIMULATE_DEACTIVATION` dry-run flag. Leave it `True`.
2. Deploy it as a **Cloud Run function (2nd gen)** with trigger type **Cloud Pub/Sub** and topic
   `billing-kill-switch`.
   - Easiest path: <https://console.cloud.google.com/functions> → **Create function** → Trigger:
     Cloud Pub/Sub → topic `billing-kill-switch` → paste the code → Deploy.
   - Note the **service account** the function runs as (shown under Runtime settings, usually
     `<something>@<project>.iam.gserviceaccount.com`). You need it in the next step.
3. **Do not** deploy this into `functions/` in this repo. It is infrastructure, not app code, and it
   must keep working independently of app deploys.

### 4. Grant the IAM permission (sensitive — read carefully)

The function must be able to detach the billing account, which requires a role **on the billing
account, not on the project**:

1. Go to <https://console.cloud.google.com/billing> → your billing account → **Account management**
   (or the **Permissions/IAM** panel for the billing account).
2. Click **Add principal** / **Add member**.
3. Principal = the function's service account email from step 3.
4. Role = **Billing Account Administrator** (`roles/billing.admin`). Google's sample guide names
   exactly this role. A narrower alternative sometimes cited for this job is **Project Billing
   Manager** (`roles/billing.projectManager`), which is scoped to attaching/detaching billing on
   projects rather than full billing-account control — **prefer the narrower one if it works**, but
   Google's own walkthrough specifies `roles/billing.admin`, so fall back to that if the detach call
   fails with a permission error during your dry run.
5. Save.

> ⚠️ **These are sensitive roles.** `roles/billing.admin` can attach/detach billing accounts and
> change billing on **any** project under that billing account. Grant it to *this one service
> account only*, never to a shared or default account you use for other things, and don't reuse that
> service account for anything else.

### 5. Test the tripwire safely (do this — do not skip)

You want to prove the wiring works without actually killing the project.

**A. Dry-run mode is your seatbelt.** Keep `SIMULATE_DEACTIVATION = True` for all testing. In this
mode the function does everything except the final API call, and logs what it *would* have done.

**B. Fire it deliberately with a throwaway budget:**

1. Create a **second** budget scoped to `rushpoint-pwa-7daaa`, with a **deliberately tiny target
   amount** (e.g. $1) so current spend already exceeds it, connected to the same
   `billing-kill-switch` topic.
2. Wait for the notification. **Because of the reporting lag, this is not instant** — give it up to
   a day before concluding it's broken.
3. Check the function ran: <https://console.cloud.google.com/functions> → your function → **Logs**.
   You should see the simulated-deactivation log line, not an error.
4. **Delete the throwaway budget.**

**C. You can also publish a fake message** to `billing-kill-switch` from the Pub/Sub console
("Messages" → **Publish message**) using a JSON payload shaped like Google's documented budget
notification, to test the function instantly without waiting on billing data. Match the field names
(`costAmount`, `budgetAmount`, `budgetDisplayName`) from the guide.

**D. Only when the log proves it fired correctly**, set `SIMULATE_DEACTIVATION = False` and redeploy.
(This is the *only* time you need to redeploy — changing the budget amount later never does.)

---

## Recommended thresholds

Assume your realistic monthly cost on this project is small — Firestore reads/writes, function
invocations, and Storage for a handful of runs. Pick a number, then set the kill switch far above it.

| Threshold | % of budget | Channel | What it means / what you do |
|---|---|---|---|
| Early warning | **20%** | Email only | Normal. Just awareness that the month has started. |
| Halfway | **50%** | Email only | Still fine if you ran events. If you ran nothing, investigate. |
| Serious | **80%** | Email (+ phone notification if you can) | Look at the billing report **now**. This is where you catch a runaway loop by hand. |
| Budget hit | **100%** | Email | You've reached your intended spend. Decide: raise the budget, or shut things down yourself. |
| **KILL SWITCH** | **separate budget, set to a much larger amount** | Pub/Sub → function | Automatic billing disable. Should never fire in normal life. |

**Structure it as two budgets:**

- **Budget A — "Awareness"**, set at your genuine monthly comfort level (e.g. your real expected
  spend). Email alerts at 20/50/80/100%. **No Pub/Sub topic connected.** This one is allowed to fire.
- **Budget B — "Kill switch"**, set at a *multiple* of Budget A — a number that only an attack or a
  bug could reach. Alert rule at 100%. **Pub/Sub topic connected.**

**Why the kill switch must sit well above realistic usage:** if it fires during a real event, the
game dies mid-run with participants outdoors and no recovery path faster than manual re-enabling.
A false positive here is much more expensive to you than a few extra dollars of true spend. And
remember the reporting lag cuts both ways — by the time it fires, actual spend is already higher
than the number that triggered it.

> Set the actual dollar amounts yourself. I deliberately have not suggested numbers: your real
> per-run cost on Blaze isn't measured yet. Run one or two real events first, read the actual
> billing report, then set Budget A near that and Budget B several times higher.

---

## 🚨 When it fires — recovery

Billing is off. The app is down. Work through this in order.

### Before you re-enable — find out WHY

Re-enabling into an active runaway or an ongoing attack just resumes the burn. Check:

1. **Billing reports** — <https://console.cloud.google.com/billing> → **Reports**. Group by
   **Service** and by **SKU**. One line will be huge. That tells you what's burning: Firestore
   reads? Function invocations? Egress? Storage?
2. **Function logs** — <https://console.cloud.google.com/functions>, sort by invocation count. A
   single callable with absurd invocations means a client retry loop or an abuse target.
3. **Firestore usage** — a read explosion usually means an unbounded listener or a query without a
   limit, often triggered by a client bug.
4. **Was there a real event running?** If so, this was likely a false positive and you can raise the
   budget and re-enable. If not, treat it as a bug or abuse until proven otherwise.
5. **Was a deploy shipped just before?** Check `git log`. Correlate the spike with the deploy time.

### Re-enable billing

> Google's caveat: re-enabling "requires manual configuration and there's no guarantee of service
> recovery." Have your Firestore/Storage export handy in case something didn't survive.

1. Go to <https://console.cloud.google.com/billing/linkedaccount> with `rushpoint-pwa-7daaa`
   selected (or Firebase Console → ⚙️ → **Usage and billing**).
2. Click **Link a billing account** and select your billing account.
3. **Raise the kill-switch budget (Budget B) first**, or it may immediately trip again — the
   accumulated spend for the month is still above the threshold that fired it.

### If the charge is declined — what actually happens

Worth knowing, because "the card will just get declined" is sometimes assumed to be a safety net.
It is a *consequence*, not a *control*:

- **A declined charge suspends the billing account and every resource attached to it** — but
  **slowly**. Charges fire on the **monthly billing cycle** or when you hit an **auto-assigned
  threshold**, not continuously. A runaway therefore **accrues damage first** and gets stopped
  afterwards.
- **Prolonged invalidity leads to irreversible resource deletion.** Suspension is not indefinite
  parking; keep the Firestore/Storage exports.
- **The balance remains legally owed.** Suspension does not erase the charges already incurred.

Sources:
<https://docs.cloud.google.com/resource-manager/docs/project-suspension-guidelines> and
<https://docs.cloud.google.com/billing/docs/how-to/resolve-issues>

> **Not verified either way:** Google's public documentation does **not** describe what happens
> beyond suspension — no statement about collections activity or credit reporting, in either
> direction. **Do not read that silence as immunity.** It is simply undocumented.

### After re-enabling — verify

1. Cloud Functions respond: run `npm run e2e` locally, and smoke-test a real join on the live site.
2. Firestore reads/writes work from both apps.
3. Hosting serves both origins.
4. Scheduled functions (`pruneExpiredRunData`) still have their schedule — check
   <https://console.cloud.google.com/cloudscheduler>; schedules are a common casualty.
5. The kill-switch function itself is still deployed and still has `roles/billing.admin`.
6. Fix the root cause you found above **before** the next live run.

---

## Things I could not verify

Stated explicitly so you don't treat guesses as facts:

- **The exact current reporting-lag figure.** Google publishes no latency SLA and no authoritative
  worst-case number. Community reports cluster around hours. Plan for "unbounded".
- **Whether Firestore/Storage data is DELETED or merely inaccessible when billing is disabled.**
  Google does not state this explicitly anywhere I could find. Assume loss is possible; keep
  exports.
- **The last-update date and active maintenance status of
  `kurtweston/functions-auto-stop-billing`.** The listing showed v2.0.0; neither the listing nor the
  apparent source repo exposed a dated release to me. Verify yourself if you choose option (a).
- **Exact Cloud Console button/label wording.** Google renames these regularly. The navigation
  *paths* above are the stable part; match by meaning if a label differs.
- **Whether `deep-rock-development/auto-stop-firebase-ext` is definitively the source repo** for
  that extension. It looks like it, but nothing on either page confirmed the link.
- **What Google does about an unpaid balance beyond suspension.** The public docs describe
  suspension and eventual resource deletion, and say nothing about collections or credit reporting.
  Could not be verified in either direction — do not assume immunity.

## Sources

- [Disable billing with notifications — Google Cloud (official guide)](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications)
- [Create, edit, or delete budgets and budget alerts — Google Cloud](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [Payment methods (prepaid cards not accepted) — Google Cloud](https://docs.cloud.google.com/billing/docs/how-to/payment-methods)
- [App Engine daily spending limit shutdown (2023-07-01) — Google Cloud](https://docs.cloud.google.com/appengine/docs/standard/deprecations/shut-down)
- [Avoid surprise bills — Firebase](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)
- [Firestore quotas and limits — Google Cloud](https://docs.cloud.google.com/firestore/quotas)
- [Firestore usage and limits — Firebase](https://firebase.google.com/docs/firestore/quotas)
- [Cloud Functions quotas (user-lowerable, HTTP 500 over quota)](https://docs.cloud.google.com/functions/quotas)
- [Project suspension guidelines — Google Cloud](https://docs.cloud.google.com/resource-manager/docs/project-suspension-guidelines)
- [Resolve billing issues — Google Cloud](https://docs.cloud.google.com/billing/docs/how-to/resolve-issues)
- [Auto Stop Services extension — extensions.dev](https://extensions.dev/extensions/kurtweston/functions-auto-stop-billing)
- [Firebase Extensions Deprecation FAQ (shutdown March 31, 2027)](https://firebase.google.com/docs/extensions/faq-and-troubleshooting)
- [auto-stop-firebase-ext — GitHub](https://github.com/deep-rock-development/auto-stop-firebase-ext)
