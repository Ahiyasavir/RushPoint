# Tasks — gallery-mission-detail

## RED

- [x] 1. Write `scripts/test-gallery-task-detail.ts` against the not-yet-existing
      `apps/creator-web/src/lib/galleryTaskDetail.ts`: the secrecy sweep over a polluted document
      (values, sentinel numbers AND key names), exact-coordinates-never-become-the-area, the
      area/`isPlottablePublicTask` agreement matrix, the row order + every suppression rule,
      difficulty/points/copies/minutes/date normalization, all nine type keys plus the unknown
      fallbacks, and the totality sweep over `null`/`undefined`/`42`/`'x'`/`[]`/`{}`.
      Run it, confirm it fails on the missing module, record the output.
- [x] 2. Add the wiring guards to the same suite (source scans): the modal file references no secret
      field name and never reads `.coordinates`; `GalleryPage.tsx` and `TaskLibrary.tsx` both import
      and open the modal; every new i18n key exists in BOTH language maps. RED.

## GREEN

- [x] 3. Create `apps/creator-web/src/lib/galleryTaskDetail.ts`: `GalleryTaskTypeKey`,
      `GalleryDetailRowKey`, `GalleryDetailRow`, `GalleryTaskDetail`,
      `SECRET_TASK_FIELD_NAMES`, `galleryTaskTypeKey()`, `buildGalleryTaskDetail()`. Copy-out
      construction only, never a spread of the input. Pure, no React, no Firebase.
      Re-run the suite to green on the pure half.
- [x] 4. Add the HE + EN copy to `apps/creator-web/src/i18n.ts` under `gallery` (additive only, the
      file is contended by parallel agents: re-read immediately before editing). No em dash, no en
      dash, no spaced hyphen.
- [x] 5. Create `apps/creator-web/src/components/GalleryTaskDetailModal.tsx`: modal shell matching
      `TaskLibrary`, Escape/backdrop/✕ close, `role="dialog"` + `aria-modal` + `aria-labelledby`,
      row rendering driven by `detail.rows`, tag chips, the lazy `GalleryMap` area block with the
      approximate-pins caption, the answer-keys-stay-with-the-author note, and either the
      "use this mission" action or the where-to-add hint.
- [x] 6. Wire `apps/creator-web/src/components/TaskLibrary.tsx`: rows become pressable
      (`role="button"`, `tabIndex`, Enter/Space), the existing insert button stops propagation, the
      modal opens with `onUse` bound to the existing `pick()`.
- [x] 7. Wire `apps/creator-web/src/pages/GalleryPage.tsx`: mission cards become pressable, the
      `LikeButton` stops propagation, the modal opens without `onUse`.
- [x] 8. Re-run `npx tsx scripts/test-gallery-task-detail.ts` and confirm ALL PASS.

## REFACTOR / VERIFY

- [x] 9. `npx tsx scripts/check-i18n.ts --strict` clean, zero new PART B findings.
- [ ] 10. Hand off the full gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`). This lane must not run them: they rewrite
      `packages/shared/dist` in place and other agents are live on this tree.
- [x] 11. Confirm no e2e change is owed: no callable added or changed, `ALLOWED_TASK_KEYS`
      untouched, so the callable coverage guard is unaffected.
