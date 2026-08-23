## 1. RED — failing test first

- [x] 1.1 Add `scripts/test-template-picker-order.ts` asserting `TEMPLATES[0].key === 'blank'`
      (import `TEMPLATES` from `apps/creator-web/src/templates.ts`); confirm it fails against the
      current array order.

## 2. GREEN — minimum change

- [x] 2.1 In `apps/creator-web/src/templates.ts`, move the `blank` template object (and its
      section-comment context) to the top of the `TEMPLATES` array, ahead of the niche templates.
- [x] 2.2 Re-run `scripts/test-template-picker-order.ts` and confirm it passes.

## 3. Verify

- [x] 3.1 `npm run typecheck`
- [x] 3.2 `npm test` (aggregator picks up the new test automatically)
- [x] 3.3 `npm run creator:build`
- [x] 3.4 Manual preview: open the Dashboard's new-game template picker, confirm blank is first.
