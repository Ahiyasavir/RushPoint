# Composer v2, phase 3: the creator's taste profile

## Why
Plan, phase 3 (bonus of the regenerate item): learn which kinds of mission a creator likes from what
they keep and what they swap away. The founder: the profile must be "כמה שיותר מתומצת ובכל זאת יתן
הרבה מאוד מידע".

## What changes
- `lib/tasteCodec.ts`: one signed 4-bit value per activity+mechanic tag (27 tags), fixed order,
  base64url behind `t1:`; 22 characters per creator. Every signal decays the profile by 0.9 first.
- `lib/tasteProfile.ts`: per-creator localStorage (fails open), and a mission's taste tags (bank tags
  for an unedited bank mission, otherwise what the mission itself shows).
- Signals: regenerate records -1 for the mission swapped away; a real launch (not a test drive) records
  +1 for every mission in the game, with ONE decay (`recordTasteMany`).
- Reads: the composer and regenerate add `0.08 × affinity` to a candidate's score. No extra rng draws.
