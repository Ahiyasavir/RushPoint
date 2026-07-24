# Tasks — finish-moment-polish

All three changes are in `apps/play-web/src/screens/FinalScreen.tsx`. play-web has no component test
runner, so this is a UI lane (typecheck / build / bundle-budget / i18n) plus a manual reveal check;
no pure-logic module is extracted (design.md rationale).

## Implement

- [ ] 1. **Badge bounded refetch** — in `BadgesCard`, add `MAX_BADGE_POLLS = 3` and
      `BADGE_POLL_INTERVAL_MS = 2000`, and rework the `[finalized]` effect into a bounded poll that
      keeps the existing profile-application logic (per-player `seen` set, `fresh` highlight,
      empty-tolerant `.catch`), does the same immediate first fetch, and schedules another fetch only
      while `finalized && earned.length === 0 && attempts < MAX_BADGE_POLLS`. Cleanup clears the
      pending timer and the `alive` flag. Confirm it stops on success and at the cap (no infinite
      poll, no spam). (design.md §1)

- [ ] 2. **Native-share confirmation** — in `share()`, add `'shared'` to the success set so
      `result === 'downloaded' || result === 'copied' || result === 'shared'` sets `shared`. Leave
      `'failed'` (cancellation) unconfirmed. Reuse the existing `t.final.shareSaved` label — no new
      i18n key. (design.md §2)

- [ ] 3. **Audio/haptic climax** — import `feedback` from `../lib/sound` and call
      `feedback('rankUp')` inside the existing once-only confetti `setTimeout` so it fires once at the
      reveal, gated by the existing mute check inside `feedback()`. Do not edit `sound.ts`. (design.md
      §3)

## Verify (build lane — this agent)

- [ ] 4. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. Especially bundle:budget (no eager heavy import) and
      i18n:check:strict (no new PART B finding).
- [ ] 5. `npx openspec validate finish-moment-polish --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 6. Reveal with sound on fires the rankUp cue once; muted is silent.
- [ ] 7. Native share on mobile confirms on a real share, shows nothing on cancel.
- [ ] 8. Solo instant-play finish surfaces earned badges within the poll window.
