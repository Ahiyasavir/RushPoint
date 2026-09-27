# Tasks: game-file-full-settings

Why: export/import silently dropped three run behaviours (autoApproveAllMedia, autoStartLateJoiners,
requireAllMembersOnline) and mission fields (answerOutcomes, unmatchedPoints, revealOutcomePoints,
wrongAnswerPenalty, requiredContributors, smart.preferredCamera). The drift-guard test's own field
lists had gone stale too, which is how it stayed green.

- [x] 1.1 RED: scripts/test-game-file.ts full lists + an explicit round trip (7 failures).
- [x] 2.1 gameFile.ts: export them; exclude template curation flags, the share-launch lock and the
      derived choicePoints; field types; the in-place import door writes the three behaviours.
- [x] 2.2 The classification is a TYPE error (`assertAllClassified`), proven by removing a key.
- [x] 3.1 e2e: the file, a new game and an in-place import all keep every setting (59 checks, green).
