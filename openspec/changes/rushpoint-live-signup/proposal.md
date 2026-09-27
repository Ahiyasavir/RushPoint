## Why

RushPoint Live is the flagship event: one day, one city-wide race across Jerusalem, and
**ten teams selected from every sector in Israel**, competing for 1,000 ₪ and perks from
brand partnerships. The marketing site had no way for a team to put itself forward. The
only public write endpoint on the platform is the contact form, which asks for a name, an
address and a paragraph — useless for selecting ten teams out of a field, because the
selection turns on facts (how many of you, where you live, how you know each other, how you
are on camera) that a free-text message does not reliably contain.

The applicants are a group of friends with no account, who are not signing up for a product
and never will. That rules out every authenticated path, including the existing upload
route, which requires a Firebase ID token and checks the path belongs to the caller.

## What Changes

- A **high-energy call to action** on the home page, directly under the hero: the dated,
  scarce offer (10 teams · 5 to 8 members · 1,000 ₪), Hebrew only, additive and never a gate.
- A **dedicated application page** at `/he/live/` with the nine questions plus a team name,
  mobile first, RTL, and validation that NAMES the field it refuses.
- A third **unauthenticated callable**, `submitLiveApplication`, built on exactly the
  reasoning that governs `submitContactMessage`: field validation, a hard size bound, and
  two rate budgets keyed on the connection rather than on anything the caller sends.
- The **group photo travels inside that callable**, downscaled in the browser, rather than
  through a new anonymous binary endpoint. It is stored in its own document beneath the
  application so the admin list never drags image bytes through it.
- An **admin screen** at `/admin/live-applications`, plus `listLiveApplications` and a
  separate, audited `getLiveApplicationPhoto`.

## Capabilities

### New Capabilities
- `rushpoint-live-signup`: an unauthenticated team application form for the RushPoint Live
  event, with a browser-downscaled group photo, and an admin-only, audit-logged read path
  that separates the record from its photograph.

## Non-goals
- **No English version.** The event is one race in Jerusalem for teams living in Israel, so
  `/en/live/` is deliberately a 404 rather than a translated page nobody can act on. This is
  why the page is not a `STANDING_SUBJECT`.
- **No selection workflow.** The admin screen lists, sorts by arrival and dials; it does not
  score, shortlist or reject. `status` is stored so that can be added later without a
  migration, but nothing writes anything other than `'new'` yet.
- **No payment, no scheduling, no participant accounts.** An application is not a booking.
- **No anonymous upload endpoint on the VPS.** Considered and rejected: a new abuse surface,
  writing to disk, for one form.
