# Simplifying the run console and the staff app: research and plan (2026-09-30)

Asked by Ahiya on 2026-09-29/30: a plan to simplify the organizer's dashboard and the staff screens,
based on research into other interfaces and on published guidance, plus a way for the operator and the
counsellors to follow a few teams they choose. Point-in-time document; the executable part is the
OpenSpec changes it names.

## 1. Where we are (measured)

| | Run console (organizer) | Staff app (counsellors) |
|---|---|---|
| Code | `RunConsolePage.tsx` 4,441 lines | `StaffConsole.tsx` 1,699 lines |
| Structure | 27 panels in 5 sections + a pinned zone; ~51 buttons | one long scroll of ~11 sections; ~31 buttons |
| Field complaint | "so complicated it is exhausting" (run of 2026-09-27) | every team with every action on every row |

What playing it on 2026-09-29 showed (fixed that night, see `docs/OVERNIGHT-2026-09-29.md`): the SOS row
in the "now" list led to a page that could not acknowledge it; the flash panel was 1,800px below where
"open" landed; the inbox clock froze; test teams showed "looks stuck 852 h", i.e. noise in the one list
that must be trusted.

## 2. What others do

- **Goosechase**: the game is "built to run seamlessly without any intervention" from the organizer; the
  live tools are an activity feed, rankings, score adjustments and co-managers with the same access.
  ([organizing](https://goosechase.com/how-it-works/organizing),
  [co-managed games](https://goosechase.com/blog/goosechase-co-managed-scavenger-hunt-games))
- **Loquiz**: the live results page is five nouns: Standings, Answers, Photowall, Map, Chat; the map
  shows task locations and live team positions, filterable by team.
  ([results page](https://loquiz.com/support/results-page/), [chat](https://loquiz.com/support/chat/))
- **Kitchen display systems**: one queue of tickets, each with its age, green → yellow → red at
  thresholds set per service model, and "bump" clears it; the three tiers avoid both panicking over
  everything and becoming numb. ([Toast KDS](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html),
  [KwickOS](https://kwickos.com/blog/best-kitchen-display-system-kds-2026.html))
- **Onfleet (dispatch)**: two components, a map and a sidebar list of the same tasks and drivers;
  selections in the sidebar drive the map. ([Map & Sidebar](https://support.onfleet.com/hc/en-us/articles/360023669612-Map-Sidebar))
- **Linear triage**: one inbox, and every item is ONE decision (accept, decline, duplicate, snooze), with
  automation routing most items before a human sees them. ([Triage](https://linear.app/docs/triage))
- **PagerDuty**: acknowledge marks "I have this" so nobody else acts on the same incident, then resolve;
  snooze for "later". ([Incidents](https://support.pagerduty.com/main/docs/incidents))
- **Following a few out of many**: F1 timing apps let you pick drivers, highlight them against the field
  and focus the map on them ([Formula Live Pulse](https://www.f1livepulse.com/en/features/)); Flightradar24
  keeps a Bookmarks panel with a live one-line summary per followed flight, in an order you choose
  ([Bookmarks](https://www.flightradar24.com/blog/tutorial/say-hello-to-the-new-bookmarks-widget/)).
- **Race control**: GPS on marshals and medics, all in one console to find the nearest responder
  ([Sportraxs](https://tan.sportraxs.com/safety)); incident apps log with automatic location
  ([RaceRanger](https://apps.apple.com/py/app/raceranger/id6741778508)).

## 3. Principles we take from the guidance

1. **Colour means "something is wrong".** High-performance HMI (ISA-101): a greyscale base, colour only
   for abnormal states, red only for critical, so an abnormal state stands out even in peripheral vision
   ([RealPars](https://www.realpars.com/blog/high-performance-hmi),
   [overview](https://processcontrolguide.com/isa-101-hmi-design/)). Today the console colours many
   normal things.
2. **A display hierarchy, at most two levels deep.** ISA-101 levels: overview → subsystem → detail →
   diagnostics. NN/g: more than two disclosure levels "typically have low usability"; frequently needed
   things up front, and decide what is frequent from usage data, not guesses
   ([Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).
   For us: overview (now + map + my teams) → team page → submission/mission detail.
3. **Few, trustworthy alarms.** Alarm fatigue: when most alarms are false, people stop responding; the
   remedy is prioritisation and cutting noise ([AHRQ PSNet](https://psnet.ahrq.gov/perspective/reducing-safety-hazards-monitor-alert-and-alarm-fatigue),
   [APSF](https://www.apsf.org/article/alarm-fatigue-and-patient-safety/)). "Stuck 852 h" is exactly this.
4. **Perception first.** Endsley's situation awareness: perceive → comprehend → project; most SA errors
   are failures to PERCEIVE ([Endsley 1995](https://www.researchgate.net/publication/210198492_Endsley_MR_Toward_a_Theory_of_Situation_Awareness_in_Dynamic_Systems_Human_Factors_Journal_371_32-64)).
   What changed must be visible without looking for it.
5. **One item, one decision, done where you see it** (KDS bump, Linear triage): approve a photo IN the
   queue, not two screens away.
6. **Automate so less reaches the human** (Goosechase, Linear): auto-approve by rule, auto-start late
   joiners, expire stale items.
7. **"I have this"** (PagerDuty acknowledge) once there are several staff: nobody should approve the same
   photo or run to the same SOS twice.
8. **Thumb-first on the phone.** 49% hold the phone in one hand and thumbs make ~75% of interactions;
   the bottom third is easiest to reach ([Hoober, A List Apart](https://alistapart.com/article/how-we-hold-our-gadgets/)).
   Marshals are outdoors, walking, often with one hand.

## 4. The plan

Each phase is an OpenSpec change built test-first, checked in the browser at 1280 and at 375×667, then
in a real run.

**Phase 0: measure (half a day).** Count, from the audit logs of the real runs (2026-09-10, 2026-09-27),
which console and staff actions were actually used and how often. That list decides what is up front
(principle 2). Then one wireframe session with Ahiya.

**Phase 1: `followed-teams` (specified).** ☆ a team anywhere; "הקבוצות שלי" strip at the top of both
apps with one status per team (colour only when wrong) and the one action it needs; ‹ › between
followed teams; "רק שלי" on list, map and "now". Local, zero server cost. Implementation plan:
`openspec/changes/followed-teams/`.

**Phase 2: `now-queue-decisions` (the organizer's main screen).**
- Every "now" row decides in place: approve/reject a photo with its preview in the row, acknowledge an
  SOS, start a team, approve a flash mission. The team page stays for everything else.
- Noise out: "stuck" only for a team that is live, in a live run, with no progress for N minutes of
  THIS run; items older than the run are not shown.
- Colour discipline across the console: neutral by default, amber and red only on the queue ages, SOS
  and out of bounds (principle 1). Two sounds only: SOS (until acknowledged) and overdue review.
- The default screen becomes: "הקבוצות שלי" strip, the queue, and the map beside it (Onfleet), with
  four numbers on top (playing, waiting, finished, time left).

**Phase 3: `console-three-screens` (the shell).** Live console = three screens only: עכשיו · קבוצות
(list + map + team page) · משחק (one composer for a message or a flash mission, pause/close a mission).
Everything done once (join link, QR sheet, staff invite, screens) moves to a "before the game" page;
everything after (summary, analytics, heatmap, feedback) to the existing report page. Panels a game does
not use (zones, collectibles, hot zone) do not render. Split the 4,441-line page into components on the
way (no behaviour change).

**Phase 4: `staff-app-tabs` (the counsellors).** Replace the long scroll with a bottom tab bar (thumb
zone): עכשיו · הקבוצות שלי · מפה · צ׳אט. "עכשיו" is the same queue as the console, filtered by the
person's permissions and by their teams first. Each team card has one action plus "עוד". "אני מטפל/ת"
on an SOS or a review shows everyone else who has it (principle 7). Bigger type and plain colours for
sunlight.

**Phase 5 (bold option, decide after phase 4): one mobile ops app.** The organizer on a phone uses the
same mobile screens as the staff, with every permission; the desktop console stays for the big screen.
One mobile interface to learn and maintain instead of two.

## 5. How we will know it worked

- Taps from "a photo arrived" to "approved": today opening the item and finding the button; target 1.
- Median time a submission waits for a decision (already measurable from the review timestamps).
- Items in the "now" list that nobody needed to act on: target 0.
- In the next real run: does the organizer still describe the console as exhausting; can a marshal
  find their team in one tap.
