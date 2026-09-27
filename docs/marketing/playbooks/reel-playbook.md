# Content bank — reel scripts, ready to shoot

Finished, checked scripts with their assets and the reasoning behind them. Every script here
has passed `.claude/skills/video-script/scripts/check_script.py` with zero blocking findings.
Invoke the `video-script` skill before writing a new one.

| # | Script | Length | Goal | Status |
|---|---|---|---|---|
| 01 | [המשימות](01-missions-falafel.md) | 25s | הרשמות למירוץ | ready to shoot |
| 02 | [יוסף חדאד](02-haddad-loop.md) | 22s | חשיפה · עוקבים · ביקורי פרופיל | ready to cut |

## The one measurement that shaped both

The 2026-09-19 promo reel (47s, `docs/marketing/live-promo/`) measured:

    3,900 views · 65 likes (1.67%) · 32 comments · 0 registrations

A 1.67% like rate is low; the comment rate looks high (0.82%) but the founder confirmed the
comments were friends complying with a tag ask, so genuine stranger engagement was ~0.
**Distribution worked. The content moved nobody.** Four causes, and the third is the root:

1. **The ask was 30 minutes of social work presented as a link tap.** Registering means
   recruiting 5-7 friends and committing a date a month out. The video ended on "link in bio".
2. **It sold the mechanism, not the feeling.** Seconds 9-20 were transport, phone, missions.
3. **There is no footage of a real race.** Every clip he owns is a talking head or the street
   booth. The video asked people to commit to an experience they had never seen.
4. **"3 of 10 closed" backfired.** Scarcity amplifies existing desire; with none, "7 slots
   empty" reads as "nobody wants this".

## Rules that came out of it

- **The ask must match the audience's temperature.** Comment-to-DM converts 8-15% on organic
  content against cold link-in-bio traffic, because it captures intent at peak interest and
  costs the viewer two seconds. Every script here ends on a one-word comment, not a link.
- **Never write a line with a public failure state.** No announced deadline you might miss, no
  "a creator will be there" before one has said yes, no "zero people signed up".
- **Read the product before writing about it.** A rejected draft invented a "choose which
  mission to take" mechanic; RushPoint routes tasks automatically (`routing/assignNextTask.ts`).
  The mission bank (`apps/creator-web/src/taskBank.ts`, 107 entries) is the real source.
- **The energy curve must rise.** Start high, climb through the middle, peak at the end. A flat
  list of equally-weighted beats followed by logistics is what "boring" feels like.
- **Profile visits, not views, are what a follow comes from.** Views mean the platform
  distributed it; visits mean someone got curious about the PERSON. Profile visit to follow
  runs about 13.5%.
