- [x] 1 RED: scripts/test-mission-quality.ts (ratings complete and in range, prior/posterior, bonus
  bounds, composer and regenerate prefer quality, evidence flows, randomness kept, same draws).
- [x] 2 GREEN: lib/missionQuality.ts; composer opts.quality / missionStats; RegenerateRequest.quality / missionStats.
- [x] 3 functions/src/gallery/missionSignals.ts + vitest; recordMissionSignals; RATE_LIMITS budget; rules.
- [x] 4 Client: services/calls wrapper, loadMissionStats, signals on launch and regenerate.
- [ ] 5 e2e scenario "mission signals" and the rules checks, run with the final gate.
