# Composer v2, phases 5-6: quality ratings, learned from creators

## Why
Plan, phases 5 and 6. "תקדם משימות חזקות ותשים משימות חלשות כברירה אחרונה, ובכל זאת ... רנדומליות" and
"תלמד על בסיס כמה היוצרים אוהבים את המשימות". The founder ruled the rating is not shown to creators.

## What changes
- `lib/missionQuality.ts`: a 1-5 rating for every bank mission, from his own review verdicts
  (5 praised, 4 approved as written, 3 approved after a fix or reviewed earlier, 2 never reviewed).
  The rating is a prior worth 10 observations (not 50%, after Roblox's cold-start paper); creators' keep
  and swap counts are the evidence; the posterior mean gives a bonus of at most ±0.10.
- The composer and regenerate add that bonus. The randomness stays the composer's band sampling, so a
  strong mission wins more often, never always. No extra rng draws.
- `recordMissionSignals` (functions/src/gallery): a creator's launch records every unedited bank mission
  as KEPT; a regenerate records the mission swapped away as SWAPPED. Counts only, one document
  (`missionStats/all`), signed-in callers only (like every creator callable), rate-limited, garbage keys dropped before
  they can become field paths. Rules: any signed-in client reads it, no client writes it.
- Client: `loadMissionStats` (one read, memoised, fails open) feeds the composer and regenerate.

## Measured (scripts/test-mission-quality.ts)
Average rating of composed missions 3.32 without quality, 3.93 with. A mission creators keep (60 kept,
0 swapped) appears in 9 of 30 games instead of 3. The same answers still give 15 different games of 15.
